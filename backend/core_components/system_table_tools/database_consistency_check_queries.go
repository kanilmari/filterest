// database_consistency_check_queries.go
// SQL query definitions and helpers for the database consistency check suite.
// Bridges the consistency-check runner and the individual SQL integrity queries.
// Exists to keep check queries in one file separate from the orchestration logic.
package system_table_tools

import (
	backend "easelect/backend/core_components"
	"fmt"
	"log"
)

// 1. Orvot system_db_tables-rivit: rekisterissä mutta ei PostgreSQL:ssä
func checkOrphanSystemDbTableRows() CategoryResult {
	cat := CategoryResult{
		Number:       1,
		Title:        "Orphan system_db_tables rows",
		TitleLangKey: "consistency_orphan_sdt_rows",
		Issues:       []ConsistencyIssue{},
	}

	query := `
		SELECT sdt.table_name, sdt.schema_name
		FROM system_db_tables sdt
		WHERE NOT EXISTS (
			SELECT 1
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = sdt.schema_name
			  AND c.relname = sdt.table_name
			  AND c.relkind = 'r'
		)
		ORDER BY sdt.table_name
	`

	rows, err := backend.Db.Query(query)
	if err != nil {
		log.Printf("[ConsistencyCheck] error in cat1 query: %v", err)
		return cat
	}
	defer rows.Close()

	for rows.Next() {
		var tableName, schemaName string
		if err := rows.Scan(&tableName, &schemaName); err != nil {
			continue
		}
		cat.Issues = append(cat.Issues, ConsistencyIssue{
			ID:          fmt.Sprintf("cat1_%s", tableName),
			Category:    1,
			Table:       tableName,
			Description: fmt.Sprintf("Table '%s' (schema: %s) is registered in system_db_tables but not found in PostgreSQL.", tableName, schemaName),
		})
	}

	return cat
}

// 2. Rekisteröimättömät taulut: PostgreSQL:ssä mutta ei system_db_tables:ssa
func checkUnregisteredTables() CategoryResult {
	cat := CategoryResult{
		Number:       2,
		Title:        "Unregistered tables",
		TitleLangKey: "consistency_unregistered_tables",
		Issues:       []ConsistencyIssue{},
	}

	query := `
		SELECT c.relname, n.nspname
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind = 'r'
		  AND n.nspname NOT LIKE 'pg_%'
		  AND n.nspname <> 'information_schema'
		  AND n.nspname NOT IN ('restricted', 'postgis')
		  AND has_schema_privilege(n.nspname, 'USAGE')
		  AND has_table_privilege(c.oid, 'SELECT')
		  AND NOT EXISTS (
				SELECT 1
				FROM system_db_tables sdt
				WHERE sdt.table_name = c.relname
				  AND sdt.schema_name = n.nspname
		  )
		ORDER BY c.relname
	`

	rows, err := backend.Db.Query(query)
	if err != nil {
		log.Printf("[ConsistencyCheck] error in cat2 query: %v", err)
		return cat
	}
	defer rows.Close()

	for rows.Next() {
		var tableName, schemaName string
		if err := rows.Scan(&tableName, &schemaName); err != nil {
			continue
		}
		cat.Issues = append(cat.Issues, ConsistencyIssue{
			ID:          fmt.Sprintf("cat2_%s", tableName),
			Category:    2,
			Table:       tableName,
			Description: fmt.Sprintf("Table '%s' (schema: %s) exists in PostgreSQL but is not registered in system_db_tables.", tableName, schemaName),
		})
	}

	return cat
}

// 3. Orvot system_column_details-rivit: viittaavat puuttuvaan table_uid:hen
func checkOrphanColumnDetails() CategoryResult {
	cat := CategoryResult{
		Number:       3,
		Title:        "Orphan system_column_details rows",
		TitleLangKey: "consistency_orphan_column_details",
		Issues:       []ConsistencyIssue{},
	}

	query := `
		SELECT scd.table_uid, COUNT(*) as col_count
		FROM system_column_details scd
		WHERE NOT EXISTS (
			SELECT 1
			FROM system_db_tables sdt
			WHERE sdt.table_uid = scd.table_uid
		)
		GROUP BY scd.table_uid
		ORDER BY scd.table_uid
	`

	rows, err := backend.Db.Query(query)
	if err != nil {
		log.Printf("[ConsistencyCheck] error in cat3 query: %v", err)
		return cat
	}
	defer rows.Close()

	for rows.Next() {
		var tableUID int64
		var colCount int
		if err := rows.Scan(&tableUID, &colCount); err != nil {
			continue
		}
		cat.Issues = append(cat.Issues, ConsistencyIssue{
			ID:          fmt.Sprintf("cat3_%d", tableUID),
			Category:    3,
			Table:       fmt.Sprintf("table_uid=%d", tableUID),
			Description: fmt.Sprintf("system_column_details contains %d column row(s) for table_uid %d, which is not found in system_db_tables.", colCount, tableUID),
		})
	}

	return cat
}

