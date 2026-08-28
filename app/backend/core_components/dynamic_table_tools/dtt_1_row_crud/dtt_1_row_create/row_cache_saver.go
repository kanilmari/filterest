// row_cache_saver.go
// Saves cached values after row insertion and propagates them to cache targets.
// Bridges the FK relations config and cache target tables with post-insert value propagation.
// Exists to update filename columns in child rows and refresh FK cache entries after inserts.
package dtt_1_row_create

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/lib/pq"
)

// updateFilenameInChildRow tekee pienen UPDATE-lauseen tallentaakseen
// uuden tiedostonimen lapsirivin "filename"-sarakkeeseen.
// Between: saveUploadedFiles -> Database
// Why: Updates the filename column in the child row after file upload.
func updateFilenameInChildRow(q queryExecer, childTableName string, childRowID int64, newFileName string) error {
	updateQ := fmt.Sprintf(`UPDATE %s SET filename=$1 WHERE id=$2`, pq.QuoteIdentifier(childTableName))
	if _, err := q.Exec(updateQ, newFileName, childRowID); err != nil {
		fmt.Printf("\033[31merror: filename update failed for table=%s, id=%d: %s\033[0m\n", childTableName, childRowID, err.Error())
		return fmt.Errorf("update filename for table=%s id=%d: %w", childTableName, childRowID, err)
	}
	return nil
}

// updateCacheTargets (transaktion sisällä) – kutsuu yhteistä base-funktiota.
// Between: insertSingleChildRow -> updateCacheTargetsBase
// Why: Wrapper for updateCacheTargetsBase using a transaction.
func updateCacheTargets(
	tx *sql.Tx,
	sourceTable string,
	sourceColumn string,
	childData map[string]interface{},
) error {
	return updateCacheTargetsBase(tx, sourceTable, sourceColumn, childData)
}

// updateCacheTargetsNoTx (transaktion ulkopuolella) – kutsuu samaa base-funktiota,
// mutta käyttää *sql.DB-olion sijaan.
// Between: saveUploadedFiles -> updateCacheTargetsBase
// Why: Wrapper for updateCacheTargetsBase using a DB connection (no transaction).
func updateCacheTargetsNoTx(q queryExecer,
	sourceTable string,
	sourceColumn string,
	childData map[string]interface{},
) error {
	return updateCacheTargetsBase(q, sourceTable, sourceColumn, childData)
}

// updateCacheTargetsBase sisältää varsinaisen logiikan. Sitä ajetaan joko tx:n tai db:n kautta.
// Between: updateCacheTargets/updateCacheTargetsNoTx -> Database
// Why: Updates cached values in other tables based on system_foreign_key_relations_1_m configuration.
func updateCacheTargetsBase(
	db queryExecer,
	sourceTable string,
	sourceColumn string,
	childData map[string]interface{},
) error {

	query := `
               SELECT fr.target_insert_specs,
                      s_tgt.table_name AS target_table_name,
                      fr.target_column_name
               FROM system_foreign_key_relations_1_m fr
               JOIN system_db_tables s_src ON s_src.table_uid = fr.source_table_uid
               JOIN system_db_tables s_tgt ON s_tgt.table_uid = fr.target_table_uid
               WHERE s_src.table_name = $1
                 AND fr.source_column_name = $2
               LIMIT 1
       `
	var targetInsertSpecs string
	var targetTableName string
	var targetColumnName string

	err := db.QueryRow(query, sourceTable, sourceColumn).Scan(
		&targetInsertSpecs, &targetTableName, &targetColumnName,
	)
	if err != nil {
		// Ei välttämättä ole riviä => ei tarvitse päivittää mitään
		return nil
	}
	if targetInsertSpecs == "" {
		return nil
	}

	var specs map[string]interface{}
	if err := json.Unmarshal([]byte(targetInsertSpecs), &specs); err != nil {
		return err
	}

	fileUpload, ok := specs["file_upload"].(map[string]interface{})
	if !ok {
		return nil
	}
	filenameColumn, _ := fileUpload["filename_column"].(string)
	if filenameColumn == "" {
		return nil
	}
	rawFilename, ok := childData[filenameColumn]
	if !ok {
		return nil
	}
	filenameStr, ok := rawFilename.(string)
	if !ok || filenameStr == "" {
		return nil
	}

	cacheTargets, ok := fileUpload["cache_targets"].([]interface{})
	if !ok {
		return nil
	}

	referencingValue, refOk := childData[sourceColumn]
	if !refOk {
		return nil
	}

	// Kahlataan jokainen cacheTargets ja ajetaan UPDATE-lauseet
	for _, target := range cacheTargets {
		targetObj, _ := target.(map[string]interface{})
		targetTblName, _ := targetObj["table"].(string)
		targetColName, _ := targetObj["column"].(string)
		if targetTblName == "" || targetColName == "" {
			continue
		}

		updateQuery := fmt.Sprintf(
			`UPDATE %s SET %s = $1 WHERE %s = $2`,
			pq.QuoteIdentifier(targetTblName),
			pq.QuoteIdentifier(targetColName),
			pq.QuoteIdentifier(targetColumnName),
		)

		if _, execErr := db.Exec(updateQuery, filenameStr, referencingValue); execErr != nil {
			return fmt.Errorf("\033[31merror: cache update error table=%s col=%s: %v\033[0m",
				targetTblName, targetColName, execErr)
		}
	}

	return nil
}
