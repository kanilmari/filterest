// dataset_routes.go
// Centralizes raw dataset names, public aliases, and route-segment conflict checks.
// Bridges router path resolution with table create/rename validation so dataset URLs stay reachable.
// Exists to keep public dataset route names stable, unique, and reversible.
package dataset_routes

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"errors"
	"fmt"
	"reflect"
	"strings"

	"github.com/lib/pq"
)

var fallbackRawToPublicDatasetAlias = map[string]string{
	"app_service_catalog": "service_catalog",
}

type AliasRegistry struct {
	RawToPublic map[string]string
	PublicToRaw map[string]string
}

func fallbackAliasRegistry() AliasRegistry {
	aliases := make(map[string]string, len(fallbackRawToPublicDatasetAlias))
	for rawName, publicName := range fallbackRawToPublicDatasetAlias {
		aliases[rawName] = publicName
	}
	return buildAliasRegistry(aliases)
}

func buildAliasRegistry(rawToPublic map[string]string) AliasRegistry {
	publicToRaw := make(map[string]string, len(rawToPublic))
	for rawName, publicName := range rawToPublic {
		publicToRaw[publicName] = rawName
	}
	return AliasRegistry{
		RawToPublic: rawToPublic,
		PublicToRaw: publicToRaw,
	}
}

var reservedDatasetRouteSegments = map[string]struct{}{
	"admin":    {},
	"api":      {},
	"apps":     {},
	"datasets": {},
	"frontend": {},
	"health":   {},
	"login":    {},
	"storage":  {},
}

type RouteConflictError struct {
	Segment string
	Reason  string
}

func (e *RouteConflictError) Error() string {
	return fmt.Sprintf("dataset route segment %q is already in use: %s", e.Segment, e.Reason)
}

// ResolveRawDatasetName maps a public alias or raw dataset name to the raw table name.
func ResolveRawDatasetName(datasetName string) string {
	return ResolveRawDatasetNameWithQuerier(backend.Db, datasetName)
}

// ResolveRawDatasetNameWithQuerier maps a public alias or raw dataset name to the raw table name.
func ResolveRawDatasetNameWithQuerier(q dbutils.Querier, datasetName string) string {
	if datasetName == "" {
		return ""
	}
	registry, err := LoadAliasRegistry(q)
	if err != nil && len(registry.RawToPublic) == 0 {
		registry = fallbackAliasRegistry()
	}
	if rawName, ok := registry.PublicToRaw[datasetName]; ok {
		return rawName
	}
	return datasetName
}

// ResolvePublicDatasetName maps a raw dataset name to its public alias when one exists.
func ResolvePublicDatasetName(datasetName string) string {
	return ResolvePublicDatasetNameWithQuerier(backend.Db, datasetName)
}

// ResolvePublicDatasetNameWithQuerier maps a raw dataset name to its public alias when one exists.
func ResolvePublicDatasetNameWithQuerier(q dbutils.Querier, datasetName string) string {
	if datasetName == "" {
		return ""
	}
	registry, err := LoadAliasRegistry(q)
	if err != nil && len(registry.RawToPublic) == 0 {
		registry = fallbackAliasRegistry()
	}
	if publicName, ok := registry.RawToPublic[datasetName]; ok {
		return publicName
	}
	return datasetName
}

// LoadAliasRegistry returns the active dataset alias registry from the DB-backed source when available.
// It merges explicit DB aliases, historical code fallbacks, and automatic app_ aliases derived
// from system_db_tables so the router and frontend share one policy source.
func LoadAliasRegistry(q dbutils.Querier) (AliasRegistry, error) {
	if isNilQuerier(q) {
		return fallbackAliasRegistry(), nil
	}

	rawToPublic := make(map[string]string, len(fallbackRawToPublicDatasetAlias))
	for rawName, publicName := range fallbackRawToPublicDatasetAlias {
		rawToPublic[rawName] = publicName
	}

	storedAliases, aliasErr := loadStoredPrimaryAliasMap(q)
	if aliasErr != nil {
		aliasErr = fmt.Errorf("load dataset alias registry: %w", aliasErr)
	}
	for rawName, publicName := range storedAliases {
		rawToPublic[rawName] = publicName
	}

	tableMetadata, tableErr := loadDatasetAliasTableMetadata(q)
	if tableErr != nil {
		registry := buildAliasRegistry(rawToPublic)
		if aliasErr != nil {
			return registry, errors.Join(aliasErr, fmt.Errorf("load dataset alias table metadata: %w", tableErr))
		}
		return registry, fmt.Errorf("load dataset alias table metadata: %w", tableErr)
	}

	appendAutomaticAppAliases(rawToPublic, tableMetadata)
	registry := buildAliasRegistry(rawToPublic)
	if aliasErr != nil {
		return registry, aliasErr
	}
	return registry, nil
}

