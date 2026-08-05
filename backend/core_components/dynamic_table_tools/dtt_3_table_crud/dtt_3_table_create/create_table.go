// create_table.go
// HTTP handler for creating new dynamic tables. Validates the request, creates the PostgreSQL
// table, and registers it in the system metadata tables.
// Exists to make dataset creation atomic across physical schema and Easelect metadata.
package dtt_3_table_create

import (
	"easelect/backend/core_components/dbutils"
	dtt_system_table_folders "easelect/backend/core_components/dynamic_table_tools/dtt_table_folders"
	"easelect/backend/core_components/security"
	"fmt"
	"strings"
)

// ErrMissingPrimaryKey on virhekääre, jota käytetään kun taulunluonnista puuttuu primary key.
// LangKey-kenttä sisältää kieliavaimen, joka voidaan palauttaa frontendille käännettäväksi.
type ErrMissingPrimaryKey struct {
	TableName string
	LangKey   string
	Message   string
}

func (e *ErrMissingPrimaryKey) Error() string {
	return e.Message
}

type ForeignKeyDefinition struct {
	ReferencingColumn string `json:"referencingColumn"`
	ReferencedTable   string `json:"referencedTable"`
	ReferencedColumn  string `json:"referencedColumn"`
}

func CreateTableInDatabase(db dbutils.Querier, table_name string, columns map[string]string, foreign_keys []ForeignKeyDefinition) error {
	sanitizedTableName, err := security.SanitizeIdentifier(table_name)
	if err != nil {
		return err
	}

	sanitizedColumns := make(map[string]string, len(columns))
	for colName, colType := range columns {
		sColName, err := security.SanitizeIdentifier(colName)
		if err != nil {
			return err
		}
		sanitizedColumns[sColName] = colType
	}

	sanitizedFKs := make([]ForeignKeyDefinition, len(foreign_keys))
	for i, fk := range foreign_keys {
		sRefCol, err := security.SanitizeIdentifier(fk.ReferencingColumn)
		if err != nil {
			return err
		}
		sRefTable, err := security.SanitizeIdentifier(fk.ReferencedTable)
		if err != nil {
			return err
		}
		sRefColumn, err := security.SanitizeIdentifier(fk.ReferencedColumn)
		if err != nil {
			return err
		}
		sanitizedFKs[i] = ForeignKeyDefinition{
			ReferencingColumn: sRefCol,
			ReferencedTable:   sRefTable,
			ReferencedColumn:  sRefColumn,
		}
	}

	// Varmistetaan, että tauluun tulee primary key ennen luontia.
	// Nykyinen logiikka asettaa PRIMARY KEY:n automaattisesti sarakkeelle,
	// joka on nimeltään "id" ja jonka tyyppi alkaa "SERIAL".
	hasPrimaryKey := false
	for colName, colType := range sanitizedColumns {
		if strings.EqualFold(colName, "id") && strings.HasPrefix(strings.ToUpper(colType), "SERIAL") {
			hasPrimaryKey = true
			break
		}
	}
	if !hasPrimaryKey {
		return &ErrMissingPrimaryKey{
			TableName: sanitizedTableName,
			LangKey:   "error_table_creation_missing_primary_key",
			Message:   fmt.Sprintf("cannot create table '%s' without a primary key: add a column named 'id' with type 'SERIAL'", sanitizedTableName),
		}
	}

	var query_builder strings.Builder
	query_builder.WriteString(fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (", sanitizedTableName))

	columns_count := 0
	updated_found := false

	for col_name, col_type := range sanitizedColumns {
		col_type_upper := strings.ToUpper(col_type)

		// Tarkistetaan, onko sarake nimeltään 'updated'
		if strings.EqualFold(col_name, "updated") {
			updated_found = true
		}

		// Jos sarake on nimeltään "id" ja tyyppi on SERIAL, merkitään se PRIMARY KEY:ksi
		if strings.EqualFold(col_name, "id") && strings.HasPrefix(col_type_upper, "SERIAL") {
			query_builder.WriteString(fmt.Sprintf("%s %s PRIMARY KEY", col_name, col_type_upper))
		} else {
			query_builder.WriteString(fmt.Sprintf("%s %s", col_name, col_type_upper))
		}

		columns_count++
		if columns_count < len(sanitizedColumns) {
			query_builder.WriteString(", ")
		}
	}

	// Lisätään vierasavaimet
	for _, fk := range sanitizedFKs {
		constraint_name := fmt.Sprintf("fk_%s_%s", sanitizedTableName, fk.ReferencingColumn)
		query_builder.WriteString(fmt.Sprintf(
			", CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
			constraint_name,
			fk.ReferencingColumn,
			fk.ReferencedTable,
			fk.ReferencedColumn,
		))
	}

	query_builder.WriteString(");")
	create_table_query := query_builder.String()

	_, err = db.Exec(create_table_query)
	if err != nil {
		return fmt.Errorf("error creating table: %w", err)
	}

	// Jos 'updated'-saraketta on mukana, luodaan trigger + funktio sen päivittämiseen
	if updated_found {
		trigger_func := fmt.Sprintf(`
            CREATE OR REPLACE FUNCTION set_%s_updated_timestamp()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated = NOW();
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `, sanitizedTableName)

		_, err = db.Exec(trigger_func)
		if err != nil {
			return fmt.Errorf("error creating trigger function: %w", err)
		}

		trigger_stmt := fmt.Sprintf(`
            CREATE TRIGGER update_%s_timestamp
            BEFORE UPDATE ON %s
            FOR EACH ROW
            EXECUTE PROCEDURE set_%s_updated_timestamp();
        `, sanitizedTableName, sanitizedTableName, sanitizedTableName)

		_, err = db.Exec(trigger_stmt)
		if err != nil {
			return fmt.Errorf("error creating trigger: %w", err)
		}
	}

	return nil
}

// InsertNewTables lisää system_db_tables-tauluun uudet taulut.
// Accepts a Querier (either *sql.DB or *sql.Tx) for transaction safety.
func InsertNewTables(q dbutils.Querier) error {
	defaultFolderID, err := dtt_system_table_folders.EnsureDatabaseOtherTablesFolder(q)
	if err != nil {
		return fmt.Errorf("error resolving default table folder: %v", err)
	}

	// Hakee kaikki skeemat, joihin roolilla on oikeudet, ja lisää puuttuvat taulut
	tablesQuery := `
        SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE
            n.nspname NOT LIKE 'pg_%'
            AND n.nspname <> 'information_schema'
            AND c.relkind = 'r' -- Vain normaalit taulut
            AND has_schema_privilege(n.nspname, 'USAGE')
            AND has_table_privilege(c.oid, 'SELECT')
            AND n.nspname NOT IN ('restricted', 'postgis')
            AND NOT EXISTS (
                SELECT 1
                FROM system_db_tables s
                WHERE s.table_name = c.relname
                  AND s.schema_name = n.nspname
            )
    `
	rows, err := q.Query(tablesQuery)
	if err != nil {
		return fmt.Errorf("error fetching new tables: %v", err)
	}
	defer rows.Close()

	type TableInfo struct {
		OID        int
		SchemaName string
		TableName  string
	}

	var newTables []TableInfo

	for rows.Next() {
		var table TableInfo
		if err := rows.Scan(&table.OID, &table.SchemaName, &table.TableName); err != nil {
			return fmt.Errorf("error scanning table info: %v", err)
		}
		newTables = append(newTables, table)
	}

	for _, table := range newTables {
		// Lisää system_db_tables-tauluun ilman columns-saraketta
		insertQuery := `
            INSERT INTO system_db_tables (cached_oid, schema_name, table_name, folder_id)
            VALUES ($1, $2, $3, $4)
			ON CONFLICT DO NOTHING
        `

		_, err = q.Exec(insertQuery, table.OID, table.SchemaName, table.TableName, defaultFolderID)
		if err != nil {
			return fmt.Errorf("error inserting table %s into system_db_tables: %w", table.TableName, err)
		}
	}

	return nil
}
