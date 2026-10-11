// dataset_name_pools.go
// Builds canonical names, current active aliases and preferred names for datasets.
// Bridges the existing server naming policy and the readable catalogue handler.
// Keeps schema identities and alias ownership by UID before viewer filtering.
package dataset_routes

import (
	"easelect/backend/core_components/dbutils"
	"fmt"
	"sort"
)

// DatasetNamePool is the server-owned naming projection of one stable dataset.
type DatasetNamePool struct {
	TableUID      int
	DatasetName   string
	SchemaName    string
	Names         []string
	PreferredName string
}

type datasetNamePoolTable struct {
	TableUID    int
	DatasetName string
	SchemaName  string
}

type datasetNamePoolAlias struct {
	Name    string
	Primary bool
}

// LoadDatasetNamePools builds complete current pools without applying viewer
// permissions. Ownership includes every schema; document routes and catalogue
// callers select readable public-schema identities, never return this global map.
// Lifecycle persistence and legacy-conflict notices belong to the namespace slice.
func LoadDatasetNamePools(q dbutils.Querier) (map[int]DatasetNamePool, error) {
	if isNilQuerier(q) {
		return nil, fmt.Errorf("dataset name pools require a database querier")
	}
	tables, err := loadDatasetNamePoolTables(q)
	if err != nil {
		return nil, err
	}
	rows, err := q.Query(`SELECT table_uid, alias_slug, COALESCE(is_primary, false)
		FROM system_db_table_aliases
		WHERE is_active IS TRUE`)
	if err != nil && !isMissingAliasTableError(err) {
		return nil, fmt.Errorf("load active dataset names: %w", err)
	}
	aliases := make(map[int][]datasetNamePoolAlias)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var uid int
			var alias datasetNamePoolAlias
			if err := rows.Scan(&uid, &alias.Name, &alias.Primary); err != nil {
				return nil, err
			}
			aliases[uid] = append(aliases[uid], alias)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return buildDatasetNamePools(tables, aliases), nil
}

func loadDatasetNamePoolTables(q dbutils.Querier) ([]datasetNamePoolTable, error) {
	rows, err := q.Query(`SELECT table_uid, table_name,
		COALESCE(NULLIF(schema_name, ''), 'public') AS schema_name
		FROM system_db_tables ORDER BY table_name`)
	if err != nil {
		return nil, fmt.Errorf("load dataset name identities: %w", err)
	}
	defer rows.Close()
	var tables []datasetNamePoolTable
	for rows.Next() {
		var table datasetNamePoolTable
		if err := rows.Scan(&table.TableUID, &table.DatasetName, &table.SchemaName); err != nil {
			return nil, fmt.Errorf("scan dataset name identity: %w", err)
		}
		tables = append(tables, table)
	}
	return tables, rows.Err()
}

func buildDatasetNamePools(tables []datasetNamePoolTable, active map[int][]datasetNamePoolAlias) map[int]DatasetNamePool {
	canonicalOwners := make(map[string]int, len(tables))
	aliasOwners := make(map[string]int)
	preferred := make(map[int]string, len(tables))
	for _, table := range tables {
		if owner, exists := canonicalOwners[table.DatasetName]; exists && owner != table.TableUID {
			canonicalOwners[table.DatasetName] = 0 // Multiple schemas still reserve the real name.
		} else if !exists {
			canonicalOwners[table.DatasetName] = table.TableUID
		}
	}
	// Ambiguous aliases are omitted rather than choosing an owner by iteration
	// order or by the viewer's permissions. Real names always retain ownership.
	for _, table := range tables {
		var candidates []string
		for _, alias := range active[table.TableUID] {
			candidates = append(candidates, alias.Name)
			if alias.Primary && alias.Name != "" && (preferred[table.TableUID] == "" || alias.Name < preferred[table.TableUID]) {
				preferred[table.TableUID] = alias.Name
			}
		}
		if preferred[table.TableUID] == "" {
			candidate := fallbackRawToPublicDatasetAlias[table.DatasetName]
			if candidate == "" && EnforcesAutomaticPublicAlias(table.DatasetName) {
				candidate, _ = DefaultPublicDatasetAliasCandidate(table.DatasetName)
			}
			preferred[table.TableUID] = candidate
			candidates = append(candidates, candidate)
		}
		for _, alias := range candidates {
			if _, realName := canonicalOwners[alias]; alias == "" || realName {
				continue
			}
			if owner, exists := aliasOwners[alias]; exists && owner != table.TableUID {
				aliasOwners[alias] = 0
			} else if !exists {
				aliasOwners[alias] = table.TableUID
			}
		}
	}
	acceptedAliases := make(map[int][]string)
	for alias, owner := range aliasOwners {
		if _, reserved := reservedDatasetRouteSegments[alias]; !reserved && owner > 0 {
			acceptedAliases[owner] = append(acceptedAliases[owner], alias)
		}
	}
	pools := make(map[int]DatasetNamePool, len(tables))
	for _, table := range tables {
		pool := DatasetNamePool{TableUID: table.TableUID, DatasetName: table.DatasetName, SchemaName: table.SchemaName,
			Names: []string{table.DatasetName}, PreferredName: table.DatasetName}
		for _, alias := range acceptedAliases[table.TableUID] {
			pool.Names = append(pool.Names, alias)
			if preferred[table.TableUID] == alias {
				pool.PreferredName = alias
			}
		}
		sort.Strings(pool.Names[1:])
		pools[table.TableUID] = pool
	}
	return pools
}
