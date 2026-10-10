// shared_appearance_revision.go
// Reads consistent appearance snapshots and serializes every appearance writer.
// Connects the shared setting row, immutable dataset UID and optimistic revisions.
// Covers absent shared rows with an advisory lock before any dataset lock.
package dataset_appearance_store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"

	"easelect/backend/core_components/dbutils"
	appearance "easelect/frontend/shared/dataset_appearance"
)

const SharedConfigKey = "dataset_cover_theme_config"

// SharedRevision is opaque and durable, including the absent-row token "none".
func SharedRevision(raw []byte, stamp string) string {
	if len(raw) == 0 {
		return "none"
	}
	sum := sha256.Sum256(append(append([]byte{}, raw...), []byte("\x00"+stamp)...))
	return hex.EncodeToString(sum[:])
}

// LockShared must precede dataset advisory, registry and override row locks.
// Shared writers take exclusive; override and compatibility writers take shared.
func LockShared(tx *sql.Tx, exclusive bool) error {
	query := `SELECT pg_advisory_xact_lock_shared(hashtextextended('dataset_appearance_shared',0))`
	if exclusive {
		query = `SELECT pg_advisory_xact_lock(hashtextextended('dataset_appearance_shared',0))`
	}
	_, err := tx.Exec(query)
	return err
}

// ReadShared reads values and revision together; locks are owned by the caller.
func ReadShared(q dbutils.Querier, development bool) (appearance.DatasetCoverThemeConfig, string, error) {
	var raw []byte
	var stamp string
	err := q.QueryRow(`SELECT COALESCE(json_value::text,'null'),COALESCE(updated::text,'') FROM public.system_config WHERE key=$1`, SharedConfigKey).Scan(&raw, &stamp)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return appearance.DatasetCoverThemeConfig{}, "", err
	}
	site, err := DecodeSiteAppearance(raw, development)
	return site, SharedRevision(raw, stamp), err
}

// AppearanceResponse is the dataset-authorized appearance snapshot; Sources
// inventories all canonical leaves. Effective is a derived light/dark/shared projection.
type AppearanceResponse struct {
	DatasetUID    int                                `json:"dataset_uid"`
	SchemaVersion int                                `json:"schema_version"`
	TabValues     map[string]any                     `json:"tab_values"`
	SiteValues    map[string]any                     `json:"site_values"`
	Defaults      map[string]any                     `json:"defaults"`
	Overrides     map[string]any                     `json:"overrides"`
	Effective     appearance.DatasetCoverThemeConfig `json:"effective"`
	Sources       map[string]string                  `json:"sources"`
	SharedVersion string                             `json:"shared_version"`
	Version       string                             `json:"version"`
}

// ReadAppearance reads both scopes in one PostgreSQL statement snapshot. It must
// only be called after dataset authorization, even when the row query returns zero rows.
func ReadAppearance(q dbutils.Querier, uid int, development bool) (AppearanceResponse, error) {
	return ReadAppearanceForName(q, uid, "", development)
}

// ReadAppearanceForName also pins the authorized name to its captured UID, refusing
// a rename/name-reuse race instead of reading the replacement dataset's appearance.
func ReadAppearanceForName(q dbutils.Querier, uid int, name string, development bool) (AppearanceResponse, error) {

	var sharedRaw, tabRaw, raw []byte
	var stamp string
	var version sql.NullInt64
	var revision sql.NullString
	err := q.QueryRow(`SELECT CASE WHEN shared.key IS NULL THEN NULL ELSE COALESCE(shared.json_value::text,'null') END,COALESCE(shared.updated::text,''),
 a.schema_version,a.tab_values,a.overrides,a.revision::text FROM public.system_db_tables d
 LEFT JOIN public.system_config shared ON shared.key=$2
 LEFT JOIN public.system_dataset_appearance a USING(table_uid) WHERE d.table_uid=$1 AND ($3='' OR d.table_name=$3)`, uid, SharedConfigKey, name).Scan(&sharedRaw, &stamp, &version, &tabRaw, &raw, &revision)
	if errors.Is(err, sql.ErrNoRows) {
		return AppearanceResponse{}, ErrDatasetAppearanceNotFound
	}
	if err != nil {
		return AppearanceResponse{}, err
	}
	snapshot := DefaultDatasetAppearanceSnapshot()
	if version.Valid {
		snapshot, err = DecodeDatasetAppearanceSnapshot(int(version.Int64), tabRaw, raw, revision.String, development)
	}
	if err != nil {
		return AppearanceResponse{}, err
	}
	shared, err := DecodeSiteAppearance(sharedRaw, development)
	if err != nil {
		return AppearanceResponse{}, err
	}
	return responseFor(uid, shared, SharedRevision(sharedRaw, stamp), snapshot, development)
}

func responseFor(uid int, shared appearance.DatasetCoverThemeConfig, sharedVersion string, snapshot DatasetAppearanceSnapshot, development bool) (AppearanceResponse, error) {
	effective, err := ResolveDatasetAppearance(shared, snapshot.TabValues, snapshot.Overrides, development)
	if err != nil {
		return AppearanceResponse{}, err
	}
	sources := map[string]string{}
	for _, path := range appearance.Rules().CanonicalPaths() {
		place, _ := appearance.Rules().PlaceForPath(path)
		sources[path] = map[appearance.Place]string{appearance.TabOnly: "tab", appearance.SiteOnly: "site", appearance.SiteDefault: "default"}[place]
		if _, exists := snapshot.Overrides[path]; exists {
			sources[path] = "override"
		}
	}
	return AppearanceResponse{DatasetUID: uid, SchemaVersion: snapshot.SchemaVersion, TabValues: snapshot.TabValues,
		SiteValues: ValuesForPlace(shared, appearance.SiteOnly), Defaults: ValuesForPlace(shared, appearance.SiteDefault),
		Overrides: snapshot.Overrides, Effective: effective, Sources: sources, SharedVersion: sharedVersion, Version: snapshot.Revision}, nil
}

// UIDForName resolves the existing compatibility name without locking; the saver
// rechecks dataset existence under the shared-before-dataset lock sequence.
func UIDForName(q dbutils.Querier, name string) (int, error) {
	var uid int
	err := q.QueryRow(`SELECT table_uid FROM public.system_db_tables WHERE table_name=$1`, name).Scan(&uid)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrDatasetAppearanceNotFound
	}
	return uid, err
}

// SaveAppearance returns exactly the transaction's persisted snapshot.
func SaveAppearance(tx *sql.Tx, uid int, patch DatasetAppearancePatch, sharedVersion, version string, development bool) (AppearanceResponse, error) {
	snapshot, err := SaveDatasetAppearance(tx, uid, patch, version, sharedVersion, development)
	if err != nil {
		return AppearanceResponse{}, err
	}
	shared, current, err := ReadShared(tx, development)
	if err != nil {
		return AppearanceResponse{}, err
	}
	if current != sharedVersion {
		return AppearanceResponse{}, fmt.Errorf("shared revision changed inside locked transaction")
	}
	return responseFor(uid, shared, current, snapshot, development)
}
