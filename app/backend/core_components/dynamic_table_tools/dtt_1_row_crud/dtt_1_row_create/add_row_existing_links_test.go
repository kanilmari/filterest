// add_row_existing_links_test.go
// Verifies fail-closed relation resolution and exact-count existing-row linking.
// Bridges stable relation IDs with the dynamic SQL helpers without a production database.
// Exists to prevent client-supplied table names or partial relation writes from returning.
package dtt_1_row_create

import (
	"context"
	"database/sql"
	"database/sql/driver"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"os"
	"strings"
	"testing"
)

func TestResolveOneToManyExistingLinkUsesRegisteredRelation(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	pushQuery(queuedQuery{
		cols: []string{"id", "source_table_uid", "table_name", "source_column_name", "target_insert_specs"},
		rows: [][]driver.Value{{int64(41), "10", "tickets", "documentation_id", `{}`}},
	})
	relation, err := resolveOneToManyExistingLink(tx, "9", ExistingRelationLinkPayload{
		RelationKind: existingRelationOneToMany,
		RelationID:   41,
		RowIDs:       []int64{7, 8},
	})
	if err != nil {
		t.Fatalf("resolveOneToManyExistingLink() error = %v", err)
	}
	if relation.RelatedTableName != "tickets" || relation.RelatedForeignKey != "documentation_id" {
		t.Fatalf("resolved relation = %#v", relation)
	}
	if len(relation.RowIDs) != 2 || relation.RowIDs[1] != 8 {
		t.Fatalf("resolved row IDs = %#v", relation.RowIDs)
	}
}

func TestResolveOneToManyExistingLinkRejectsAssetRelation(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	pushQuery(queuedQuery{
		cols: []string{"id", "source_table_uid", "table_name", "source_column_name", "target_insert_specs"},
		rows: [][]driver.Value{{int64(42), "302", "documentation_assets", "documentation_id", `{"file_upload":{"enabled":true}}`}},
	})
	_, err = resolveOneToManyExistingLink(tx, "9", ExistingRelationLinkPayload{
		RelationKind: existingRelationOneToMany,
		RelationID:   42,
		RowIDs:       []int64{7},
	})
	if err == nil {
		t.Fatal("asset relation unexpectedly accepted as link-existing")
	}
}

func TestApplyExistingLinksRequiresExactOneToManyCount(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	pushExec(queuedExec{rowsAffected: 1})
	err = applyExistingLinks(tx, 100, []resolvedExistingLink{{
		Kind:              existingRelationOneToMany,
		RelatedTableName:  "tickets",
		RelatedForeignKey: "documentation_id",
		RowIDs:            []int64{7, 8},
	}})
	if err == nil {
		t.Fatal("partial one-to-many update unexpectedly accepted")
	}
}

func TestApplyExistingLinksCreatesEveryManyToManyBridge(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	pushExec(queuedExec{rowsAffected: 1})
	pushExec(queuedExec{rowsAffected: 1})
	err = applyExistingLinks(tx, 100, []resolvedExistingLink{{
		Kind:                  existingRelationManyToMany,
		BridgeTableName:       "documentation_services_relation",
		BridgeMainForeignKey:  "documentation_id",
		BridgeOtherForeignKey: "service_id",
		RowIDs:                []int64{7, 8},
	}})
	if err != nil {
		t.Fatalf("applyExistingLinks() error = %v", err)
	}
}

func TestUniquePositiveRowIDsDeduplicatesAndFiltersInvalidValues(t *testing.T) {
	got := uniquePositiveRowIDs([]int64{7, 0, -1, 7, 9})
	if len(got) != 2 || got[0] != 7 || got[1] != 9 {
		t.Fatalf("uniquePositiveRowIDs() = %#v", got)
	}
}

