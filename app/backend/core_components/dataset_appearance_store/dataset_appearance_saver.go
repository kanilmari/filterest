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
	appearance "easelect/frontend/shared/dataset_appearance"
)

const datasetAppearanceSchemaVersion = 2

// Both HTTP and compatibility writers derive the same ownership boundary.
var datasetAppearanceWritePaths = appearance.Rules().PathsForPlace(appearance.SiteDefault)

var (
	ErrDatasetAppearanceReload   = &httpresponse.Refusal{Status: http.StatusBadRequest, LangKey: "dataset_appearance_reload", Message: "appearance save format changed; reload before saving"}
	ErrDatasetAppearanceConflict = &httpresponse.Refusal{Status: http.StatusConflict, LangKey: "dataset_appearance_conflict", Message: "dataset appearance changed; reload before saving"}
	ErrDatasetAppearanceNotFound = &httpresponse.Refusal{Status: http.StatusNotFound, LangKey: "dataset_appearance_not_found", Message: "dataset no longer exists"}
)

// DatasetAppearanceSnapshot contains complete tab values and sparse overrides.
// Revision is opaque to callers; "none" denotes a dataset with no stored row yet.
type DatasetAppearanceSnapshot struct {
	SchemaVersion int            `json:"schema_version"`
	TabValues     map[string]any `json:"tab_values"`
	Overrides     map[string]any `json:"overrides"`
	Revision      string         `json:"revision"`
}

// DatasetAppearancePatch removes inheritance overrides only through Unset.
// TabSet patches complete owned values; tab values cannot be unset.
// Null is invalid in Set; a path cannot occur in both override operations.
type DatasetAppearancePatch struct {
	TabSet map[string]any `json:"tab_set"`
	Set    map[string]any `json:"set"`
	Unset  []string       `json:"unset"`
}

// ReadDatasetAppearance reads one live dataset's sparse map and durable revision
// through the caller's authorized connection. Result snapshots use ReadAppearance
// to read this map together with the shared scope and both revisions.
func ReadDatasetAppearance(q dbutils.Querier, tableUID int, development bool) (DatasetAppearanceSnapshot, error) {
	var raw, tabRaw []byte
	var version sql.NullInt64
	var revision sql.NullString
	err := q.QueryRow(`SELECT appearance.schema_version, appearance.tab_values, appearance.overrides, appearance.revision::text
        FROM public.system_db_tables dataset
        LEFT JOIN public.system_dataset_appearance appearance USING (table_uid)
        WHERE dataset.table_uid=$1`, tableUID).Scan(&version, &tabRaw, &raw, &revision)
	if errors.Is(err, sql.ErrNoRows) {
		return DatasetAppearanceSnapshot{}, ErrDatasetAppearanceNotFound
	}
	if err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	if !version.Valid {
		return DefaultDatasetAppearanceSnapshot(), nil
	}
	return DecodeDatasetAppearanceSnapshot(int(version.Int64), tabRaw, raw, revision.String, development)
}

// DecodeDatasetAppearanceSnapshot checks durable stored revisions and canonical leaves.
func DecodeDatasetAppearanceSnapshot(version int, tabRaw, raw []byte, revision string, development bool) (DatasetAppearanceSnapshot, error) {
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
	values, err := validatedDatasetAppearanceOverrides(overrides, true)
	if err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	normalizeStoredLayout(values, development)
	var tabValues map[string]any
	if err := json.Unmarshal(tabRaw, &tabValues); err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	if err := appearance.ValidateTabValuesV2(tabValues, development); err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	return DatasetAppearanceSnapshot{SchemaVersion: version, TabValues: tabValues, Overrides: values, Revision: revision}, nil
}

// DefaultDatasetAppearanceSnapshot serves missing rows without creating storage.
func DefaultDatasetAppearanceSnapshot() DatasetAppearanceSnapshot {
	return DatasetAppearanceSnapshot{SchemaVersion: datasetAppearanceSchemaVersion,
		TabValues: appearance.Rules().DefaultsForPlace(appearance.TabOnly), Overrides: map[string]any{}, Revision: "none"}
}

// SaveDatasetAppearance validates and patches both maps under a transaction
// lock, returning a 409 refusal for stale or competing initial saves. The caller
// owns commit/rollback (HTTP callers must obtain this tx through RequireTx).
// Every caller supplies both revisions; shared locking always precedes dataset locks.
func SaveDatasetAppearance(tx *sql.Tx, tableUID int, patch DatasetAppearancePatch, expected, sharedExpected string, development bool) (DatasetAppearanceSnapshot, error) {
	if err := ValidateDatasetAppearancePatch(patch); err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	tabSet, err := normalizedValues(patch.TabSet)
	if err != nil {
		return DatasetAppearanceSnapshot{}, datasetAppearanceInputRefusal(err)
	}
	for path, value := range tabSet {
		if err := appearance.Rules().ValidateLeaf(path, value, development); err != nil {
			return DatasetAppearanceSnapshot{}, datasetAppearanceInputRefusal(err)
		}
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
	_, sharedVersion, err := ReadShared(tx, development)
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
	var raw, tabRaw []byte
	var revision string
	err = tx.QueryRow(`SELECT schema_version,tab_values,overrides,revision::text
        FROM public.system_dataset_appearance WHERE table_uid=$1 FOR UPDATE`, tableUID).Scan(&version, &tabRaw, &raw, &revision)
	current := DefaultDatasetAppearanceSnapshot()
	exists := err == nil
	if exists {
		current, err = DecodeDatasetAppearanceSnapshot(version, tabRaw, raw, revision, development)
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
	for path, value := range tabSet {
		current.TabValues[path] = value
	}
	if err := appearance.ValidateTabValuesV2(current.TabValues, development); err != nil {
		return DatasetAppearanceSnapshot{}, datasetAppearanceInputRefusal(err)
	}
	tabData, err := json.Marshal(current.TabValues)
	if err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	data, err := json.Marshal(current.Overrides)
	if err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	if exists {
		err = tx.QueryRow(`UPDATE public.system_dataset_appearance SET overrides=$2::jsonb,tab_values=$3::jsonb,revision=revision+1
            WHERE table_uid=$1 RETURNING revision::text`, tableUID, string(data), string(tabData)).Scan(&current.Revision)
	} else {
		// Also refuse a writer that did not take the advisory lock; never upsert
		// over an independently committed first row after the revision check.
		err = tx.QueryRow(`INSERT INTO public.system_dataset_appearance(table_uid,schema_version,overrides,tab_values)
            VALUES($1,$2,$3::jsonb,$4::jsonb) ON CONFLICT(table_uid) DO NOTHING RETURNING revision::text`,
			tableUID, datasetAppearanceSchemaVersion, string(data), string(tabData)).Scan(&current.Revision)
		if errors.Is(err, sql.ErrNoRows) {
			return DatasetAppearanceSnapshot{}, ErrDatasetAppearanceConflict
		}
	}
	return current, err
}

// ValidateDatasetAppearancePatch refuses writes outside each place before any
// transaction work. HTTP adapters call it before RequireTx; persistence repeats
// it so compatibility and generic metadata writers share the same boundary.
func ValidateDatasetAppearancePatch(patch DatasetAppearancePatch) error {
	tabPaths := appearance.Rules().PathsForPlace(appearance.TabOnly)
	for path := range patch.TabSet {
		if !slices.Contains(tabPaths, path) {
			return datasetAppearanceInputRefusal(fmt.Errorf("appearance path %s is not tab-owned", path))
		}
	}
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
