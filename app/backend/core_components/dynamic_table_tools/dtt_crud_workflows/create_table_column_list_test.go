// create_table_column_list_test.go
// Verifies how a dataset creation request is read and carried: strict
// decoding, the rules every listed column must meet, the column settings it
// writes, and cache invalidation that waits for the commit.
// Exists because the columns used to travel as a map, which lost their order
// and let a caller's unknown fields pass silently.
package dtt_crud_workflows

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
)

// Without a transaction in the request, a payload that passed every check
// would end in 500 "transaction not available"; a 400 proves it was refused
// before any schema work.
func TestCreateRequestRefusesTheRetiredMapsAndAnythingUnknown(t *testing.T) {
	for _, testCase := range []struct{ payload, reason string }{
		{`{"dataset_name":"sample","columns":{"id":"SERIAL"}}`, `unknown field \"columns\"`},
		{`{"dataset_name":"sample","column_list":[{"name":"id","data_type":"SERIAL"}],"column_card_roles":{"id":"details"}}`,
			`unknown field \"column_card_roles\"`},
		// Names by language come with their own step; until then they are refused, not ignored.
		{`{"dataset_name":"sample","column_list":[{"name":"id","data_type":"SERIAL","label":{"fi":"Tunniste"}}]}`,
			`unknown field \"label\"`},
		{`{"dataset_name":"sample","column_list":[{"name":"id","data_type":"SERIAL"}]} {}`, "exactly one JSON object"},
		{`{"dataset_name":"sample","column_list":[]}`, "at least one column is required"},
		{`{"dataset_name":"sample"}`, "at least one column is required"},
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/create_dataset", strings.NewReader(testCase.payload))
		rec := httptest.NewRecorder()
		CreateTableHandler(rec, req)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), testCase.reason) {
			t.Fatalf("%s: status=%d body=%s, want 400 naming %s", testCase.payload, rec.Code, rec.Body, testCase.reason)
		}
	}
}

func TestCreateColumnListKeepsTheRequestOrder(t *testing.T) {
	yes := true
	list := []CreateColumnDef{
		{Name: "id", DataType: "SERIAL"},
		{Name: "updated", DataType: "TIMESTAMPTZ NOT NULL DEFAULT NOW()"},
		{Name: "zeta", DataType: "TEXT NOT NULL", CardRole: "header", IsMultilingual: &yes, Sortable: true},
		{Name: "alpha", DataType: "BOOLEAN NOT NULL DEFAULT FALSE", VisibilityGate: true, HideInFilterPanel: true},
	}
	validated, err := validateCreateColumnList(list)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(validated, list) {
		t.Fatalf("validated = %+v, want the request unchanged and in order", validated)
	}
	tableColumns := tableColumnsOf(validated)
	names := make([]string, 0, len(tableColumns))
	for _, column := range tableColumns {
		names = append(names, column.Name+" "+column.DataType)
	}
	want := []string{"id SERIAL", "updated TIMESTAMPTZ NOT NULL DEFAULT NOW()", "zeta TEXT NOT NULL", "alpha BOOLEAN NOT NULL DEFAULT FALSE"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("table columns = %v, want %v", names, want)
	}
	if roles := cardRolesOf(validated); !reflect.DeepEqual(roles, map[string]string{"zeta": "header"}) {
		t.Fatalf("roles = %v, want only the role the request set", roles)
	}
}

func TestCreateColumnListRefusesAColumnThatBreaksARule(t *testing.T) {
	yes, no := true, false
	id := CreateColumnDef{Name: "id", DataType: "SERIAL"}
	for _, testCase := range []struct {
		column CreateColumnDef
		reason string
	}{
		{CreateColumnDef{Name: "bad name", DataType: "TEXT"}, "invalid column name"},
		{CreateColumnDef{Name: "ID", DataType: "TEXT"}, "listed more than once"},
		{CreateColumnDef{Name: "note", DataType: "TEXT DEFAULT 'x'); DROP TABLE system_users; --"}, "forbidden data type"},
		{CreateColumnDef{Name: "note", DataType: "TEXT", CardRole: "title"}, "unsupported card role"},
		{CreateColumnDef{Name: "amount", DataType: "INTEGER", IsMultilingual: &yes}, "require a text column"},
		{CreateColumnDef{Name: "note", DataType: "TEXT", VisibilityGate: true}, "only a yes/no (BOOLEAN) column"},
		{CreateColumnDef{Name: "payload", DataType: "JSONB", Sortable: true}, "JSON column cannot be a sort option"},
		{CreateColumnDef{Name: "created", DataType: "TIMESTAMPTZ", Sortable: true}, "already has its own sort options"},
		{CreateColumnDef{Name: "Updated", DataType: "TIMESTAMPTZ", Sortable: true}, "already has its own sort options"},
	} {
		_, err := validateCreateColumnList([]CreateColumnDef{id, testCase.column})
		if err == nil || !strings.Contains(err.Error(), testCase.reason) {
			t.Fatalf("%+v: err = %v, want %q", testCase.column, err, testCase.reason)
		}
	}
	// The same columns pass where the rule allows them.
	for _, column := range []CreateColumnDef{
		{Name: "amount", DataType: "INTEGER", IsMultilingual: &no, Sortable: true},
		{Name: "published", DataType: "BOOLEAN NOT NULL DEFAULT FALSE", VisibilityGate: true},
		{Name: "payload", DataType: "JSONB", HideInFilterPanel: true},
		{Name: "created", DataType: "TIMESTAMPTZ NOT NULL DEFAULT NOW()"},
	} {
		if _, err := validateCreateColumnList([]CreateColumnDef{id, column}); err != nil {
			t.Fatalf("%+v: %v", column, err)
		}
	}
}

