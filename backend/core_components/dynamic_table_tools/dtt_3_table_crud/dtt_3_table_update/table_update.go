// table_update.go
// Updates OID values, table names, and schema names in system_db_tables to
// match the current PostgreSQL catalog. Handles ghost entries, schema fill-ins,
// and delegates to insertion and deletion callbacks.

package dtt_3_table_update

import (
	"easelect/backend/core_components/dbutils"
	"fmt"
)

// UpdateOidsAndTableNames päivittää system_db_tables-taulun OID-arvot, taulunimet ja skeemanimet,
// ja kutsuu callbackeja joilla poistetaan/lisätään tauluja.
// Accepts a Querier (either *sql.DB or *sql.Tx) for transaction safety.
func UpdateOidsAndTableNames(
	q dbutils.Querier,
	deleteRemovedTablesFunc func(dbutils.Querier) error,
	insertNewTablesFunc func(dbutils.Querier) error,
) error {

	// Vaihe 0 (uusi): Poistetaan "haamutietueet" jotka aiheuttaisivat UNIQUE constraint -virheen.
	// Haamutietue = rivi jonka OID osoittaa tauluun jolla on ERI nimi, JA kyseinen taulu
	// on jo olemassa system_db_tables:ssa oikealla nimellä.
	// Tämä tapahtuu kun taulu poistetaan ja PostgreSQL kierrättää OID:n uudelle taululle.
	// HUOM: Tämä EI poista uudelleennimettyjä tauluja, koska niille ei ole duplikaattia.
	cleanupGhostEntries := `
		WITH ghost_entries AS (
			SELECT sdt.id, sdt.table_uid, sdt.schema_name
			FROM system_db_tables sdt
			WHERE
				-- Tämän rivin nimi EI täsmää OID:n osoittamaan tauluun pg_class:ssa
				sdt.table_name != (
					SELECT c.relname FROM pg_class c WHERE c.oid = sdt.cached_oid
				)
				-- JA OID:n osoittama taulu ON JO olemassa system_db_tables:ssa oikealla nimellä
				AND EXISTS (
					SELECT 1 FROM pg_class c
					JOIN system_db_tables other ON other.table_name = c.relname
					WHERE c.oid = sdt.cached_oid
					AND other.table_uid != sdt.table_uid
				)
		), removed_rights AS (
			DELETE FROM system_group_table_func_rights gf
			USING ghost_entries ge
			WHERE ge.table_uid IS NOT NULL
				AND gf.target_table_uid = ge.table_uid
				AND gf.target_schema_name = ge.schema_name
			RETURNING gf.id
		), removed_fk_1m AS (
			DELETE FROM system_foreign_key_relations_1_m fk
			USING ghost_entries ge
			WHERE ge.table_uid IS NOT NULL
				AND (fk.source_table_uid = ge.table_uid OR fk.target_table_uid = ge.table_uid)
			RETURNING fk.id
		), removed_fk_mm AS (
			DELETE FROM system_foreign_key_relations_m_m fk
			USING ghost_entries ge
			WHERE ge.table_uid IS NOT NULL
				AND (fk.table_a_uid = ge.table_uid OR fk.table_b_uid = ge.table_uid)
			RETURNING fk.id
		), removed_col_control AS (
			DELETE FROM system_column_control cc
			USING ghost_entries ge
			WHERE ge.table_uid IS NOT NULL
				AND cc.table_uid = ge.table_uid
			RETURNING cc.id
		), removed_col_details AS (
			DELETE FROM system_column_details cd
			USING ghost_entries ge
			WHERE ge.table_uid IS NOT NULL
				AND cd.table_uid = ge.table_uid
			RETURNING cd.id
		), removed_col_settings AS (
			DELETE FROM system_user_column_settings ucs
			USING ghost_entries ge
			WHERE ge.table_uid IS NOT NULL
				AND ucs.table_uid = ge.table_uid
			RETURNING ucs.id
		), removed_row_views AS (
			DELETE FROM system_table_row_view_counts rv
			USING ghost_entries ge
			WHERE ge.table_uid IS NOT NULL
				AND rv.table_uid = ge.table_uid
			RETURNING rv.id
		)
		DELETE FROM system_db_tables sdt
		USING ghost_entries ge
		WHERE sdt.id = ge.id
	`
	if _, err := q.Exec(cleanupGhostEntries); err != nil {
		return fmt.Errorf("error cleaning up ghost entries: %v", err)
	}

	// Vaihe 0a: Päivitetään schema_name kentät cached_oid-arvon perusteella
	fillSchemaByOid := `
               UPDATE system_db_tables AS t
               SET schema_name = n.nspname
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE t.cached_oid = c.oid
                 AND t.schema_name IS NULL;
       `
	if _, err := q.Exec(fillSchemaByOid); err != nil {
		return fmt.Errorf("error updating schema names by OID: %v", err)
	}

	// Vaihe 0b: Päivitetään schema_name ja cached_oid taulun nimen perusteella.
	// Tämä kattaa tapaukset, joissa dumpista palautetut arvot eivät vastaa
	// nykyisen kannan arvoja.
	fillSchemaByName := `
               WITH table_oids AS (
                       SELECT DISTINCT ON (c.relname)
                               c.oid,
                               c.relname,
                               n.nspname
                       FROM pg_class c
                       JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE
                                n.nspname NOT LIKE 'pg_%'
                                AND n.nspname <> 'information_schema'
                                AND c.relkind = 'r'
                                AND has_schema_privilege(n.nspname, 'USAGE')
                                AND has_table_privilege(c.oid, 'SELECT')
                                AND n.nspname NOT IN ('restricted', 'postgis')
                        ORDER BY c.relname, n.nspname
                )
               UPDATE system_db_tables AS t
               SET
                       cached_oid = table_oids.oid,
                       schema_name = table_oids.nspname
               FROM table_oids
               WHERE
                       t.table_name = table_oids.relname
                       AND (t.schema_name IS NULL
                            OR t.schema_name <> table_oids.nspname);
       `
	if _, err := q.Exec(fillSchemaByName); err != nil {
		return fmt.Errorf("error updating schema names by name: %v", err)
	}

	// Vaihe 1: Päivitetään taulun ja skeeman nimi, jos se on muuttunut
	updateNameQuery := `
                WITH table_oids AS (
                        SELECT
                                c.oid,
                                c.relname AS table_name,
                                n.nspname AS schema_name
                        FROM pg_class c
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE
                                n.nspname NOT LIKE 'pg_%'
                                AND n.nspname <> 'information_schema'
                                AND c.relkind = 'r'
                                AND has_schema_privilege(n.nspname, 'USAGE')
                                AND has_table_privilege(c.oid, 'SELECT')
                                AND n.nspname NOT IN ('restricted', 'postgis')
                )
		UPDATE system_db_tables
		SET
			table_name  = table_oids.table_name,
			schema_name = table_oids.schema_name
		FROM table_oids
		WHERE
			system_db_tables.cached_oid = table_oids.oid
			AND (
				system_db_tables.table_name  != table_oids.table_name
				OR system_db_tables.schema_name != table_oids.schema_name
			);
	`
	_, err := q.Exec(updateNameQuery)
	if err != nil {
		return fmt.Errorf("\033[31merror updating table names: %v\033[0m", err)
	}

	// Vaihe 2: Päivitetään cached_oid taulun ja skeeman perusteella, jos OID on muuttunut
	updateOidQuery := `
                WITH table_oids AS (
                        SELECT
                                c.oid,
                                c.relname AS table_name,
                                n.nspname AS schema_name
                        FROM pg_class c
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE
                                n.nspname NOT LIKE 'pg_%'
                                AND n.nspname <> 'information_schema'
                                AND c.relkind = 'r'
                                AND has_schema_privilege(n.nspname, 'USAGE')
                                AND has_table_privilege(c.oid, 'SELECT')
                                AND n.nspname NOT IN ('restricted', 'postgis')
                )
		UPDATE system_db_tables
		SET cached_oid = table_oids.oid
		FROM table_oids
		WHERE
			system_db_tables.table_name  = table_oids.table_name
			AND system_db_tables.schema_name = table_oids.schema_name
			AND system_db_tables.cached_oid  != table_oids.oid;
	`
	_, err = q.Exec(updateOidQuery)
	if err != nil {
		return fmt.Errorf("\033[31merror updating OID values: %v\033[0m", err)
	}

	// Vaihe 3: Poistetaan taulut, joita ei enää ole
	err = deleteRemovedTablesFunc(q)
	if err != nil {
		return err
	}

	// Vaihe 4: Lisätään uudet taulut
	err = insertNewTablesFunc(q)
	if err != nil {
		return err
	}

	return nil
}
