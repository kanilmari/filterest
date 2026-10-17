// build_joins_1m.go
// Builds LEFT JOIN clauses for FK display columns in dynamic table queries.
// Bridges FK metadata and the SQL query builder with display-column resolution.
// Exists to automatically join referenced tables so FK columns show human-readable values.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"log"
	"maps"
	"strings"
	"sync"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/runtime_grant_mutations"
	"github.com/lib/pq"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

type rowQueryer interface {
	QueryRow(query string, args ...interface{}) *sql.Row
}

const joinMetadataCacheTTL = 5 * time.Minute

type joinMetadataCacheEntry struct {
	tableUID     string
	fkRelations  map[string]OneMRelation
	foreignKeys  map[string]dtt_utils.ForeignKey
	titleTargets map[string]recordTitleTargetMetadata
	actorColumns row_mutation_policy.RowActorColumns
	cachedAt     time.Time
}

var joinMetadataCache = struct {
	mu         sync.RWMutex
	byTable    map[string]joinMetadataCacheEntry
	generation uint64
}{
	byTable: map[string]joinMetadataCacheEntry{},
}

func init() {
	// Generic metadata CRUD and CSV imports commit through the grant boundary;
	// dedicated column/settings saves use InvalidateSchemaCache instead.
	runtime_grant_mutations.RegisterMetadataCacheInvalidator(invalidateJoinMetadataCache)
}