// DefaultPublicDatasetAliasCandidate returns the default stripped alias candidate for prefixed tables.
// The first enforcement slice only auto-protects naked aliases for app_ tables.
func DefaultPublicDatasetAliasCandidate(tableName string) (string, bool) {
	for _, prefix := range []string{"app_", "system_"} {
		if strings.HasPrefix(tableName, prefix) {
			candidate := strings.TrimPrefix(tableName, prefix)
			if candidate != "" && candidate != tableName {
				return candidate, true
			}
		}
	}
	return "", false
}

// EnforcesAutomaticPublicAlias returns true when the stripped alias is part of the
// current automatic public-routing contract.
// Recommendation: keep stripped system_ aliases opt-in and explicitly reviewed in
// the admin alias editor so internal/operator datasets do not silently consume
// short public routes like "/users" or "/logs".
func EnforcesAutomaticPublicAlias(tableName string) bool {
	return strings.HasPrefix(tableName, "app_")
}

// ValidateDatasetRouteAvailability rejects raw dataset names and default public aliases
// that would collide with existing dataset routing.
func ValidateDatasetRouteAvailability(q dbutils.Querier, tableName string, excludeMetadataID int) error {
	if tableName == "" {
		return nil
	}

	registry, err := LoadAliasRegistry(q)
	if err != nil {
		return err
	}

	if err := ensureRouteSegmentAvailable(q, registry, tableName, tableName, excludeMetadataID, "dataset name"); err != nil {
		return err
	}

	defaultAlias, ok := DefaultPublicDatasetAliasCandidate(tableName)
	if !ok || !EnforcesAutomaticPublicAlias(tableName) || defaultAlias == tableName {
		return nil
	}

	return ensureRouteSegmentAvailable(q, registry, tableName, defaultAlias, excludeMetadataID, "default public alias")
}

func appendAutomaticAppAliases(rawToPublic map[string]string, tables []datasetAliasTableMetadata) {
	rawNames := make(map[string]struct{}, len(tables))
	for _, table := range tables {
		rawNames[table.DatasetName] = struct{}{}
	}

	publicOwners := make(map[string]string, len(rawToPublic))
	for rawName, publicName := range rawToPublic {
		publicOwners[publicName] = rawName
	}

	for _, table := range tables {
		if _, alreadyMapped := rawToPublic[table.DatasetName]; alreadyMapped {
			continue
		}
		if !EnforcesAutomaticPublicAlias(table.DatasetName) {
			continue
		}

		candidate, ok := DefaultPublicDatasetAliasCandidate(table.DatasetName)
		if !ok || candidate == "" || candidate == table.DatasetName {
			continue
		}
		if _, reserved := reservedDatasetRouteSegments[candidate]; reserved {
			continue
		}
		if _, rawNameConflict := rawNames[candidate]; rawNameConflict {
			continue
		}
		if owner, segmentTaken := publicOwners[candidate]; segmentTaken && owner != table.DatasetName {
			continue
		}

		rawToPublic[table.DatasetName] = candidate
		publicOwners[candidate] = table.DatasetName
	}
}

func ensureRouteSegmentAvailable(
	q dbutils.Querier,
	registry AliasRegistry,
	ownerTableName,
	segment string,
	excludeMetadataID int,
	segmentType string,
) error {
	if _, reserved := reservedDatasetRouteSegments[segment]; reserved {
		return &RouteConflictError{
			Segment: segment,
			Reason:  fmt.Sprintf("%s conflicts with a reserved top-level route", segmentType),
		}
	}

	if rawName, ok := registry.PublicToRaw[segment]; ok && rawName != ownerTableName {
		return &RouteConflictError{
			Segment: segment,
			Reason:  fmt.Sprintf("%s conflicts with the public alias for %q", segmentType, rawName),
		}
	}

	var conflictID int
	var conflictTableName string
	err := q.QueryRow(
		`SELECT id, table_name
		   FROM system_db_tables
		  WHERE table_name = $1
		    AND ($2 <= 0 OR id <> $2)
		  LIMIT 1`,
		segment,
		excludeMetadataID,
	).Scan(&conflictID, &conflictTableName)
	if err == nil {
		return &RouteConflictError{
			Segment: segment,
			Reason:  fmt.Sprintf("%s conflicts with existing dataset %q", segmentType, conflictTableName),
		}
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}

	return fmt.Errorf("check dataset route segment %q: %w", segment, err)
}

func isMissingAliasTableError(err error) bool {
	if err == nil {
		return false
	}
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == "42P01"
}

func isNilQuerier(q dbutils.Querier) bool {
	if q == nil {
		return true
	}
	value := reflect.ValueOf(q)
	switch value.Kind() {
	case reflect.Pointer, reflect.Interface, reflect.Map, reflect.Slice, reflect.Func:
		return value.IsNil()
	default:
		return false
	}
}
