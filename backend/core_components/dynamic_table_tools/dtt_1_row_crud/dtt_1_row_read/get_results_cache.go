// get_results_cache.go
// In-memory TTL cache for GetResults metadata queries (schema, permissions, settings, config).
// Bridges the metadata database and the get-results handler to cut round-trips from ~12 to 1.
// Exists to avoid repeated metadata queries on infinite-scroll batches using RWMutex + TTL tiers.
// TTL tiers: schema/config/existence use 5 min, permissions 30 s, user settings 2 min.
// Schema and dataset-existence caches are explicitly invalidated on DDL-sensitive changes.
package dtt_1_row_read

import (
	"fmt"
	"sync"
	"time"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

// =============================================================
// Cache entry types
// =============================================================

type schemaCacheEntry struct {
	columnDataTypes map[string]interface{}
	columnsMap      map[int]dtt_models.ColumnInfo
	tableMeta       dtt_models.TableReadMeta
	geomCols        []string
	geomSrcs        []string
	readPolicy      ReadRowPolicy
	cachedAt        time.Time
}

type permCacheEntry struct {
	columns  []string
	cachedAt time.Time
}

type ucsCacheEntry struct {
	settings []UserColumnSetting
	cachedAt time.Time
}

type configCacheEntry struct {
	resultsPerLoad int
	cachedAt       time.Time
}

type existsCacheEntry struct {
	exists   bool
	cachedAt time.Time
}

// =============================================================
// Cache stores + mutexes
// =============================================================

var (
	schemaCache   = make(map[string]*schemaCacheEntry)
	schemaCacheMu sync.RWMutex
	schemaTTL     = 5 * time.Minute

	permCache   = make(map[string]*permCacheEntry)
	permCacheMu sync.RWMutex
	permTTL     = 30 * time.Second

	ucsCache   = make(map[string]*ucsCacheEntry)
	ucsCacheMu sync.RWMutex
	ucsTTL     = 2 * time.Minute

	configCache   = make(map[string]*configCacheEntry)
	configCacheMu sync.RWMutex
	configTTL     = 5 * time.Minute

	existsCache   = make(map[string]*existsCacheEntry)
	existsCacheMu sync.RWMutex
	existsTTL     = 5 * time.Minute
)

// =============================================================
// Schema cache
// =============================================================

func getCachedSchemaMetadata(tableName string) *schemaCacheEntry {
	key := "schema|" + tableName
	schemaCacheMu.RLock()
	entry, ok := schemaCache[key]
	schemaCacheMu.RUnlock()
	if !ok || time.Since(entry.cachedAt) >= schemaTTL {
		return nil
	}
	return entry
}

func setCachedSchemaMetadata(tableName string, entry *schemaCacheEntry) {
	key := "schema|" + tableName
	schemaCacheMu.Lock()
	schemaCache[key] = entry
	schemaCacheMu.Unlock()
}

// InvalidateSchemaCache removes cached schema metadata for a table.
// Called from ModifyColumnsHandler, DropTableHandler, etc.
func InvalidateSchemaCache(tableName string) {
	key := "schema|" + tableName
	schemaCacheMu.Lock()
	delete(schemaCache, key)
	schemaCacheMu.Unlock()
}

// =============================================================
// Permissions cache
// =============================================================

func getCachedPermissions(userRole, tableName string) *permCacheEntry {
	key := fmt.Sprintf("perm|%s|%s", userRole, tableName)
	permCacheMu.RLock()
	entry, ok := permCache[key]
	permCacheMu.RUnlock()
	if !ok || time.Since(entry.cachedAt) >= permTTL {
		return nil
	}
	return entry
}

func setCachedPermissions(userRole, tableName string, entry *permCacheEntry) {
	key := fmt.Sprintf("perm|%s|%s", userRole, tableName)
	permCacheMu.Lock()
	permCache[key] = entry
	permCacheMu.Unlock()
}

// =============================================================
// User column settings cache
// =============================================================

func getCachedUserColumnSettings(userID int, tableName string) *ucsCacheEntry {
	key := fmt.Sprintf("ucs|%d|%s", userID, tableName)
	ucsCacheMu.RLock()
	entry, ok := ucsCache[key]
	ucsCacheMu.RUnlock()
	if !ok || time.Since(entry.cachedAt) >= ucsTTL {
		return nil
	}
	return entry
}

func setCachedUserColumnSettings(userID int, tableName string, entry *ucsCacheEntry) {
	key := fmt.Sprintf("ucs|%d|%s", userID, tableName)
	ucsCacheMu.Lock()
	ucsCache[key] = entry
	ucsCacheMu.Unlock()
}

// =============================================================
// Config cache
// =============================================================

func getCachedConfig(configKey string) *configCacheEntry {
	configCacheMu.RLock()
	entry, ok := configCache[configKey]
	configCacheMu.RUnlock()
	if !ok || time.Since(entry.cachedAt) >= configTTL {
		return nil
	}
	return entry
}

func setCachedConfig(configKey string, entry *configCacheEntry) {
	configCacheMu.Lock()
	configCache[configKey] = entry
	configCacheMu.Unlock()
}

// =============================================================
// Dataset existence cache
// =============================================================

func getCachedDatasetExists(tableName string) *existsCacheEntry {
	key := "exists|" + tableName
	existsCacheMu.RLock()
	entry, ok := existsCache[key]
	existsCacheMu.RUnlock()
	if !ok || time.Since(entry.cachedAt) >= existsTTL {
		return nil
	}
	return entry
}

func setCachedDatasetExists(tableName string, entry *existsCacheEntry) {
	key := "exists|" + tableName
	existsCacheMu.Lock()
	existsCache[key] = entry
	existsCacheMu.Unlock()
}

// InvalidateDatasetExistsCache removes the existence cache for a table.
// Called from DropTableHandler, ModifyColumnsHandler, etc.
func InvalidateDatasetExistsCache(tableName string) {
	key := "exists|" + tableName
	existsCacheMu.Lock()
	delete(existsCache, key)
	existsCacheMu.Unlock()
}

// =============================================================
// Periodic cleanup goroutine
// =============================================================

func init() {
	go cleanupResultsCaches()
}

func cleanupResultsCaches() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now()

		schemaCacheMu.Lock()
		for k, v := range schemaCache {
			if now.Sub(v.cachedAt) >= schemaTTL {
				delete(schemaCache, k)
			}
		}
		schemaCacheMu.Unlock()

		permCacheMu.Lock()
		for k, v := range permCache {
			if now.Sub(v.cachedAt) >= permTTL {
				delete(permCache, k)
			}
		}
		permCacheMu.Unlock()

		ucsCacheMu.Lock()
		for k, v := range ucsCache {
			if now.Sub(v.cachedAt) >= ucsTTL {
				delete(ucsCache, k)
			}
		}
		ucsCacheMu.Unlock()

		configCacheMu.Lock()
		for k, v := range configCache {
			if now.Sub(v.cachedAt) >= configTTL {
				delete(configCache, k)
			}
		}
		configCacheMu.Unlock()

		existsCacheMu.Lock()
		for k, v := range existsCache {
			if now.Sub(v.cachedAt) >= existsTTL {
				delete(existsCache, k)
			}
		}
		existsCacheMu.Unlock()
	}
}
