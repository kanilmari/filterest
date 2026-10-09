// dataset_appearance_saver.go
// Reads and saves revision-protected appearance overrides by immutable dataset UID.
// Connects caller-owned transactions, shared values and private dataset metadata.
// Keeps empty rows durable and serializes competing first writes for every API adapter.
package dataset_appearance_store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

const datasetAppearanceSchemaVersion = 1

// Slice 3a migrates only these card leaves. Slice 5 widens this write allowlist
// together with the owner-decided K290 policy for shared changes and merged masks.
// Stored snapshots and the resolver retain the full canonical read contract.
var datasetAppearanceWritePaths = []string{"shared.card_style_variant", "shared.card_detail_columns"}

var (
	ErrDatasetAppearanceConflict = &httpresponse.Refusal{Status: http.StatusConflict, LangKey: "dataset_appearance_conflict", Message: "dataset appearance changed; reload before saving"}
	ErrDatasetAppearanceNotFound = &httpresponse.Refusal{Status: http.StatusNotFound, LangKey: "dataset_appearance_not_found", Message: "dataset no longer exists"}
)

// DatasetAppearanceSnapshot contains only stored overrides, never inherited values.
// Revision is opaque to callers; "none" denotes a dataset with no stored row yet.
type DatasetAppearanceSnapshot struct {
	SchemaVersion int            `json:"schema_version"`
	Overrides     map[string]any `json:"overrides"`
	Revision      string         `json:"revision"`
}

// DatasetAppearancePatch removes inheritance overrides only through Unset.
// Null is invalid in Set; a path cannot occur in both operations.
type DatasetAppearancePatch struct {
	Set   map[string]any `json:"set"`
	Unset []string       `json:"unset"`
}

// ReadDatasetAppearance reads one live dataset's sparse map and durable revision
// through the caller's authorized connection. Result snapshots use ReadAppearance
// to read this map together with the shared scope and both revisions.
func ReadDatasetAppearance(q dbutils.Querier, tableUID int, development bool) (DatasetAppearanceSnapshot, error) {
	var raw []byte
	var version sql.NullInt64
	var revision sql.NullString
	err := q.QueryRow(`SELECT appearance.schema_version, appearance.overrides, appearance.revision::text
        FROM public.system_db_tables dataset
        LEFT JOIN public.system_dataset_appearance appearance USING (table_uid)
        WHERE dataset.table_uid=$1`, tableUID).Scan(&version, &raw, &revision)
	if errors.Is(err, sql.ErrNoRows) {
		return DatasetAppearanceSnapshot{}, ErrDatasetAppearanceNotFound
	}
	if err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	if !version.Valid {
		return DatasetAppearanceSnapshot{datasetAppearanceSchemaVersion, map[string]any{}, "none"}, nil
	}
	return DecodeDatasetAppearanceSnapshot(int(version.Int64), raw, revision.String, development)
}

// DecodeDatasetAppearanceSnapshot checks durable stored revisions and canonical leaves.
func DecodeDatasetAppearanceSnapshot(version int, raw []byte, revision string, development bool) (DatasetAppearanceSnapshot, error) {
	if version != datasetAppearanceSchemaVersion {
		return DatasetAppearanceSnapshot{}, fmt.Errorf("unsupported dataset appearance schema version %d", version)
	}
	number, err := strconv.ParseInt(revision, 10, 64)
	if err != nil || number < 1 {
		return DatasetAppearanceSnapshot{}, errors.New("invalid dataset appearance revision")
	}
	var overrides map[string]any
	if err := json.Unmarshal(raw, &overrides); err != nil || overrides == nil {
		return DatasetAppearanceSnapshot{}, errors.New("dataset appearance overrides must be an object")
	}
	values, err := validatedDatasetAppearanceOverrides(overrides, development)
	if err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	return DatasetAppearanceSnapshot{version, values, revision}, nil
}

