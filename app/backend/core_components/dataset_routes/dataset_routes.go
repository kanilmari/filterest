// dataset_routes.go
// Centralizes raw dataset names, public aliases, and route-segment conflict checks.
// Bridges router path resolution with table create/rename validation so dataset URLs stay reachable.
// Exists to keep public dataset route names stable, unique, and reversible.
package dataset_routes

import (
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
	if !isNilQuerier(q) {
		// Catalogue and document routes use the same global ownership rules,
		// including secondary aliases and canonical/ambiguous-name conflicts.
		pools, err := LoadDatasetNamePools(q)
		if err == nil {
			pool, resolutionError := ResolveDatasetNamePool(pools, datasetName)
			if resolutionError == nil {
				return pool.DatasetName
			}
			if errors.Is(resolutionError, ErrDatasetNameAmbiguous) {
				return ""
			}
			return datasetName
		}
		// A failed naming read must not reinstate aliases rejected by ownership.
		return datasetName
	}
	registry := fallbackAliasRegistry()
	if rawName, ok := registry.PublicToRaw[datasetName]; ok {
		return rawName
	}
	return datasetName
}

// ResolvePublicDatasetName returns the accepted pool's preferred address name.
func ResolvePublicDatasetName(datasetName string) string {
	return ResolvePublicDatasetNameWithQuerier(backend.Db, datasetName)
}

// ResolvePublicDatasetNameWithQuerier uses the same accepted pool as incoming
// document resolution and the catalogue, so canonical links and sitemaps agree.
func ResolvePublicDatasetNameWithQuerier(q dbutils.Querier, datasetName string) string {
	if datasetName == "" {
		return ""
	}
	if !isNilQuerier(q) {
		pools, err := LoadDatasetNamePools(q)
		if err == nil {
			for _, pool := range pools {
				if pool.SchemaName == "public" && pool.DatasetName == datasetName {
					return pool.PreferredName
				}
			}
		}
		return datasetName
	}
	registry := fallbackAliasRegistry()
	if publicName, ok := registry.RawToPublic[datasetName]; ok {
		return publicName
	}
	return datasetName
}

// LoadAliasRegistry is the legacy preferred-name projection of accepted UID pools.
// Naming ownership is decided only by LoadDatasetNamePools.
func LoadAliasRegistry(q dbutils.Querier) (AliasRegistry, error) {
	if isNilQuerier(q) {
		return fallbackAliasRegistry(), nil
	}
	pools, err := LoadDatasetNamePools(q)
	if err != nil {
		return AliasRegistry{}, err
	}
	aliases := make(map[string]string)
	for _, pool := range pools {
		if pool.SchemaName == "public" && pool.PreferredName != pool.DatasetName {
			aliases[pool.DatasetName] = pool.PreferredName
		}
	}
	return buildAliasRegistry(aliases), nil
}

// DatasetNameKey matches app_dataset_name_key and the browser catalogue index.
// Authored identifiers are ASCII; preserve non-ASCII legacy characters exactly.
func DatasetNameKey(name string) string {
	return strings.Map(func(c rune) rune {
		if c >= 'A' && c <= 'Z' {
			return c + ('a' - 'A')
		}
		return c
	}, strings.TrimSpace(name))
}

// DefaultPublicDatasetAliasCandidate returns the default stripped alias candidate for prefixed tables.
// The first enforcement slice only auto-protects naked aliases for app_ tables.
func DefaultPublicDatasetAliasCandidate(tableName string) (string, bool) {
	tableName = DatasetNameKey(tableName)
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
	return strings.HasPrefix(DatasetNameKey(tableName), "app_")
}

// ValidateDatasetRouteAvailability rejects raw dataset names and default public aliases
// that would collide with existing dataset routing.
func ValidateDatasetRouteAvailability(q dbutils.Querier, tableName string, excludeMetadataID int) error {
	if tableName == "" {
		return nil
	}

	if err := LockDatasetNamespace(q); err != nil {
		return err
	}
	_, err := q.Exec(`SELECT public.app_validate_dataset_name($1, $2)`, tableName, excludeMetadataID)
	return NamespaceError(err)
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