// getTableUID returns system_db_tables.table_uid for the given table name.
func getTableUID(tableName string, q rowQueryer) (string, error) {
	var uid string
	err := q.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name = $1`, tableName).Scan(&uid)
	if err != nil {
		return "", err
	}
	return uid, nil
}

func cloneOneMRelationMap(source map[string]OneMRelation) map[string]OneMRelation {
	if source == nil {
		return nil
	}

	cloned := make(map[string]OneMRelation, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func cloneForeignKeyMap(source map[string]dtt_utils.ForeignKey) map[string]dtt_utils.ForeignKey {
	if source == nil {
		return nil
	}

	cloned := make(map[string]dtt_utils.ForeignKey, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func cloneJoinMetadataCacheEntry(source joinMetadataCacheEntry) joinMetadataCacheEntry {
	return joinMetadataCacheEntry{
		tableUID:     source.tableUID,
		fkRelations:  cloneOneMRelationMap(source.fkRelations),
		foreignKeys:  cloneForeignKeyMap(source.foreignKeys),
		titleTargets: maps.Clone(source.titleTargets),
		actorColumns: maps.Clone(source.actorColumns),
		cachedAt:     source.cachedAt,
	}
}

func getCachedJoinMetadata(tableName string) (joinMetadataCacheEntry, bool) {
	normalizedTableName := strings.TrimSpace(tableName)
	if normalizedTableName == "" {
		return joinMetadataCacheEntry{}, false
	}

	joinMetadataCache.mu.RLock()
	entry, found := joinMetadataCache.byTable[normalizedTableName]
	joinMetadataCache.mu.RUnlock()
	if !found {
		return joinMetadataCacheEntry{}, false
	}
	if time.Since(entry.cachedAt) >= joinMetadataCacheTTL {
		return joinMetadataCacheEntry{}, false
	}

	return cloneJoinMetadataCacheEntry(entry), true
}

func joinMetadataGeneration() uint64 {
	joinMetadataCache.mu.RLock()
	defer joinMetadataCache.mu.RUnlock()
	return joinMetadataCache.generation
}

func setCachedJoinMetadataAtGeneration(tableName string, entry joinMetadataCacheEntry, generation uint64) {
	normalizedTableName := strings.TrimSpace(tableName)
	if normalizedTableName == "" {
		return
	}

	entry.cachedAt = time.Now()
	joinMetadataCache.mu.Lock()
	defer joinMetadataCache.mu.Unlock()
	// The lookup may have started before a target's metadata save committed.
	// Check and store under the invalidator's lock so it cannot restore old facts.
	if generation != joinMetadataCache.generation {
		return
	}
	joinMetadataCache.byTable[normalizedTableName] = cloneJoinMetadataCacheEntry(entry)
}

func loadJoinMetadata(
	db dbutils.Querier,
	tableName string,
) (joinMetadataCacheEntry, error) {
	generation := joinMetadataGeneration()
	tableUID, err := getTableUID(tableName, db)
	if err != nil {
		return joinMetadataCacheEntry{}, fmt.Errorf("getTableUID failed: %w", err)
	}
	// A dropped dataset's name can be reused before this cache expires. Its
	// actor marks belong to the old table_uid and must not govern the new one.
	if cached, found := getCachedJoinMetadata(tableName); found && cached.tableUID == tableUID {
		return cached, nil
	}

	fkRelations, err := fetchForeignKeyRelations(db, tableUID)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return joinMetadataCacheEntry{}, err
	}

	foreignKeys, err := dtt_utils.GetForeignKeysForTable(tableName)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return joinMetadataCacheEntry{}, err
	}

	actorColumns, err := row_mutation_policy.ReadRowActorColumns(db, tableName)
	if err != nil {
		return joinMetadataCacheEntry{}, err
	}
	// Read schema facts independently of the request role, like FK resolution.
	// Only title annotation uses them; authorization is resolved per request below.
	metadataDB := db
	if backend.Db != nil {
		metadataDB = backend.Db
	}
	titleTargets, err := fetchRecordTitleAliasTargets(metadataDB, foreignKeys)
	if err != nil {
		// Unproven aliases cannot name a record; ordinary FK display still works.
		log.Printf("\033[31merror: reading relation title metadata: %v\033[0m", err)
	}
	entry := joinMetadataCacheEntry{
		tableUID:     tableUID,
		fkRelations:  fkRelations,
		foreignKeys:  foreignKeys,
		titleTargets: titleTargets,
		actorColumns: actorColumns,
	}
	setCachedJoinMetadataAtGeneration(tableName, entry, generation)

	return cloneJoinMetadataCacheEntry(entry), nil
}

// Target facts live under referencing datasets, so a table-local eviction cannot
// find every dependent entry. Clear the bounded-lifetime join cache globally.
func invalidateJoinMetadataCache() {
	joinMetadataCache.mu.Lock()
	joinMetadataCache.byTable = map[string]joinMetadataCacheEntry{}
	joinMetadataCache.generation++
	joinMetadataCache.mu.Unlock()
}

// OneMRelation edustaa riviä system_foreign_key_relations_1_m -taulussa.
// Mukaan vain oleellisimmat sarakkeet demo-mielessä.
type OneMRelation struct {
	SourceTableName    string
	SourceColumnName   string
	TargetTableName    string
	TargetColumnName   string
	CachedNameColInSrc string
	NameColInTgt       string
	// ... mahdolliset muut kentät ...
}

// buildJoinsWith1MRelations on laajennettu versio buildJoins-funktiosta,
// joka tarkistaa, onko vierasavaimelle määritelty "välimuistettu nimi"
// system_foreign_key_relations_1_m -taulussa. Jos on, skipataan JOIN ja
// valitaan pelkkä cached_sarake. Muussa tapauksessa tehdään normaali JOIN.
func buildJoinsWith1MRelations(
	db dbutils.Querier,
	tableName string,
	columnsMap map[int]dtt_models.ColumnInfo,
	columnUids []int,
	authorization *foreignLabelAuthorization,
	argumentOffset int,
) (string, string, map[string]string, []interface{}, error) {
	metadata, err := loadJoinMetadata(db, tableName)
	if err != nil {
		return "", "", nil, nil, err
	}
	fkRelations := metadata.fkRelations
	foreignKeys := metadata.foreignKeys

	var queryArgs []interface{}
	selectColumns := ""
	joinClauses := ""
	aliasCount := make(map[string]int)
	columnExpressions := make(map[string]string)

	for _, colUid := range columnUids {
		colInfo, exists := columnsMap[colUid]
		if !exists {
			return "", "", nil, nil, fmt.Errorf(
				"column_uid %d not found in table %s",
				colUid, tableName,
			)
		}
		colName := colInfo.ColumnName
		if metadata.actorColumns[colName] != "" {
			// Group A never projects an actor's name, including cached-name
			// relations. Group B replaces this branch with the viewer rule.
			generatedColumnName := generatedForeignNameAlias(colName)
			selectColumns += fmt.Sprintf("%s.%s AS %s, NULL::text AS %s, ",
				pq.QuoteIdentifier(tableName), pq.QuoteIdentifier(colName), pq.QuoteIdentifier(colName), pq.QuoteIdentifier(generatedColumnName))
			columnExpressions[generatedColumnName] = "NULL::text"
			columnExpressions[colName] = fmt.Sprintf("%s.%s", pq.QuoteIdentifier(tableName), pq.QuoteIdentifier(colName))
			continue
		}

		// Tarkistetaan, onko colName foreignKeys-listassa:
		if fk, ok := foreignKeys[colName]; ok && fk.NameColumn != "" {

			// Katsotaan, onko meillä system_foreign_key_relations_1_m -tietuetta tälle sarakkeelle
			rel, foundRel := fkRelations[colName]
			if foundRel && rel.CachedNameColInSrc != "" {
				// Jos cached-sarake on määritelty, valitaan vain vierasavaimen arvo
				selectColumns += fmt.Sprintf("%s.%s AS %s, ",
					pq.QuoteIdentifier(tableName),
					pq.QuoteIdentifier(colName),
					pq.QuoteIdentifier(colName),
				)
				columnExpressions[colName] = fmt.Sprintf(
					"%s.%s",
					pq.QuoteIdentifier(tableName),
					pq.QuoteIdentifier(colName),
				)
			} else {
				// Jos ei ole cached-saraketta, tehdään normaali LEFT JOIN
				aliasCount[colName]++
				alias := fmt.Sprintf("%s_alias%d", colName, aliasCount[colName])
				allowed, condition, args, err := authorization.targetCondition(fk.ReferencedTable, alias, argumentOffset+len(queryArgs)+1)
				if err != nil {
					return "", "", nil, nil, err
				}
				if !allowed {
					generated := generatedForeignNameAlias(colName)
					selectColumns += fmt.Sprintf("%s.%s AS %s, NULL::text AS %s, ", pq.QuoteIdentifier(tableName), pq.QuoteIdentifier(colName), pq.QuoteIdentifier(colName), pq.QuoteIdentifier(generated))
					columnExpressions[colName] = fmt.Sprintf("%s.%s", pq.QuoteIdentifier(tableName), pq.QuoteIdentifier(colName))
					columnExpressions[generated] = "NULL::text"
					continue
				}
				queryArgs = append(queryArgs, args...)

				generatedColumnName := generatedForeignNameAlias(colName)

				fullyQualifiedColumnName := fmt.Sprintf(
					"%s.%s",
					pq.QuoteIdentifier(alias),
					pq.QuoteIdentifier(fk.NameColumn),
				)
				columnExpressions[generatedColumnName] = fullyQualifiedColumnName

				selectColumns += fmt.Sprintf("%s.%s AS %s, %s.%s AS \"%s\", ",
					pq.QuoteIdentifier(tableName),
					pq.QuoteIdentifier(colName),
					pq.QuoteIdentifier(colName),
					pq.QuoteIdentifier(alias),
					pq.QuoteIdentifier(fk.NameColumn),
					generatedColumnName,
				)

				joinClauses += fmt.Sprintf("LEFT JOIN %s AS %s ON %s.%s = %s.%s ",
					pq.QuoteIdentifier(fk.ReferencedTable),
					pq.QuoteIdentifier(alias),
					pq.QuoteIdentifier(tableName),
					pq.QuoteIdentifier(colName),
					pq.QuoteIdentifier(alias),
					pq.QuoteIdentifier(fk.ReferencedColumn),
				)
				if condition != "" {
					joinClauses += "AND (" + condition + ") "
				}
			}

		} else {
			// Ei vierasavain tai nimisaraketta => valitaan sellaisenaan
			selectColumns += fmt.Sprintf("%s.%s AS %s, ",
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(colName),
				pq.QuoteIdentifier(colName))
			columnExpressions[colName] = fmt.Sprintf("%s.%s",
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(colName))
		}
	}

	selectColumns = strings.TrimRight(selectColumns, ", ")
	return selectColumns, joinClauses, columnExpressions, queryArgs, nil
}

// lang-key-declaration: {"schema":"linked_name","build":"return alias + \" (ln)\""}

// generatedForeignNameAlias keeps actor and ordinary reference labels compatible.
func generatedForeignNameAlias(column string) string {
	alias := relatedFKDisplayAliasBase(column)
	if strings.HasSuffix(column, "_id") || strings.HasSuffix(column, "_uid") {
		return alias + " (ln)"
	}
	return alias
}

// fetchForeignKeyRelations hakee system_foreign_key_relations_1_m -taulusta rivit,
// jotka koskevat annettua lähdetaulua (source_table_uid).
func fetchForeignKeyRelations(db dbutils.Querier, sourceTableUID string) (map[string]OneMRelation, error) {
	return readForeignKeyRelations(db, sourceTableUID, false)
}

// Evidence must refuse malformed relation rows; runtime keeps its historical
// log-and-skip behavior. Both readers use the same query and conversions.
func readForeignKeyRelations(db dbutils.Querier, sourceTableUID string, strict bool) (map[string]OneMRelation, error) {
	query := `
                SELECT
                        s_src.table_name AS source_table_name,
                        fr.source_column_name,
                        s_tgt.table_name AS target_table_name,
                        fr.target_column_name,
                        COALESCE(cached_name_col_in_src, '') as cached_name_col_in_src,
                        COALESCE(name_col_in_tgt, '') as name_col_in_tgt
                FROM system_foreign_key_relations_1_m fr
                JOIN system_db_tables s_src ON s_src.table_uid = fr.source_table_uid
                JOIN system_db_tables s_tgt ON s_tgt.table_uid = fr.target_table_uid
                WHERE fr.source_table_uid = $1
        `
	rows, err := db.Query(query, sourceTableUID)
	if err != nil {
		return nil, fmt.Errorf("fetchForeignKeyRelations: %v", err)
	}
	defer rows.Close()

	result := make(map[string]OneMRelation)
	for rows.Next() {
		var r OneMRelation
		err := rows.Scan(
			&r.SourceTableName,
			&r.SourceColumnName,
			&r.TargetTableName,
			&r.TargetColumnName,
			&r.CachedNameColInSrc,
			&r.NameColInTgt,
		)
		if err != nil {
			if strict {
				return nil, fmt.Errorf("read foreign-key relation: %w", err)
			}
			log.Printf("\033[31merror: %s\033[0m\n", err.Error()) //odotetaan
			continue
		}
		// Käytetään mapin avaimena source_column_name
		result[r.SourceColumnName] = r
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}
