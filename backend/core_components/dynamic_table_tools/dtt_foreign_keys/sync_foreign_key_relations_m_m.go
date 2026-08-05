// sync_foreign_key_relations_m_m.go
// Synchronizes many-to-many bridging tables from the PostgreSQL catalog into
// system_foreign_key_relations_m_m. Applies heuristic filters (name pattern,
// column count, two-column primary key) to identify true join tables.

package dtt_foreign_keys

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
)

type mmConstraint struct {
	BridgingTable string
	ColA          string
	TableA        string
	ColARef       string
	ColB          string
	TableB        string
	ColBRef       string
}

// SyncManyToManyFKConstraints finds bridging tables (that have exactly two foreign
// key constraints referencing two distinct tables) and synchronizes them with
// the system_foreign_key_relations_m_m table by inserting new relationships and removing
// obsolete ones.
//
// Extra filters added here:
//  1. table name must contain any of: _relation, _join, _liitos, _assoc
//  2. exactly 2 FKs that match the entire primary key
//  3. max 6 columns total in the bridging table
func SyncManyToManyFKConstraints(db *sql.DB) error {
	// log.Println("[INFO] Synchronizing many-to-many constraints...")

	// 1) Find all tables that have exactly two foreign keys referencing two distinct tables.
	query := `
	WITH all_fk_info AS (
		SELECT
			c.conname             AS constraint_name,
			t.relname             AS bridging_table,
			c.conrelid            AS bridging_table_oid,
			ft.relname            AS foreign_table,
			c.confrelid           AS foreign_table_oid,
			a.attname             AS bridging_col,
			fa.attname            AS foreign_col
		FROM pg_constraint c
		JOIN pg_class t ON c.conrelid = t.oid
		JOIN pg_namespace ns ON ns.oid = t.relnamespace
		JOIN pg_class ft ON c.confrelid = ft.oid
		JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
		JOIN pg_attribute fa ON fa.attrelid = ft.oid AND fa.attnum = ANY(c.confkey)
		WHERE c.contype = 'f'
	),
	grouped AS (
		SELECT
			bridging_table,
			json_agg(json_build_object(
				'constraint_name', constraint_name,
				'bridging_col', bridging_col,
				'foreign_table', foreign_table,
				'foreign_col', foreign_col
			) ORDER BY bridging_col) AS fks
		FROM all_fk_info
		GROUP BY bridging_table
	)
	SELECT bridging_table, fks
	FROM grouped
	WHERE json_array_length(fks) = 2
	`

	rows, err := db.Query(query)
	if err != nil {
		return fmt.Errorf("cannot query bridging tables for m–m detection: %w", err)
	}
	defer rows.Close()

	// We'll store discovered bridging relationships in a map keyed by a 7-part signature
	type fkDetail struct {
		ConstraintName string `json:"constraint_name"`
		BridgingCol    string `json:"bridging_col"`
		ForeignTable   string `json:"foreign_table"`
		ForeignCol     string `json:"foreign_col"`
	}

	discovered := make(map[string]mmConstraint)

	for rows.Next() {
		var bridgingTable string
		var fksData []byte

		if err := rows.Scan(&bridgingTable, &fksData); err != nil {
			return fmt.Errorf("cannot scan bridging data: %w", err)
		}

		var fks []fkDetail
		if err := json.Unmarshal(fksData, &fks); err != nil {
			return fmt.Errorf("cannot parse bridging fks JSON: %w", err)
		}
		if len(fks) != 2 {
			log.Printf("[INFO] Table %s was skipped because it does not have exactly 2 foreign keys. Found: %d", bridgingTable, len(fks))
			continue
		}

		mm := mmConstraint{
			BridgingTable: bridgingTable,
			ColA:          fks[0].BridgingCol,
			TableA:        fks[0].ForeignTable,
			ColARef:       fks[0].ForeignCol,
			ColB:          fks[1].BridgingCol,
			TableB:        fks[1].ForeignTable,
			ColBRef:       fks[1].ForeignCol,
		}

		qualified, reason, err2 := isLikelyM2MBridgingTable(db, mm)
		if err2 != nil {
			return fmt.Errorf("error checking bridging table %s: %w", bridgingTable, err2)
		}
		if !qualified {
			_ = reason
			// log.Printf("[INFO] Skipping table %s. Reason: %s", bridgingTable, reason)
			continue
		}

		key := fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s",
			mm.BridgingTable, mm.ColA, mm.TableA, mm.ColARef, mm.ColB, mm.TableB, mm.ColBRef,
		)
		discovered[key] = mm
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iteration error in bridging tables: %w", err)
	}

	// 2) Compare with existing rows in system_foreign_key_relations_m_m
	type existingRow struct {
		ID                int64
		BridgingTableName string
		BridgingColA      string
		BridgingColB      string
		TableAName        string
		TableAColumn      string
		TableBName        string
		TableBColumn      string
	}

	getExistingQuery := `
       SELECT
               fr.id,
               s_br.table_name AS bridging_table_name,
               fr.bridging_col_a,
               fr.bridging_col_b,
               s_a.table_name AS table_a_name,
               fr.table_a_column,
               s_b.table_name AS table_b_name,
               fr.table_b_column
       FROM system_foreign_key_relations_m_m fr
       JOIN system_db_tables s_br ON s_br.table_uid = fr.bridging_table_uid
       JOIN system_db_tables s_a  ON s_a.table_uid = fr.table_a_uid
       JOIN system_db_tables s_b  ON s_b.table_uid = fr.table_b_uid
       `

	rows2, err := db.Query(getExistingQuery)
	if err != nil {
		return fmt.Errorf("cannot query system_foreign_key_relations_m_m: %w", err)
	}
	defer rows2.Close()

	existing := make(map[string]existingRow)
	for rows2.Next() {
		var er existingRow
		err := rows2.Scan(
			&er.ID,
			&er.BridgingTableName,
			&er.BridgingColA,
			&er.BridgingColB,
			&er.TableAName,
			&er.TableAColumn,
			&er.TableBName,
			&er.TableBColumn,
		)
		if err != nil {
			return fmt.Errorf("cannot scan row from system_foreign_key_relations_m_m: %w", err)
		}
		key := fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s",
			er.BridgingTableName,
			er.BridgingColA, er.TableAName, er.TableAColumn,
			er.BridgingColB, er.TableBName, er.TableBColumn,
		)
		existing[key] = er
	}
	if err := rows2.Err(); err != nil {
		return fmt.Errorf("system_foreign_key_relations_m_m rows iteration error: %w", err)
	}

	// 3) Determine which bridging relationships to insert or delete
	var toInsert []mmConstraint
	var toDelete []int64

	for key, mm := range discovered {
		if _, ok := existing[key]; !ok {
			toInsert = append(toInsert, mm)
		}
	}
	for key, er := range existing {
		if _, ok := discovered[key]; !ok {
			toDelete = append(toDelete, er.ID)
		}
	}

	// 4) Insert new bridging relationships
	for _, mm := range toInsert {
		_, err := db.Exec(`
                        INSERT INTO system_foreign_key_relations_m_m (
                                bridging_table_name,
                                bridging_table_uid,
                                bridging_col_a,
                                bridging_col_b,
                                table_a_uid,
                                table_a_column,
                                table_b_uid,
                                table_b_column
                        )
                        VALUES (
                                $1,
                                (SELECT table_uid FROM system_db_tables WHERE table_name = $1),
                                $2, $3,
                                (SELECT table_uid FROM system_db_tables WHERE table_name = $4),
                                $5,
                                (SELECT table_uid FROM system_db_tables WHERE table_name = $6),
                                $7
                        )
                `,
			mm.BridgingTable,
			mm.ColA,
			mm.ColB,
			mm.TableA,
			mm.ColARef,
			mm.TableB,
			mm.ColBRef,
		)
		if err != nil {
			return fmt.Errorf("insert failed for bridging table %s (colA=%s, colB=%s): %w",
				mm.BridgingTable, mm.ColA, mm.ColB, err)
		}
		log.Printf("[INFO] Inserted new M–M bridging row for table '%s' -> tables '%s'/'%s'.",
			mm.BridgingTable, mm.TableA, mm.TableB)
	}

	// 5) Delete obsolete bridging relationships
	for _, id := range toDelete {
		_, err := db.Exec(`DELETE FROM system_foreign_key_relations_m_m WHERE id = $1`, id)
		if err != nil {
			return fmt.Errorf("delete failed for id=%d in system_foreign_key_relations_m_m: %w", id, err)
		}
		log.Printf("[INFO] Deleted obsolete M–M bridging row with id=%d.", id)
	}

	// 6) Done
	log.Printf("[INFO] M–M sync complete. Inserted %d, deleted %d, unchanged %d",
		len(toInsert), len(toDelete), len(existing)-len(toDelete))

	return nil
}

