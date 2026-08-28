// build_joins_1m.go
// Builds LEFT JOIN clauses for FK display columns in dynamic table queries.
// Bridges FK metadata and the SQL query builder with display-column resolution.
// Exists to automatically join referenced tables so FK columns show human-readable values.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"easelect/backend/core_components/dbutils"
	"github.com/lib/pq"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

type rowQueryer interface {
	QueryRow(query string, args ...interface{}) *sql.Row
}

const joinMetadataCacheTTL = 5 * time.Minute

type joinMetadataCacheEntry struct {
	tableUID    string
	fkRelations map[string]OneMRelation
	foreignKeys map[string]dtt_utils.ForeignKey
	cachedAt    time.Time
}

var joinMetadataCache = struct {
	mu      sync.RWMutex
	byTable map[string]joinMetadataCacheEntry
}{
	byTable: map[string]joinMetadataCacheEntry{},
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
		tableUID:    source.tableUID,
		fkRelations: cloneOneMRelationMap(source.fkRelations),
		foreignKeys: cloneForeignKeyMap(source.foreignKeys),
		cachedAt:    source.cachedAt,
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

func setCachedJoinMetadata(tableName string, entry joinMetadataCacheEntry) {
	normalizedTableName := strings.TrimSpace(tableName)
	if normalizedTableName == "" {
		return
	}

	entry.cachedAt = time.Now()
	joinMetadataCache.mu.Lock()
	joinMetadataCache.byTable[normalizedTableName] = cloneJoinMetadataCacheEntry(entry)
	joinMetadataCache.mu.Unlock()
}

func loadJoinMetadata(
	db dbutils.Querier,
	tableName string,
) (joinMetadataCacheEntry, error) {
	if cached, found := getCachedJoinMetadata(tableName); found {
		return cached, nil
	}

	tableUID, err := getTableUID(tableName, db)
	if err != nil {
		return joinMetadataCacheEntry{}, fmt.Errorf("getTableUID failed: %w", err)
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

	entry := joinMetadataCacheEntry{
		tableUID:    tableUID,
		fkRelations: fkRelations,
		foreignKeys: foreignKeys,
	}
	setCachedJoinMetadata(tableName, entry)

	return cloneJoinMetadataCacheEntry(entry), nil
}

func resetJoinMetadataCacheForTests() {
	joinMetadataCache.mu.Lock()
	joinMetadataCache.byTable = map[string]joinMetadataCacheEntry{}
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
) (string, string, map[string]string, error) {
	metadata, err := loadJoinMetadata(db, tableName)
	if err != nil {
		return "", "", nil, err
	}
	fkRelations := metadata.fkRelations
	foreignKeys := metadata.foreignKeys

	selectColumns := ""
	joinClauses := ""
	aliasCount := make(map[string]int)
	columnExpressions := make(map[string]string)

	for _, colUid := range columnUids {
		colInfo, exists := columnsMap[colUid]
		if !exists {
			return "", "", nil, fmt.Errorf(
				"column_uid %d not found in table %s",
				colUid, tableName,
			)
		}
		colName := colInfo.ColumnName

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

				generatedColumnName := colName + "_name"
				if strings.HasSuffix(colName, "_id") {
					generatedColumnName = strings.TrimSuffix(colName, "_id") + "_name (ln)"
				} else if strings.HasSuffix(colName, "_uid") {
					generatedColumnName = strings.TrimSuffix(colName, "_uid") + "_name (ln)"
				}

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
	return selectColumns, joinClauses, columnExpressions, nil
}

// fetchForeignKeyRelations hakee system_foreign_key_relations_1_m -taulusta rivit,
// jotka koskevat annettua lähdetaulua (source_table_uid).
func fetchForeignKeyRelations(db dbutils.Querier, sourceTableUID string) (map[string]OneMRelation, error) {
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