func TestResolveAndAuthorizeExistingLinksRejectsInvalidRowIDBeforeDatabaseAccess(t *testing.T) {
	_, err := resolveAndAuthorizeExistingLinks(nil, "9", []ExistingRelationLinkPayload{{
		RelationKind: existingRelationManyToMany,
		RelationID:   12,
		RowIDs:       []int64{7, 0},
	}}, 1, "admin")
	if err == nil {
		t.Fatal("invalid relation row identifier unexpectedly accepted")
	}
}

func TestRequiredForeignKeyCannotSkipValidation(t *testing.T) {
	columns := []dtt_models.AddRowColumnInfo{{ColumnName: "status", DataType: "text", IsNullable: "NO", ForeignTableName: "statuses", ForeignColumnName: "slug"}}
	for _, row := range []map[string]interface{}{{}, {"status": ""}, {"status": "  "}, {"status": nil}} {
		if err := normalizeMainForeignKeyValues(columns, row); err == nil {
			t.Errorf("required FK accepted missing value: %#v", row)
		}
	}
}

func TestForeignKeyMissingValueSemantics(t *testing.T) {
	tests := []struct {
		name, nullable, defaultValue string
		row                          map[string]interface{}
		want                         interface{}
		present, wantError           bool
	}{
		{"nullable blank", "YES", "", map[string]interface{}{"status": ""}, nil, true, false},
		{"nullable null", "YES", "", map[string]interface{}{"status": nil}, nil, true, false},
		{"nullable absent", "YES", "", map[string]interface{}{}, nil, false, false},
		{"default absent", "NO", "'new'", map[string]interface{}{}, nil, false, false},
		{"default untouched", "NO", "'new'", map[string]interface{}{"status": " "}, nil, false, false},
		{"explicit null does not mean default", "NO", "'new'", map[string]interface{}{"status": nil}, nil, true, true},
		{"selected text key", "NO", "", map[string]interface{}{"status": "new"}, "new", true, false},
		{"selected zero remains actual value", "NO", "", map[string]interface{}{"status": 0}, 0, true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			col := dtt_models.AddRowColumnInfo{ColumnName: "status", IsNullable: tt.nullable, ColumnDefault: tt.defaultValue, ForeignTableName: "statuses", ForeignColumnName: "slug"}
			err := normalizeMainForeignKeyValues([]dtt_models.AddRowColumnInfo{col}, tt.row)
			if (err != nil) != tt.wantError {
				t.Fatalf("error=%v", err)
			}
			v, ok := tt.row["status"]
			if ok != tt.present || v != tt.want {
				t.Fatalf("value=%#v present=%v", v, ok)
			}
		})
	}
	// An ordinary text column is not a foreign key and retains its empty string.
	row := map[string]interface{}{"title": ""}
	if err := normalizeMainForeignKeyValues([]dtt_models.AddRowColumnInfo{{ColumnName: "title", IsNullable: "NO"}}, row); err != nil || row["title"] != "" {
		t.Fatalf("non-FK changed: %#v %v", row, err)
	}
}

