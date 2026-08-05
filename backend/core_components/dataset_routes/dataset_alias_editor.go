// dataset_alias_editor.go
// Manages the admin-facing dataset alias editing contract and validation rules.
// Bridges system_db_tables metadata, alias persistence, and route-namespace safety checks.
// Exists so alias management can grow without leaking write-path details into router handlers.
package dataset_routes

import (
	"database/sql"
	"easelect/backend/core_components/dbutils"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const (
	aliasSourceRawOnly      = "raw_only"
	aliasSourceDatabase     = "database_primary_active"
	aliasSourceFallback     = "code_fallback"
	aliasSourceAutomaticApp = "automatic_app_policy"
)

var datasetAliasSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

// AliasManagementEntry describes one dataset's current alias state for the admin editor.
type AliasManagementEntry struct {
	DatasetName                 string `json:"dataset_name"`
	TableUID                    int    `json:"table_uid"`
	StoredPrimaryAlias          string `json:"stored_primary_alias"`
	EffectivePublicAlias        string `json:"effective_public_alias"`
	AliasSource                 string `json:"alias_source"`
	RawDatasetPath              string `json:"raw_dataset_path"`
	CanonicalDatasetPath        string `json:"canonical_dataset_path"`
	PublicDatasetPath           string `json:"public_dataset_path"`
	DefaultPublicAliasCandidate string `json:"default_public_alias_candidate"`
	DefaultAliasAutoReserved    bool   `json:"default_alias_auto_reserved"`
}

// AliasManagementSnapshot is the admin read-model for the alias editor surface.
type AliasManagementSnapshot struct {
	Datasets                        []AliasManagementEntry `json:"datasets"`
	SystemAliasPolicyRecommendation string                 `json:"system_alias_policy_recommendation"`
}

// AliasValidationError keeps handler error mapping predictable for alias editor input failures.
type AliasValidationError struct {
	Message string
}

func (e *AliasValidationError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

type datasetAliasTableMetadata struct {
	TableUID    int
	DatasetName string
}

const systemAliasPolicyRecommendation = "Recommendation: keep stripped system_ aliases opt-in and explicitly reviewed. Many system_* datasets are internal or operator-facing, so raw system_* URLs should stay the default unless the dataset is intentionally user-facing."

// SystemAliasPolicyRecommendation returns the canonical recommendation shown in docs and admin UI.
func SystemAliasPolicyRecommendation() string {
	return systemAliasPolicyRecommendation
}

// LoadDatasetAliasManagementSnapshot returns the alias editor read-model for every dataset.
func LoadDatasetAliasManagementSnapshot(q dbutils.Querier) (AliasManagementSnapshot, error) {
	if isNilQuerier(q) {
		return AliasManagementSnapshot{}, fmt.Errorf("dataset alias management requires a database querier")
	}

	registry, _ := LoadAliasRegistry(q)

	storedAliases, err := loadStoredPrimaryAliasMap(q)
	if err != nil {
		return AliasManagementSnapshot{}, err
	}

	tableMetadata, err := loadDatasetAliasTableMetadata(q)
	if err != nil {
		return AliasManagementSnapshot{}, err
	}

	entries := make([]AliasManagementEntry, 0, len(tableMetadata))
	for _, table := range tableMetadata {
		effectiveAlias := strings.TrimSpace(registry.RawToPublic[table.DatasetName])
		storedAlias := strings.TrimSpace(storedAliases[table.DatasetName])
		entries = append(entries, buildAliasManagementEntry(table, storedAlias, effectiveAlias))
	}

	return AliasManagementSnapshot{
		Datasets:                        entries,
		SystemAliasPolicyRecommendation: SystemAliasPolicyRecommendation(),
	}, nil
}

// SavePrimaryAlias creates, replaces, or clears the current primary active alias for one dataset.
func SavePrimaryAlias(q dbutils.Querier, datasetName string, aliasSlug string) (AliasManagementEntry, error) {
	if isNilQuerier(q) {
		return AliasManagementEntry{}, fmt.Errorf("dataset alias save requires a database querier")
	}

	datasetName = strings.TrimSpace(datasetName)
	if datasetName == "" {
		return AliasManagementEntry{}, &AliasValidationError{Message: "dataset_name is required"}
	}

	normalizedAlias := normalizeAliasSlug(aliasSlug)
	tableUID, err := loadDatasetAliasTableUID(q, datasetName)
	if err != nil {
		return AliasManagementEntry{}, err
	}
	if err := ValidateExplicitDatasetAliasAvailability(q, datasetName, normalizedAlias); err != nil {
		return AliasManagementEntry{}, err
	}

	if normalizedAlias == "" {
		if err := deletePrimaryAliasRowsForTable(q, tableUID); err != nil {
			return AliasManagementEntry{}, err
		}
	} else {
		if err := upsertPrimaryAliasRow(q, tableUID, datasetName, normalizedAlias); err != nil {
			return AliasManagementEntry{}, err
		}
	}

	snapshot, err := LoadDatasetAliasManagementSnapshot(q)
	if err != nil {
		return AliasManagementEntry{}, err
	}

	return findAliasManagementEntry(snapshot, datasetName)
}

// ValidateExplicitDatasetAliasAvailability rejects invalid or conflicting alias slugs.
func ValidateExplicitDatasetAliasAvailability(q dbutils.Querier, ownerTableName string, aliasSlug string) error {
	ownerTableName = strings.TrimSpace(ownerTableName)
	aliasSlug = normalizeAliasSlug(aliasSlug)

	if aliasSlug == "" {
		return nil
	}
	if ownerTableName == "" {
		return &AliasValidationError{Message: "dataset_name is required"}
	}
	if aliasSlug == ownerTableName {
		return &AliasValidationError{Message: "alias_slug matches the raw dataset route; leave it empty to keep the raw URL"}
	}
	if !datasetAliasSlugPattern.MatchString(aliasSlug) {
		return &AliasValidationError{Message: "alias_slug must use lowercase letters, numbers, underscores, or hyphens"}
	}

	registry, err := LoadAliasRegistry(q)
	if err != nil {
		return err
	}
	if err := ensureRouteSegmentAvailable(q, registry, ownerTableName, aliasSlug, 0, "dataset alias"); err != nil {
		return err
	}

	automaticAppOwner, err := findAutomaticAppAliasOwner(q, aliasSlug)
	if err != nil {
		return err
	}
	if automaticAppOwner != "" && automaticAppOwner != ownerTableName {
		return &RouteConflictError{
			Segment: aliasSlug,
			Reason:  fmt.Sprintf("dataset alias conflicts with the default public alias for %q", automaticAppOwner),
		}
	}

	return nil
}

func buildAliasManagementEntry(
	table datasetAliasTableMetadata,
	storedAlias string,
	effectiveAlias string,
) AliasManagementEntry {
	storedAlias = strings.TrimSpace(storedAlias)
	effectiveAlias = strings.TrimSpace(effectiveAlias)
	if effectiveAlias == table.DatasetName {
		effectiveAlias = ""
	}

	defaultAliasCandidate, _ := DefaultPublicDatasetAliasCandidate(table.DatasetName)
	canonicalSegment := table.DatasetName
	publicDatasetPath := ""
	aliasSource := aliasSourceRawOnly

	switch {
	case storedAlias != "":
		aliasSource = aliasSourceDatabase
	case isHistoricalCodeFallbackAlias(table.DatasetName, effectiveAlias):
		aliasSource = aliasSourceFallback
	case effectiveAlias != "":
		aliasSource = aliasSourceAutomaticApp
	}

	if effectiveAlias != "" {
		canonicalSegment = effectiveAlias
		publicDatasetPath = "/" + effectiveAlias
	}

	return AliasManagementEntry{
		DatasetName:                 table.DatasetName,
		TableUID:                    table.TableUID,
		StoredPrimaryAlias:          storedAlias,
		EffectivePublicAlias:        effectiveAlias,
		AliasSource:                 aliasSource,
		RawDatasetPath:              "/" + table.DatasetName,
		CanonicalDatasetPath:        "/" + canonicalSegment,
		PublicDatasetPath:           publicDatasetPath,
		DefaultPublicAliasCandidate: defaultAliasCandidate,
		DefaultAliasAutoReserved:    EnforcesAutomaticPublicAlias(table.DatasetName),
	}
}

func isHistoricalCodeFallbackAlias(tableName string, aliasSlug string) bool {
	return strings.TrimSpace(fallbackRawToPublicDatasetAlias[tableName]) == strings.TrimSpace(aliasSlug)
}

func findAliasManagementEntry(snapshot AliasManagementSnapshot, datasetName string) (AliasManagementEntry, error) {
	for _, entry := range snapshot.Datasets {
		if entry.DatasetName == datasetName {
			return entry, nil
		}
	}
	return AliasManagementEntry{}, sql.ErrNoRows
}

func loadStoredPrimaryAliasMap(q dbutils.Querier) (map[string]string, error) {
	rows, err := q.Query(
		`SELECT t.table_name, a.alias_slug
		   FROM system_db_table_aliases a
		   JOIN system_db_tables t ON t.table_uid = a.table_uid
		  WHERE a.is_active IS TRUE
		    AND a.is_primary IS TRUE`,
	)
	if err != nil {
		if isMissingAliasTableError(err) {
			return map[string]string{}, nil
		}
		return nil, fmt.Errorf("load stored dataset aliases: %w", err)
	}
	defer rows.Close()

	storedAliases := make(map[string]string)
	for rows.Next() {
		var datasetName string
		var aliasSlug string
		if err := rows.Scan(&datasetName, &aliasSlug); err != nil {
			return nil, fmt.Errorf("scan stored dataset aliases: %w", err)
		}
		storedAliases[datasetName] = aliasSlug
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate stored dataset aliases: %w", err)
	}

	return storedAliases, nil
}

func loadDatasetAliasTableMetadata(q dbutils.Querier) ([]datasetAliasTableMetadata, error) {
	rows, err := q.Query(
		`SELECT table_uid, table_name
		   FROM system_db_tables
		  ORDER BY table_name`,
	)
	if err != nil {
		return nil, fmt.Errorf("load dataset alias table metadata: %w", err)
	}
	defer rows.Close()

	var tables []datasetAliasTableMetadata
	for rows.Next() {
		var table datasetAliasTableMetadata
		if err := rows.Scan(&table.TableUID, &table.DatasetName); err != nil {
			return nil, fmt.Errorf("scan dataset alias table metadata: %w", err)
		}
		tables = append(tables, table)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate dataset alias table metadata: %w", err)
	}

	return tables, nil
}

func loadDatasetAliasTableUID(q dbutils.Querier, datasetName string) (int, error) {
	var tableUID int
	if err := q.QueryRow(
		`SELECT table_uid
		   FROM system_db_tables
		  WHERE table_name = $1`,
		datasetName,
	).Scan(&tableUID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, sql.ErrNoRows
		}
		return 0, fmt.Errorf("load dataset alias table_uid for %q: %w", datasetName, err)
	}
	return tableUID, nil
}

func deletePrimaryAliasRowsForTable(q dbutils.Querier, tableUID int) error {
	if _, err := q.Exec(
		`DELETE FROM system_db_table_aliases
		  WHERE table_uid = $1
		    AND is_primary IS TRUE`,
		tableUID,
	); err != nil {
		return wrapAliasPersistenceError("clear dataset alias", err)
	}
	return nil
}

func upsertPrimaryAliasRow(q dbutils.Querier, tableUID int, datasetName string, aliasSlug string) error {
	if _, err := q.Exec(
		`DELETE FROM system_db_table_aliases
		  WHERE table_uid = $1
		    AND is_primary IS TRUE
		    AND alias_slug <> $2`,
		tableUID,
		aliasSlug,
	); err != nil {
		return wrapAliasPersistenceError("replace dataset alias", err)
	}

	var existingDatasetName string
	err := q.QueryRow(
		`SELECT t.table_name
		   FROM system_db_table_aliases a
		   JOIN system_db_tables t ON t.table_uid = a.table_uid
		  WHERE a.alias_slug = $1`,
		aliasSlug,
	).Scan(&existingDatasetName)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		_, execErr := q.Exec(
			`INSERT INTO system_db_table_aliases (
			       table_uid,
			       alias_slug,
			       is_primary,
			       is_active
			   ) VALUES ($1, $2, TRUE, TRUE)`,
			tableUID,
			aliasSlug,
		)
		if execErr != nil {
			return wrapAliasPersistenceError("insert dataset alias", execErr)
		}
		return nil
	case err != nil:
		return wrapAliasPersistenceError("check dataset alias ownership", err)
	}

	if existingDatasetName != datasetName {
		return &RouteConflictError{
			Segment: aliasSlug,
			Reason:  fmt.Sprintf("dataset alias already belongs to %q", existingDatasetName),
		}
	}

	if _, err := q.Exec(
		`UPDATE system_db_table_aliases
		    SET is_primary = TRUE,
		        is_active = TRUE,
		        updated = NOW()
		  WHERE alias_slug = $1`,
		aliasSlug,
	); err != nil {
		return wrapAliasPersistenceError("activate dataset alias", err)
	}

	return nil
}

func wrapAliasPersistenceError(action string, err error) error {
	if err == nil {
		return nil
	}
	if isMissingAliasTableError(err) {
		return fmt.Errorf("%s: system_db_table_aliases is not available", action)
	}
	return fmt.Errorf("%s: %w", action, err)
}

func findAutomaticAppAliasOwner(q dbutils.Querier, aliasSlug string) (string, error) {
	if aliasSlug == "" {
		return "", nil
	}

	var datasetName string
	err := q.QueryRow(
		`SELECT table_name
		   FROM system_db_tables
		  WHERE table_name = $1
		  LIMIT 1`,
		"app_"+aliasSlug,
	).Scan(&datasetName)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("check automatic app alias owner for %q: %w", aliasSlug, err)
	}
	return datasetName, nil
}

func normalizeAliasSlug(aliasSlug string) string {
	return strings.ToLower(strings.TrimSpace(aliasSlug))
}
