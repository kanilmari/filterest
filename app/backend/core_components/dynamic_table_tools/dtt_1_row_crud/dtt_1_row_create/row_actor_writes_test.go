// row_actor_writes_test.go
// Verifies main-row and child-row actor stamps and request-value refusals.
// Reuses the ownership writer and queue database used by the add-row tests.
// Marks win over request values, insertability and foreign-user read checks.
package dtt_1_row_create

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadActorColumnsOmitsNullRoles(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	for _, tc := range []struct {
		rows [][]driver.Value
		want int
	}{
		{[][]driver.Value{{nil, "creator"}, {nil, "owner"}}, 0},
		{[][]driver.Value{{nil, "creator"}, {"user_id", "owner"}}, 1},
	} {
		pushQuery(queuedQuery{cols: []string{"column_name", "actor_role"}, rows: tc.rows})
		marks, err := row_mutation_policy.ReadRowActorColumns(db, "notes")
		if err != nil || len(marks) != tc.want || marks[""] != "" {
			t.Fatalf("NULL roles: %v, %v", marks, err)
		}
	}
}

func TestActorReadFailureDoesNotExposeDatabaseDetails(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	pushQuery(queuedQuery{err: errors.New("private database detail")})
	req := buildRequestWithSessionValues(t, map[interface{}]interface{}{"user_id": 1, "user_role": "guest"})
	rec := httptest.NewRecorder()
	_, _, err = insertDataAccordingToPayload(rec, req, "notes", "42", map[string]interface{}{}, tx)
	if err == nil || rec.Code != 500 || strings.Contains(rec.Body.String(), "private database detail") {
		t.Fatalf("%d %s %v", rec.Code, rec.Body, err)
	}
}

func TestMarkedActorStampAndForeignKeyChecks(t *testing.T) {
	marks := row_mutation_policy.RowActorColumns{"created_by": "creator", "user_id": "owner"}
	cols := []dtt_models.AddRowColumnInfo{{ColumnName: "created_by", Insertable: sql.NullBool{Bool: true, Valid: true}, ForeignTableName: "system_users", ForeignColumnName: "id", IsNullable: "NO"}, {ColumnName: "user_id", Insertable: sql.NullBool{Bool: true, Valid: true}, ForeignTableName: "system_users", ForeignColumnName: "id", IsNullable: "NO"}}
	for _, user := range []int{-1, 0, 1, 42} {
		row := map[string]interface{}{"created_by": 999, "user_id": 999}
		applyCurrentActorOwnership(row, cols, user, "", marks)
		var want interface{}
		if user > 1 {
			want = user
		}
		for column := range marks {
			if row[column] != want {
				t.Fatalf("user=%d %s=%v", user, column, row[column])
			}
		}
		if err := normalizeMainForeignKeyValues(cols, row, marks); err != nil {
			t.Fatal(err)
		}
		checked, err := validateMainForeignKeyReads(nil, cols, row, user, "guest", marks)
		if err != nil || len(checked) != 0 {
			t.Fatalf("server stamp required reading users: %v %v", checked, err)
		}
	}
}
func TestInsertRequestActorValueRefusedBeforeAnyWrite(t *testing.T) {
	original := currentUserDisplayName
	currentUserDisplayName = func(context.Context, int) (string, error) { return "test actor", nil }
	t.Cleanup(func() { currentUserDisplayName = original })
	for _, user := range []int{1, 42} {
		for column, role := range map[string]string{"created_by": "creator", "user_id": "owner"} {
			resetQueues()
			t.Cleanup(resetQueues)
			db := newTestDB(t)
			defer db.Close()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			pushQuery(queuedQuery{cols: []string{"column_name", "actor_role"}, rows: [][]driver.Value{{"created_by", "creator"}, {"user_id", "owner"}}})
			req := buildRequestWithSessionValues(t, map[interface{}]interface{}{"user_id": user, "user_role": "basic"})
			rec := httptest.NewRecorder()
			_, _, err = insertDataAccordingToPayload(rec, req, "app_service_catalog", "42", map[string]interface{}{column: nil}, tx)
			if err == nil || rec.Code != 400 || !strings.Contains(rec.Body.String(), "error_"+role+"_column_not_editable") {
				t.Fatalf("user=%d %s: %d %s %v", user, column, rec.Code, rec.Body, err)
			}
			if len(queryQueue) != 0 {
				t.Fatal("actor marks not read")
			}
		}
	}
}
