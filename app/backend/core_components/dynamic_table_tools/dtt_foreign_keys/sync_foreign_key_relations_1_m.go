// sync_foreign_key_relations_1_m.go
// Synchronizes one-to-many foreign key constraints from the PostgreSQL catalog
// into system_foreign_key_relations_1_m. Only tracks constraints where the
// source table has a single-column primary key.

package dtt_foreign_keys

import (
	"database/sql"
	"fmt"
	"log"
)

// SyncOneToManyFKConstraints lukee kaikki tietokannan ulkoavaimet (FOREIGN KEY)
// ja synkronoi ne system_foreign_key_relations_1_m -tauluun.
// Nyt rajataan mukaan vain ne ulkoavaimet, joissa *lähdetaululla*
// on yksisarakkeinen PK. "1" viittaa siis lähdetauluun.
func SyncOneToManyFKConstraints(db *sql.DB) error {
	// log.Println("[INFO] Synchronizing 1-to-many foreign keys...")

	// 1. Haetaan kaikki ulkoavaimet tietokannasta.
	const qryAllFKs = `
               SELECT
                       t.relname AS source_table,
                       a.attname AS source_column,
                       ft.relname AS target_table,
                       fa.attname AS target_column
               FROM pg_constraint c
               JOIN pg_class t       ON c.conrelid = t.oid
               JOIN pg_namespace ns  ON ns.oid = t.relnamespace
               JOIN pg_class ft      ON c.confrelid = ft.oid
               JOIN pg_namespace nst ON nst.oid = ft.relnamespace
               JOIN pg_attribute a   ON a.attrelid = t.oid  AND a.attnum  = ANY(c.conkey)
               JOIN pg_attribute fa  ON fa.attrelid = ft.oid AND fa.attnum = ANY(c.confkey)
               WHERE c.contype = 'f'
                 AND ns.nspname NOT IN ('restricted', 'postgis')
                 AND nst.nspname NOT IN ('restricted', 'postgis')
       `

	type dbConstraint struct {
		SourceTable  string
		SourceColumn string
		TargetTable  string
		TargetColumn string
	}

	rows, err := db.Query(qryAllFKs)
	if err != nil {
		return fmt.Errorf("cannot query existing fk constraints from DB: %w", err)
	}
	defer rows.Close()

	foundConstraints := make(map[string]dbConstraint)

	for rows.Next() {
		var c dbConstraint
		if err := rows.Scan(
			&c.SourceTable,
			&c.SourceColumn,
			&c.TargetTable,
			&c.TargetColumn,
		); err != nil {
			return fmt.Errorf("cannot scan fk constraints from DB: %w", err)
		}

		key := fmt.Sprintf("%s.%s->%s.%s",
			c.SourceTable, c.SourceColumn, c.TargetTable, c.TargetColumn)

		// Tarkistetaan, että LÄHDETAULULLA on tasan yksi-sarakkeinen PK
		singlePK, checkErr := hasSingleColumnPK(db, c.SourceTable)
		if checkErr != nil {
			return fmt.Errorf("error checking PK for table %s: %w",
				c.SourceTable, checkErr)
		}
		if !singlePK {
			// log.Printf("[INFO] Skipping constraint %s: source table %s does NOT have a single-col PK.",
			// 	key, c.SourceTable)
			continue
		}

		foundConstraints[key] = c
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("fk constraints row iteration error: %w", err)
	}

	// 2. Haetaan rivit system_foreign_key_relations_1_m -taulusta
	const qryAllCustom = `
               SELECT
                       fr.id,
                       s_src.table_name AS source_table_name,
                       fr.source_column_name,
                       s_tgt.table_name AS target_table_name,
                       fr.target_column_name
               FROM system_foreign_key_relations_1_m fr
               JOIN system_db_tables s_src ON s_src.table_uid = fr.source_table_uid
               JOIN system_db_tables s_tgt ON s_tgt.table_uid = fr.target_table_uid
       `

	type existingRelation struct {
		ID           int64
		SourceTable  string
		SourceColumn string
		TargetTable  string
		TargetColumn string
	}

	rows2, err := db.Query(qryAllCustom)
	if err != nil {
		return fmt.Errorf("cannot query system_foreign_key_relations_1_m table: %w", err)
	}
	defer rows2.Close()

	existingRows := make(map[string]existingRelation)

	for rows2.Next() {
		var er existingRelation
		if err := rows2.Scan(
			&er.ID,
			&er.SourceTable,
			&er.SourceColumn,
			&er.TargetTable,
			&er.TargetColumn,
		); err != nil {
			return fmt.Errorf("cannot scan row from system_foreign_key_relations_1_m: %w", err)
		}

		key := fmt.Sprintf("%s.%s->%s.%s",
			er.SourceTable, er.SourceColumn, er.TargetTable, er.TargetColumn)
		existingRows[key] = er
	}
	if err := rows2.Err(); err != nil {
		return fmt.Errorf("system_foreign_key_relations_1_m rows iteration error: %w", err)
	}

	// 3. Määritetään uudet vs. poistettavat constraintit
	var toInsert []dbConstraint
	var toDelete []int64

	for key, c := range foundConstraints {
		if _, ok := existingRows[key]; !ok {
			toInsert = append(toInsert, c)
		}
	}
	for key, er := range existingRows {
		if _, ok := foundConstraints[key]; !ok {
			toDelete = append(toDelete, er.ID)
		}
	}

	// 4. Lisäykset
	for _, c := range toInsert {
		_, err := db.Exec(`
           INSERT INTO system_foreign_key_relations_1_m (
               source_table_uid,
               source_column_name,
               target_table_uid,
               target_column_name,
               reference_direction
           )
           VALUES (
               (SELECT table_uid FROM system_db_tables WHERE table_name = $1),
               $2,
               (SELECT table_uid FROM system_db_tables WHERE table_name = $3),
               $4,
               $5
           )
        `,
			c.SourceTable,
			c.SourceColumn,
			c.TargetTable,
			c.TargetColumn,
			fmt.Sprintf("%s->%s", c.SourceTable, c.TargetTable),
		)
		if err != nil {
			return fmt.Errorf(
				"cannot insert new FK row (%s.%s->%s.%s): %w",
				c.SourceTable, c.SourceColumn,
				c.TargetTable, c.TargetColumn,
				err,
			)
		}
		log.Printf("[INFO] Inserted new 1->m constraint: %s.%s -> %s.%s",
			c.SourceTable, c.SourceColumn,
			c.TargetTable, c.TargetColumn)
	}

	// 5. Poistot
	for _, rowID := range toDelete {
		_, err := db.Exec(`DELETE FROM system_foreign_key_relations_1_m WHERE id = $1`, rowID)
		if err != nil {
			return fmt.Errorf("cannot delete obsolete FK row (id=%d): %w", rowID, err)
		}
		log.Printf("[INFO] Deleted obsolete 1->m constraint with id=%d", rowID)
	}

	log.Printf("[INFO] FK sync complete. Inserted %d, Deleted %d, unchanged %d",
		len(toInsert),
		len(toDelete),
		len(existingRows)-len(toDelete),
	)
	return nil
}

// hasSingleColumnPK palauttaa true, jos annetuilla parametreilla
// (tableName) on tasan yksi PRIMARY KEY -sarake. Ei vertaa PK-sarakkeen nimeä
// mihinkään tiettyyn ulkoavainsarakkeeseen – pelkästään lukumäärä ratkaisee.
func hasSingleColumnPK(db *sql.DB, tableName string) (bool, error) {
	q := `
		SELECT a.attname
		FROM pg_index i
		JOIN pg_class c ON i.indrelid = c.oid
		JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
		WHERE c.relname = $1
		  AND i.indisprimary
	`
	rows, err := db.Query(q, tableName)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	var pkCols []string
	for rows.Next() {
		var pkCol string
		if err := rows.Scan(&pkCol); err != nil {
			return false, err
		}
		pkCols = append(pkCols, pkCol)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}

	// Palautetaan true vain, jos PK-sarakkeita on täsmälleen yksi
	return len(pkCols) == 1, nil
}
