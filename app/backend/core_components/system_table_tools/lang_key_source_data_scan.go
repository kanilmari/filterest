// lang_key_source_data_scan.go
// Reads every schema and data reference and persists its protective source evidence.
// Connects population to registry metadata, domain foreign keys and named values.
// Propagates read, iteration and write failures so no partial scan becomes trusted.
package system_table_tools

import (
	"database/sql"
	"fmt"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/lang_key_naming"
	"github.com/lib/pq"
)

// Every stage read goes through this gate so earlier saves are visible even
// when a scanned column belongs to the source table itself.
func (w *langKeySourceWriter) readSourceRows(query string, visit func(*sql.Rows) error) error {
	if err := w.flush(); err != nil {
		return err
	}
	return readSourceRows(query, visit)
}

// The raw reader also serves registry/index initialization before any saves.
// It closes readers before writers use the pool, including one-connection fixtures.
// A failed conversion or late iteration error is a failure.
func readSourceRows(query string, visit func(*sql.Rows) error) error {
	rows, err := backend.Db.Query(query)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := visit(rows); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return rows.Close()
}

func fetchLangKeyRegistry() (map[string]int64, error) {
	keys := make(map[string]int64)
	err := readSourceRows("SELECT id, lang_key FROM system_lang_keys", func(rows *sql.Rows) error {
		var id int64
		var key string
		if err := rows.Scan(&id, &key); err != nil {
			return err
		}
		keys[key] = id
		return nil
	})
	return keys, err
}

func (w *langKeySourceWriter) scanSchemaLangKeySources(keys map[string]int64, codeSources []sourceEntry, codeKeys map[int64]bool) (int, error) {
	columns := make(map[string][]string)
	tableColumns := make(map[string][]string)
	err := w.readSourceRows(`SELECT cd.column_name, dt.table_name FROM system_column_details cd
        JOIN system_db_tables dt ON cd.table_uid=dt.table_uid ORDER BY cd.column_name, dt.table_name`, func(rows *sql.Rows) error {
		var column, table string
		if err := rows.Scan(&column, &table); err != nil {
			return err
		}
		columns[column] = append(columns[column], table)
		tableColumns[table] = append(tableColumns[table], column)
		return nil
	})
	if err != nil {
		return 0, &sourceSubScanError{"schema_columns", err}
	}
	tables := make(map[string]bool)
	err = w.readSourceRows("SELECT DISTINCT table_name FROM system_db_tables", func(rows *sql.Rows) error {
		var table string
		if err := rows.Scan(&table); err != nil {
			return err
		}
		tables[table] = true
		return nil
	})
	if err != nil {
		return 0, &sourceSubScanError{"schema_tables", err}
	}
	count := 0
	saveName := func(id int64, name string) error {
		for _, table := range columns[name] {
			if err := w.saveExplainedSource(id, "column", table, name, fmt.Sprintf("Column '%s' in table '%s'", name, table)); err != nil {
				return err
			}
			count++
		}
		if tables[name] {
			if err := w.saveExplainedSource(id, "table", name, name, fmt.Sprintf("Table '%s'", name)); err != nil {
				return err
			}
			count++
		}
		return nil
	}
	literalFiles := map[string]map[string]bool{}
	for _, source := range codeSources {
		if source.literalUI {
			if literalFiles[source.filePath] == nil {
				literalFiles[source.filePath] = map[string]bool{}
			}
			literalFiles[source.filePath][source.langKey] = true
		}
	}
	var schemaSources []sourceEntry
	for _, source := range codeSources {
		if source.schemaAlias {
			schemaSources = append(schemaSources, source)
		}
	}
	aliases := map[string]map[string]bool{}
	// Linked-label metadata reads also precede every schema save, with the
	// pending writes already flushed by the metadata gate above.
	if len(schemaSources) > 0 {
		for table, names := range tableColumns {
			projections, err := dtt_1_row_read.LinkedLabelEvidenceAliases(table, names)
			if err != nil {
				return count, &sourceSubScanError{"schema_linked_labels", err}
			}
			for builder, labels := range projections {
				if aliases[builder] == nil {
					aliases[builder] = map[string]bool{}
				}
				for label := range labels {
					aliases[builder][label] = true
				}
			}
		}
	}
	for key, id := range keys {
		names := []string{key}
		if remainder, ok := lang_key_naming.TrimDynamicPrefix(key); ok {
			names = append(names, remainder)
		}
		if base, ok := lang_key_naming.TrimDynamicSuffix(key); ok {
			names = append(names, base)
		}
		// Each owner gets only aliases its actual FK/actor projection emits.
		if alias := lang_key_naming.LinkedSchemaAlias(key); alias != "" {
			for _, source := range schemaSources {
				if !aliases[source.schemaBuilder][alias] {
					continue
				}
				// The code stage already merged this exact literal hit. A generic
				// schema alias in the same file must not overwrite its marker.
				if literalFiles[source.filePath][key] {
					continue
				}
				if err := w.upsertSource(id, "code", source.filePath, ""); err != nil {
					return count, err
				}
				codeKeys[id] = true
				count++
			}
		}
		for _, name := range names {
			if err := saveName(id, name); err != nil {
				return count, err
			}
		}
	}
	return count, nil
}