func TestCreateRequestChoosesLanguagesOnlyWhenItSaysSo(t *testing.T) {
	yes := true
	silent := []CreateColumnDef{{Name: "title", DataType: "TEXT"}}
	if choosesColumnLanguages(CreateTableRequest{}, silent) {
		t.Fatal("a request silent about languages must leave the metadata defaults alone")
	}
	if !choosesColumnLanguages(CreateTableRequest{NewColumnsMultilingual: &yes}, silent) {
		t.Fatal("the dataset's default is a language choice")
	}
	if !choosesColumnLanguages(CreateTableRequest{}, []CreateColumnDef{{Name: "title", DataType: "TEXT", IsMultilingual: &yes}}) {
		t.Fatal("a column's own choice is a language choice")
	}
}

func TestCreateColumnSettingsWriteOnlyWhatTheListSets(t *testing.T) {
	q := &roleRecorder{rows: 1}
	err := applyCreateColumnSettings(q, "Services", []CreateColumnDef{
		{Name: "id", DataType: "SERIAL"},
		{Name: "Name", DataType: "TEXT", Sortable: true},
		{Name: "keywords", DataType: "TEXT", HideInFilterPanel: true},
		{Name: "published", DataType: "BOOLEAN", VisibilityGate: true},
		{Name: "category_id", DataType: "INTEGER", Sortable: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	unset, on := sql.NullBool{}, sql.NullBool{Bool: true, Valid: true}
	expected := [][]interface{}{
		{unset, sql.NullInt64{Int64: 1, Valid: true}, unset, "services", "name"},
		{unset, sql.NullInt64{}, on, "services", "keywords"},
		{on, sql.NullInt64{}, unset, "services", "published"},
		// Sortable columns are numbered 1…n in list order.
		{unset, sql.NullInt64{Int64: 2, Valid: true}, unset, "services", "category_id"},
	}
	if !reflect.DeepEqual(q.args, expected) {
		t.Fatalf("args = %v, want %v", q.args, expected)
	}

	quiet := &roleRecorder{rows: 1}
	if err := applyCreateColumnSettings(quiet, "services", []CreateColumnDef{{Name: "title", DataType: "TEXT"}}); err != nil || len(quiet.args) != 0 {
		t.Fatalf("a list without settings must write nothing: err=%v args=%v", err, quiet.args)
	}
	for _, failing := range []*roleRecorder{{rows: 0}, {rows: 2}, {rows: 1, err: errors.New("write failed")}} {
		if err := applyCreateColumnSettings(failing, "services", []CreateColumnDef{{Name: "title", DataType: "TEXT", Sortable: true}}); err == nil {
			t.Fatal("a settings write that did not reach exactly one column must abort the creation")
		}
	}
}

func TestCreatedDatasetCachesAreDroppedOnlyAfterTheCommit(t *testing.T) {
	db := newWorkflowQueueTestDB(t)
	defer db.Close()
	for _, finish := range []string{"commit", "rollback"} {
		lt := dbutils.NewLazyTx(db)
		if _, err := lt.Begin(); err != nil {
			t.Fatal(err)
		}
		var invalidated []string
		scheduleCreatedDatasetCacheInvalidation(dbutils.SetLazyTx(context.Background(), lt), "services",
			func(tableName string) { invalidated = append(invalidated, tableName) })
		if len(invalidated) != 0 {
			t.Fatalf("%s: caches were dropped before the transaction ended", finish)
		}
		if finish == "commit" {
			if err := lt.Commit(); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(invalidated, []string{"services"}) {
				t.Fatalf("after the commit: invalidated %v, want the new dataset once", invalidated)
			}
			continue
		}
		_ = lt.Rollback()
		if len(invalidated) != 0 {
			t.Fatal("a rolled-back creation must leave the caches alone")
		}
	}

	var invalidated []string
	scheduleCreatedDatasetCacheInvalidation(context.Background(), "services",
		func(tableName string) { invalidated = append(invalidated, tableName) })
	if !reflect.DeepEqual(invalidated, []string{"services"}) {
		t.Fatalf("without a request transaction the caches are dropped at once, got %v", invalidated)
	}
}