// SaveDatasetAppearance validates and patches only overrides under a transaction
// lock, returning a 409 refusal for stale or competing initial saves. The caller
// owns commit/rollback (HTTP callers must obtain this tx through RequireTx).
// Every caller supplies both revisions; shared locking always precedes dataset locks.
func SaveDatasetAppearance(tx *sql.Tx, tableUID int, patch DatasetAppearancePatch, expected, sharedExpected string, development bool) (DatasetAppearanceSnapshot, error) {
	if err := ValidateDatasetAppearancePatch(patch); err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	set, err := validatedDatasetAppearanceOverrides(patch.Set, development)
	if err != nil {
		return DatasetAppearanceSnapshot{}, datasetAppearanceInputRefusal(err)
	}
	if expected == "" || sharedExpected == "" {
		return DatasetAppearanceSnapshot{}, ErrDatasetAppearanceConflict
	}
	if err := LockShared(tx, false); err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	shared, sharedVersion, err := ReadShared(tx, development)
	if err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	if sharedVersion != sharedExpected {
		return DatasetAppearanceSnapshot{}, ErrDatasetAppearanceConflict
	}
	// An absent override row has nothing to lock. A UID-scoped advisory lock
	// serializes its initial writes before the row lock/revision comparison.
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended('dataset_appearance:' || $1::text,0))`, tableUID); err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	var liveUID int
	err = tx.QueryRow(`SELECT table_uid FROM public.system_db_tables WHERE table_uid=$1 FOR KEY SHARE`, tableUID).Scan(&liveUID)
	if errors.Is(err, sql.ErrNoRows) {
		return DatasetAppearanceSnapshot{}, ErrDatasetAppearanceNotFound
	}
	if err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	var version int
	var raw []byte
	var revision string
	err = tx.QueryRow(`SELECT schema_version,overrides,revision::text
        FROM public.system_dataset_appearance WHERE table_uid=$1 FOR UPDATE`, tableUID).Scan(&version, &raw, &revision)
	current := DatasetAppearanceSnapshot{datasetAppearanceSchemaVersion, map[string]any{}, "none"}
	exists := err == nil
	if exists {
		current, err = DecodeDatasetAppearanceSnapshot(version, raw, revision, development)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return DatasetAppearanceSnapshot{}, err
	}
	if current.Revision != expected {
		return DatasetAppearanceSnapshot{}, ErrDatasetAppearanceConflict
	}
	for _, path := range patch.Unset {
		delete(current.Overrides, path)
	}
	for path, value := range set {
		current.Overrides[path] = value
	}
	if _, err := ResolveDatasetAppearance(shared, current.Overrides, development); err != nil {
		return DatasetAppearanceSnapshot{}, datasetAppearanceInputRefusal(err)
	}
	data, err := json.Marshal(current.Overrides)
	if err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	if exists {
		err = tx.QueryRow(`UPDATE public.system_dataset_appearance SET overrides=$2::jsonb,revision=revision+1
            WHERE table_uid=$1 RETURNING revision::text`, tableUID, string(data)).Scan(&current.Revision)
	} else {
		// Also refuse a writer that did not take the advisory lock; never upsert
		// over an independently committed first row after the revision check.
		err = tx.QueryRow(`INSERT INTO public.system_dataset_appearance(table_uid,schema_version,overrides)
            VALUES($1,$2,$3::jsonb) ON CONFLICT(table_uid) DO NOTHING RETURNING revision::text`,
			tableUID, datasetAppearanceSchemaVersion, string(data)).Scan(&current.Revision)
		if errors.Is(err, sql.ErrNoRows) {
			return DatasetAppearanceSnapshot{}, ErrDatasetAppearanceConflict
		}
	}
	return current, err
}

// ValidateDatasetAppearancePatch refuses writes outside this slice before any
// transaction work. HTTP adapters call it before RequireTx; persistence repeats
// it so compatibility and generic metadata writers share the same boundary.
func ValidateDatasetAppearancePatch(patch DatasetAppearancePatch) error {
	for path := range patch.Set {
		if !slices.Contains(datasetAppearanceWritePaths, path) {
			return datasetAppearanceInputRefusal(fmt.Errorf("appearance path %s cannot be overridden", path))
		}
	}
	for _, path := range patch.Unset {
		if !slices.Contains(datasetAppearanceWritePaths, path) {
			return datasetAppearanceInputRefusal(fmt.Errorf("appearance path %s cannot be overridden", path))
		}
		if _, exists := patch.Set[path]; exists {
			return datasetAppearanceInputRefusal(fmt.Errorf("appearance path %s is both set and unset", path))
		}
	}
	return nil
}

func datasetAppearanceInputRefusal(err error) error {
	return &httpresponse.Refusal{Status: http.StatusBadRequest, LangKey: "dataset_appearance_invalid", Message: err.Error()}
}
