// Tests the boundary between text language defaults and shared scalar columns.
package dtt_crud_workflows

import (
	"database/sql"
	"database/sql/driver"
	columns "easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	"encoding/json"
	"testing"
)

func TestNewColumnLanguagesRespectTextTypeBoundary(t *testing.T) {
	yes := true
	for _, kind := range []string{"TEXT", "varchar", "VARCHAR(80)", "VARCHAR (80)", "TEXT NOT NULL", "VARCHAR NOT NULL"} {
		if err := validateNewColumnLanguages([]columns.ModifiedCol{{NewName: "destination", DataType: kind, IsMultilingual: &yes}}); err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
	}
	for _, kind := range []string{"DATE", "INTEGER", "BOOLEAN", "JSONB", "", "character varying", "TEXT DEFAULT clock_timestamp()", "VARCHAR; DROP TABLE anything"} {
		if err := validateNewColumnLanguages([]columns.ModifiedCol{{NewName: "value", DataType: kind, IsMultilingual: &yes}}); err == nil {
			t.Fatalf("%s accepted multilingual values", kind)
		}
	}
	no := false
	if err := validateNewColumnLanguages([]columns.ModifiedCol{{NewName: "expiry_date", DataType: "DATE", IsMultilingual: &no}}); err != nil {
		t.Fatal(err)
	}
}

func TestNewColumnDefaultsNoOpDoesNotRequireDatabase(t *testing.T) {
	if err := configureNewColumnDefaults(nil, "unchanged", nil, nil); err != nil {
		t.Fatal(err)
	}
}

func TestModifyColumnsGUIVarcharLengthPassesTypeValidation(t *testing.T) {
	var request ModifyColumnsRequest
	if err := json.Unmarshal([]byte(`{"dataset_name":"demo","added_columns":[{"new_name":"title","data_type":"VARCHAR","length":30,"is_multilingual":true}]}`), &request); err != nil {
		t.Fatal(err)
	}
	column := request.AddedCols[0]
	if !isAllowedDataType(column.DataType) || column.Length == nil || *column.Length != 30 {
		t.Fatalf("GUI VARCHAR plus separate length did not retain a valid type: %#v", column)
	}
	if err := validateNewColumnLanguages(request.AddedCols); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"VARCHAR", "VARCHAR (30)", "VARCHAR NOT NULL"} {
		if !isAllowedDataType(kind) {
			t.Fatalf("valid PostgreSQL VARCHAR spelling was rejected: %s", kind)
		}
	}
}

type languageDefaultRecorder struct {
	*sql.DB
	values []bool
}

func (r *languageDefaultRecorder) Exec(_ string, args ...interface{}) (sql.Result, error) {
	r.values = append(r.values, args[0].(bool))
	return &workflowQueueResult{rowsAffected: 1}, nil
}

func TestTextConstraintInheritsDatasetLanguageDefault(t *testing.T) {
	for _, kind := range []string{"TEXT NOT NULL", "VARCHAR", "VARCHAR(30) NOT NULL", "VARCHAR (30) NOT NULL"} {
		t.Run(kind, func(t *testing.T) {
			db := newWorkflowQueueTestDB(t)
			defer db.Close()
			pushWorkflowQuery(queuedWorkflowQuery{
				cols: []string{"table_uid", "inherited"},
				rows: [][]driver.Value{{int64(42), true}},
			})
			recorder := &languageDefaultRecorder{DB: db}
			if err := configureNewColumnDefaults(recorder, "demo", []columns.ModifiedCol{{NewName: "title", DataType: kind}}, nil); err != nil {
				t.Fatal(err)
			}
			if len(recorder.values) != 1 || !recorder.values[0] {
				t.Fatalf("new %s column did not inherit true: %v", kind, recorder.values)
			}
		})
	}
}