// 4. Epäyhtenäiset sarakkeet: system_column_details vs. pg_catalog
func checkInconsistentColumns() CategoryResult {
	cat := CategoryResult{
		Number:       4,
		Title:        "Inconsistent columns",
		TitleLangKey: "consistency_inconsistent_columns",
		Issues:       []ConsistencyIssue{},
	}

	// Etsitään sarakkeet jotka ovat system_column_details:ssa mutta eivät PostgreSQL:ssä
	query := `
		SELECT sdt.table_name, scd.column_name
		FROM system_column_details scd
		JOIN system_db_tables sdt ON sdt.table_uid = scd.table_uid
		WHERE NOT EXISTS (
			SELECT 1
			FROM information_schema.columns isc
			WHERE isc.table_schema = sdt.schema_name
			  AND isc.table_name = sdt.table_name
			  AND isc.column_name = scd.column_name
		)
		ORDER BY sdt.table_name, scd.column_name
	`

	rows, err := backend.Db.Query(query)
	if err != nil {
		log.Printf("[ConsistencyCheck] error in cat4 query: %v", err)
		return cat
	}
	defer rows.Close()

	for rows.Next() {
		var tableName, colName string
		if err := rows.Scan(&tableName, &colName); err != nil {
			continue
		}
		cat.Issues = append(cat.Issues, ConsistencyIssue{
			ID:          fmt.Sprintf("cat4_%s.%s", tableName, colName),
			Category:    4,
			Table:       fmt.Sprintf("%s.%s", tableName, colName),
			Description: fmt.Sprintf("Column '%s' in table '%s' is registered in system_column_details but not found in PostgreSQL.", colName, tableName),
		})
	}

	return cat
}

// 5. Orvot viiteavainrivit: system_foreign_key_relations viittaavat puuttuviin tauluihin
func checkOrphanForeignKeyRelations() CategoryResult {
	cat := CategoryResult{
		Number:       5,
		Title:        "Orphan foreign key rows",
		TitleLangKey: "consistency_orphan_fk_relations",
		Issues:       []ConsistencyIssue{},
	}

	// 1:M -suhteet
	query1m := `
		SELECT fk.id, fk.source_table_uid, fk.target_table_uid
		FROM system_foreign_key_relations_1_m fk
		WHERE NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_uid = fk.source_table_uid)
		   OR NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_uid = fk.target_table_uid)
		ORDER BY fk.id
	`

	rows, err := backend.Db.Query(query1m)
	if err != nil {
		log.Printf("[ConsistencyCheck] error in cat5 1:M query: %v", err)
	} else {
		defer rows.Close()
		for rows.Next() {
			var id int64
			var sourceUID, targetUID int64
			if err := rows.Scan(&id, &sourceUID, &targetUID); err != nil {
				continue
			}
			cat.Issues = append(cat.Issues, ConsistencyIssue{
				ID:          fmt.Sprintf("cat5_1m_%d", id),
				Category:    5,
				Table:       fmt.Sprintf("1:M id=%d", id),
				Description: fmt.Sprintf("system_foreign_key_relations_1_m row %d references missing tables (source_uid=%d, target_uid=%d).", id, sourceUID, targetUID),
			})
		}
	}

	// M:M -suhteet
	queryMm := `
		SELECT fk.id, fk.table_a_uid, fk.table_b_uid, fk.bridging_table_uid
		FROM system_foreign_key_relations_m_m fk
		WHERE NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_uid = fk.table_a_uid)
		   OR NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_uid = fk.table_b_uid)
		   OR NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_uid = fk.bridging_table_uid)
		ORDER BY fk.id
	`

	rows2, err := backend.Db.Query(queryMm)
	if err != nil {
		log.Printf("[ConsistencyCheck] error in cat5 M:M query: %v", err)
	} else {
		defer rows2.Close()
		for rows2.Next() {
			var id, aUID, bUID, bridgeUID int64
			if err := rows2.Scan(&id, &aUID, &bUID, &bridgeUID); err != nil {
				continue
			}
			cat.Issues = append(cat.Issues, ConsistencyIssue{
				ID:          fmt.Sprintf("cat5_mm_%d", id),
				Category:    5,
				Table:       fmt.Sprintf("M:M id=%d", id),
				Description: fmt.Sprintf("system_foreign_key_relations_m_m row %d references missing tables (a=%d, b=%d, bridge=%d).", id, aUID, bUID, bridgeUID),
			})
		}
	}

	return cat
}

// 6. Orvot oikeusrivit: system_group_table_func_rights viittaa puuttuviin tauluihin
func checkOrphanPermissionRows() CategoryResult {
	cat := CategoryResult{
		Number:       6,
		Title:        "Orphan permission rows",
		TitleLangKey: "consistency_orphan_permission_rows",
		Issues:       []ConsistencyIssue{},
	}

	query := `
		SELECT gf.id, gf.target_table_uid, gf.target_schema_name
		FROM system_group_table_func_rights gf
		WHERE gf.target_table_uid IS NOT NULL
		  AND NOT EXISTS (
			SELECT 1
			FROM system_db_tables sdt
			WHERE sdt.table_uid = gf.target_table_uid
		)
		ORDER BY gf.id
	`

	rows, err := backend.Db.Query(query)
	if err != nil {
		log.Printf("[ConsistencyCheck] error in cat6 query: %v", err)
		return cat
	}
	defer rows.Close()

	for rows.Next() {
		var id, tableUID int64
		var schemaName string
		if err := rows.Scan(&id, &tableUID, &schemaName); err != nil {
			continue
		}
		cat.Issues = append(cat.Issues, ConsistencyIssue{
			ID:          fmt.Sprintf("cat6_%d", id),
			Category:    6,
			Table:       fmt.Sprintf("rights id=%d (table_uid=%d)", id, tableUID),
			Description: fmt.Sprintf("system_group_table_func_rights row %d references missing table_uid %d (schema: %s).", id, tableUID, schemaName),
		})
	}

	return cat
}