// The optional integration target is a disposable /tmp cluster only. This test
// never connects to the native application database or uses real ticket data.
func TestForeignKeyMainInsertInIsolatedPostgres(t *testing.T) {
	socket := os.Getenv("FILTEREST_ADD_ROW_TEST_SOCKET")
	if socket == "" {
		t.Skip("isolated PostgreSQL fixture not requested")
	}
	if !strings.HasPrefix(socket, "/tmp/filterest-add-row-") || !strings.HasSuffix(socket, "/socket") {
		t.Fatal("test requires its disposable /tmp socket")
	}
	db, err := sql.Open("postgres", "host="+socket+" port=54491 dbname=postgres user=user sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	for _, query := range []string{
		"CREATE TEMP TABLE add_row_test_statuses (slug TEXT PRIMARY KEY)",
		"INSERT INTO add_row_test_statuses VALUES ('new')",
		"CREATE TEMP TABLE add_row_test_tickets (id SERIAL PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL REFERENCES add_row_test_statuses(slug),related_status TEXT REFERENCES add_row_test_statuses(slug),priority TEXT NOT NULL DEFAULT 'normal',tags TEXT[] DEFAULT '{}',issue_type TEXT NOT NULL DEFAULT 'task',created TIMESTAMPTZ NOT NULL DEFAULT now())",
	} {
		if _, err = tx.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	columns := []dtt_models.AddRowColumnInfo{
		{ColumnName: "status", DataType: "text", IsNullable: "NO", ForeignTableName: "add_row_test_statuses", ForeignColumnName: "slug"},
		{ColumnName: "related_status", DataType: "text", IsNullable: "YES", ForeignTableName: "add_row_test_statuses", ForeignColumnName: "slug"},
	}
	if err = normalizeMainForeignKeyValues(columns, map[string]interface{}{"status": ""}); err == nil {
		t.Fatal("missing required status accepted")
	}
	row := map[string]interface{}{"title": "synthetic fixture", "content": "isolated contract", "status": "new", "related_status": ""}
	if err = normalizeMainForeignKeyValues(columns, row); err != nil {
		t.Fatal(err)
	}
	id, err := insertMainRow(context.Background(), tx, "add_row_test_tickets", row, map[string]string{"title": "text", "content": "text", "status": "text", "related_status": "text"})
	if err != nil {
		t.Fatalf("valid main INSERT: %v", err)
	}
	var status, priority, issueType string
	var relatedNull, tagsEmpty, created bool
	err = tx.QueryRow("SELECT status,priority,issue_type,related_status IS NULL,tags='{}'::text[],created IS NOT NULL FROM add_row_test_tickets WHERE id=$1", id).Scan(&status, &priority, &issueType, &relatedNull, &tagsEmpty, &created)
	if err != nil || status != "new" || priority != "normal" || issueType != "task" || !relatedNull || !tagsEmpty || !created {
		t.Fatalf("readback: %s/%s/%s nullable=%v tags=%v created=%v error=%v", status, priority, issueType, relatedNull, tagsEmpty, created, err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = db.QueryRow("SELECT count(*) FROM pg_class WHERE relname='add_row_test_tickets'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback cleanup count=%d error=%v", count, err)
	}
}

func TestForeignKeyNormalizationPreservesSupportedActorInsertSpecs(t *testing.T) {
	for _, column := range []dtt_models.AddRowColumnInfo{
		{ColumnName: "user_id", ForeignTableName: "system_users", ForeignColumnName: "id", IsNullable: "NO", SourceInsertSpecs: `{"user_id":"currentUser"}`},
		{ColumnName: "cached_username", ForeignTableName: "system_users", ForeignColumnName: "username", IsNullable: "NO", SourceInsertSpecs: `{"cached_username":"currentUserName"}`},
	} {
		t.Run(column.ColumnName, func(t *testing.T) {
			row := map[string]interface{}{}
			if err := normalizeMainForeignKeyValues([]dtt_models.AddRowColumnInfo{column}, row); err != nil {
				t.Fatalf("server-filled actor FK was rejected before source_insert_specs ran: %v", err)
			}
			if len(row) != 0 {
				t.Fatalf("normalization invented actor data: %#v", row)
			}
		})
	}
	for _, specs := range []string{`{"user_id":"otherUser"}`, `{"cached_username":"currentUserName"}`, `{"user_id":7}`, "not-json"} {
		column := dtt_models.AddRowColumnInfo{ColumnName: "user_id", ForeignTableName: "system_users", ForeignColumnName: "id", IsNullable: "NO", SourceInsertSpecs: specs}
		if err := normalizeMainForeignKeyValues([]dtt_models.AddRowColumnInfo{column}, map[string]interface{}{}); err == nil {
			t.Errorf("unsupported actor spec bypassed required validation: %s", specs)
		}
	}
}
