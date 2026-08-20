// add_row_columns_contract_test.go
// Verifies add-row metadata exposes the multilingual flag and active language registry.
// Bridges the SQL row scanner with the frontend-facing AddRowColumnInfo JSON contract.
// Exists so form rendering and server validation receive the same language allowlist.

package dtt_1_row_create

import (
	"database/sql/driver"
	"testing"

	backend "easelect/backend/core_components"
)

func TestGetAddRowColumnsWithTypesScansMultilingualLanguageRegistry(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	t.Cleanup(func() { _ = db.Close() })
	previousDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previousDB })

	pushQuery(queuedQuery{
		cols: []string{
			"column_name", "data_type", "is_nullable", "column_default", "is_identity",
			"generation_expression", "foreign_table_schema", "foreign_table_name",
			"foreign_column_name", "udt_name", "insert_new_target_with_source",
			"insert_new_source_with_target", "source_insert_specs", "target_insert_specs",
			"insertable", "is_multilingual", "multilingual_languages",
		},
		rows: [][]driver.Value{{
			"title", "text", "NO", nil, "NO", nil, nil, nil, nil, "text",
			nil, nil, nil, nil, true, true,
			[]byte(`[{"language_code":"fi","english_name":"Finnish","native_name":"Suomi","is_default":true,"sort_order":10},{"language_code":"en","english_name":"English","native_name":"English","is_default":false,"sort_order":20}]`),
		}},
	})

	columns, err := getAddRowColumnsWithTypes("travel-info-uid", "public")
	if err != nil {
		t.Fatalf("getAddRowColumnsWithTypes() error = %v", err)
	}
	if len(columns) != 1 || !columns[0].IsMultilingual {
		t.Fatalf("columns = %#v, want one multilingual column", columns)
	}
	if len(columns[0].MultilingualLanguages) != 2 || columns[0].MultilingualLanguages[0].LanguageCode != "fi" || columns[0].MultilingualLanguages[1].LanguageCode != "en" {
		t.Fatalf("languages = %#v, want fi/en registry order", columns[0].MultilingualLanguages)
	}
}