// Table and column arguments are code-owned identifiers, never request input.
func (w *langKeySourceWriter) scanNamedLangKeySources(keys map[string]int64, sourceType, table, column string) (int, error) {
	var names []string
	qColumn := pq.QuoteIdentifier(column)
	err := w.readSourceRows(fmt.Sprintf("SELECT DISTINCT %s FROM %s WHERE %s IS NOT NULL AND %s != ''", qColumn, pq.QuoteIdentifier(table), qColumn, qColumn), func(rows *sql.Rows) error {
		var name string
		if err := rows.Scan(&name); err != nil {
			return err
		}
		names = append(names, name)
		return nil
	})
	if err != nil {
		return 0, err
	}
	count := 0
	for _, name := range names {
		id, ok := keys[name]
		if !ok {
			continue
		}
		high := table
		if sourceType == "folder" {
			high = name
		}
		if err := w.upsertSource(id, sourceType, high, name); err != nil {
			return count, err
		}
		if sourceType == "folder" {
			if err := w.updateSourceUsageExplanationIfEmpty(id, sourceType, high, fmt.Sprintf("Folder '%s'", name)); err != nil {
				return count, err
			}
		}
		count++
	}
	return count, nil
}

func (w *langKeySourceWriter) scanForeignKeyLangKeyReferences(keys map[string]int64) (int, error) {
	ids := make(map[int64]bool, len(keys))
	for _, id := range keys {
		ids[id] = true
	}
	type reference struct{ schema, table, column string }
	var refs []reference
	err := w.readSourceRows(`SELECT src_ns.nspname, src.relname, src_col.attname
        FROM pg_constraint con
        JOIN pg_class src ON src.oid=con.conrelid
        JOIN pg_namespace src_ns ON src_ns.oid=src.relnamespace
        JOIN pg_class ref ON ref.oid=con.confrelid
        JOIN pg_namespace ref_ns ON ref_ns.oid=ref.relnamespace
        JOIN pg_attribute src_col ON src_col.attrelid=src.oid AND src_col.attnum=con.conkey[1]
        JOIN pg_attribute ref_col ON ref_col.attrelid=ref.oid AND ref_col.attnum=con.confkey[1]
        WHERE con.contype='f' AND ref_ns.nspname='public' AND ref.relname='system_lang_keys'
        AND ref_col.attname='id' AND array_length(con.conkey,1)=1
        AND NOT (src_ns.nspname='public' AND src.relname='system_lang_key_sources')
        ORDER BY src_ns.nspname, src.relname, src_col.attname`, func(rows *sql.Rows) error {
		var ref reference
		if err := rows.Scan(&ref.schema, &ref.table, &ref.column); err != nil {
			return err
		}
		refs = append(refs, ref)
		return nil
	})
	if err != nil {
		return 0, err
	}
	count := 0
	for _, ref := range refs {
		var found []int64
		col := pq.QuoteIdentifier(ref.column)
		high := fmt.Sprintf("%s.%s.%s", ref.schema, ref.table, ref.column)
		err := w.readSourceRows(fmt.Sprintf("SELECT DISTINCT %s::bigint FROM %s.%s WHERE %s IS NOT NULL", col, pq.QuoteIdentifier(ref.schema), pq.QuoteIdentifier(ref.table), col), func(rows *sql.Rows) error {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return err
			}
			if ids[id] {
				found = append(found, id)
			}
			return nil
		})
		if err != nil {
			return count, fmt.Errorf("foreign-key values %s: %w", high, err)
		}
		for _, id := range found {
			if err := w.saveExplainedSource(id, "foreign_key", high, ref.column, fmt.Sprintf("Foreign-key value in '%s'", high)); err != nil {
				return count, err
			}
			count++
		}
	}
	return count, nil
}

func (w *langKeySourceWriter) scanHasLangKeyColumns(keys map[string]int64) (int, error) {
	type columnRef struct{ column, table string }
	var refs []columnRef
	err := w.readSourceRows(`SELECT cd.column_name, dt.table_name FROM system_column_details cd
        JOIN system_db_tables dt ON cd.table_uid=dt.table_uid
        WHERE cd.card_element ILIKE '%lang_key%' OR cd.card_element ILIKE '%lang-key%'
        ORDER BY dt.table_name, cd.column_name`, func(rows *sql.Rows) error {
		var ref columnRef
		if err := rows.Scan(&ref.column, &ref.table); err != nil {
			return err
		}
		refs = append(refs, ref)
		return nil
	})
	if err != nil {
		return 0, err
	}
	count := 0
	for _, ref := range refs {
		var values []string
		col := pq.QuoteIdentifier(ref.column)
		high := fmt.Sprintf("%s.%s", ref.table, ref.column)
		err := w.readSourceRows(fmt.Sprintf("SELECT DISTINCT %s FROM %s WHERE %s IS NOT NULL AND %s != ''", col, pq.QuoteIdentifier(ref.table), col, col), func(rows *sql.Rows) error {
			var value string
			if err := rows.Scan(&value); err != nil {
				return err
			}
			values = append(values, value)
			return nil
		})
		if err != nil {
			return count, fmt.Errorf("column values %s: %w", high, err)
		}
		for _, value := range values {
			id, ok := keys[value]
			if !ok {
				continue
			}
			if err := w.saveExplainedSource(id, "column_value", high, value, fmt.Sprintf("Value '%s' in column '%s' (hasLangKey)", value, high)); err != nil {
				return count, err
			}
			count++
		}
	}
	return count, nil
}