// isLikelyM2MBridgingTable checks a bridging table against your 3 extra conditions:
//
//  1. bridging table name contains _relation / _join / _liitos / _assoc
//  2. exactly 2 foreign keys that match the entire primary key (the two bridging columns)
//  3. max 6 columns total
//
// It returns (bool: qualified, string: reason, error).
// If qualified==false, reason describes why we skipped it.
func isLikelyM2MBridgingTable(db *sql.DB, mm mmConstraint) (bool, string, error) {
	nameLower := strings.ToLower(mm.BridgingTable)

	// 1) Name check
	if !(strings.Contains(nameLower, "_relation") ||
		strings.Contains(nameLower, "_join") ||
		strings.Contains(nameLower, "_liitos") ||
		strings.Contains(nameLower, "_assoc")) {

		return false, "name does not contain _relation, _join, _liitos, or _assoc", nil
	}

	// 2) Count total columns <= 6
	var colCount int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM information_schema.columns
		WHERE table_name = $1
	`, mm.BridgingTable).Scan(&colCount)
	if err != nil {
		return false, "", fmt.Errorf("cannot count columns for table %s: %w", mm.BridgingTable, err)
	}
	if colCount > 6 {
		return false, fmt.Sprintf("table has %d columns, which is more than 6 allowed", colCount), nil
	}

	// 3) Check that these 2 bridging cols are exactly the entire PK
	pkCols, err := getPrimaryKeyCols(db, mm.BridgingTable)
	if err != nil {
		return false, "", fmt.Errorf("failed to get primary key for table %s: %w", mm.BridgingTable, err)
	}

	if len(pkCols) != 2 {
		return false, fmt.Sprintf("table has %d PK columns (needed exactly 2)", len(pkCols)), nil
	}

	pkSet := make(map[string]bool, 2)
	for _, c := range pkCols {
		pkSet[c] = true
	}
	if !pkSet[mm.ColA] || !pkSet[mm.ColB] {
		return false, fmt.Sprintf("PK columns (%v) do not match bridging cols [%s, %s]", pkCols, mm.ColA, mm.ColB), nil
	}

	// If we reach here, all checks passed
	return true, "", nil
}

// getPrimaryKeyCols returns the column names that form the primary key of tableName.
func getPrimaryKeyCols(db *sql.DB, tableName string) ([]string, error) {
	q := `
	SELECT a.attname
	FROM pg_index i
	JOIN pg_class c ON i.indrelid = c.oid
	JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
	WHERE c.relname = $1
	  AND i.indisprimary
	ORDER BY a.attnum
	`
	rows, err := db.Query(q, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cols []string
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			return nil, err
		}
		cols = append(cols, col)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return cols, nil
}
