// article_presentations_postgres_test.go
// Proves the atomic editor on disposable native PostgreSQL using release migrations.
// Connects revision conflicts, complete readback, rollback and unchanged target evidence.
// The shared fixture tears down its owned cluster even after a failed assertion.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func articleEditorDB(t *testing.T) *sql.DB {
	db := articleBundleFixture(t, true)
	frontPageExec(t, db, articleBundleSQL(t, "20261015000017_add_article_presentations_editor.sql"))
	return db
}
func articleEditorRead(t *testing.T, q interface {
	Query(string, ...any) (*sql.Rows, error)
	QueryRow(string, ...any) *sql.Row
	Exec(string, ...any) (sql.Result, error)
}, scope string, ids ...int64) articleSnapshot {
	t.Helper()
	targets := []articleTarget{}
	if scope == "site" {
		targets = append(targets, articleTarget{articlePrincipal: articlePrincipal{Scope: scope}})
	} else {
		for _, id := range ids {
			p := articlePrincipal{Scope: scope}
			if scope == "group" {
				p.GroupID = id
			} else {
				p.UserID = id
			}
			targets = append(targets, articleTarget{articlePrincipal: p})
		}
	}
	s, err := readArticleSnapshot(q, "article_fixture", 10, 42, targets)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func TestArticlePresentationsReadbackPreservationPostgres(t *testing.T) {
	db := articleEditorDB(t)
	untouched := articleEditorRead(t, db, "group", 8, 9)
	personal := articleEditorRead(t, db, "personal", 42)
	before := articleEditorRead(t, db, "site")
	policy := articleBundleText(t, db, `SELECT article_opener_policy::text FROM system_db_tables WHERE table_uid=10`)
	input := copyArticleSnapshot(before)
	// Empty all projections independently, with explicit widths and hidden-field order.
	for i := range input.Targets[0].Members {
		m := &input.Targets[0].Members[i]
		for _, key := range articlePresentationKeys {
			cell := m.Values[key]
			cell.Visible = false
			m.Values[key] = cell
		}
	}
	members := input.Targets[0].Members
	members[0], members[1] = members[1], members[0]
	width := 315
	cell := members[0].Values["image_first_page_view"]
	cell.Width = &width
	members[0].Values["image_first_page_view"] = cell
	input.Blocks["article_view"]["images"] = false
	tx, _ := db.Begin()
	result, err := persistArticlePresentations(tx, input, 42)
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	readback := articleEditorRead(t, db, "site")
	if !reflect.DeepEqual(result, readback) || !reflect.DeepEqual(input.Targets[0].Members, readback.Targets[0].Members) || !reflect.DeepEqual(input.Blocks, readback.Blocks) {
		t.Fatal("readback differs from complete write")
	}
	if !reflect.DeepEqual(untouched, articleEditorRead(t, db, "group", 8, 9)) { // Blocks revision is a dataset-wide dependency and may change.
		after := articleEditorRead(t, db, "group", 8, 9)
		if !reflect.DeepEqual(untouched.Targets, after.Targets) {
			t.Fatal("untouched group widths/priorities/order changed")
		}
	}
	if !reflect.DeepEqual(personal.Targets, articleEditorRead(t, db, "personal", 42).Targets) {
		t.Fatal("untouched personal changed")
	}
	if policy != articleBundleText(t, db, `SELECT article_opener_policy::text FROM system_db_tables WHERE table_uid=10`) {
		t.Fatal("opener policy changed")
	}
}
func TestArticlePresentationsStaleAndForbiddenPostgres(t *testing.T) {
	db := articleEditorDB(t)
	// Field 6 predates materialization and is legitimately absent. Add a new
	// field through the lifecycle trigger, then restrict it: it must remain a
	// complete, hidden member and a visible write must be rejected for that reason.
	frontPageExec(t, db, `INSERT INTO system_column_details(column_uid,table_uid,column_name,co_number) VALUES(7,10,'restricted_added_field',5);
	 UPDATE system_column_details SET hide_everywhere=true,client_delivery_mode='server_only' WHERE column_uid=7`)
	input := articleEditorRead(t, db, "site")
	frontPageExec(t, db, `SELECT app_save_article_projection(10,'article_view',NULL,NULL,0,ARRAY[1],NULL,42)`)
	tx, _ := db.Begin()
	_, err := persistArticlePresentations(tx, input, 42)
	_ = tx.Rollback()
	if !errors.Is(err, errArticleRevisionConflict) {
		t.Fatal("distinct stale conflict", err)
	}
	fresh := articleEditorRead(t, db, "site")
	input = copyArticleSnapshot(fresh)
	found := false
	for i := range input.Targets[0].Members {
		if input.Targets[0].Members[i].UID == 7 {
			input.Targets[0].Members[i].Values["article_view"] = articleCell{Visible: true}
			found = true
		}
	}
	if !found {
		t.Fatal("restricted lifecycle member missing from the fixture")
	}
	tx, _ = db.Begin()
	_, err = persistArticlePresentations(tx, input, 42)
	_ = tx.Rollback()
	if err == nil {
		t.Fatal("forbidden field accepted")
	}
	if !reflect.DeepEqual(fresh, articleEditorRead(t, db, "site")) {
		t.Fatal("failed write changed data")
	}
}

func TestArticlePresentationsInheritedBundleMembershipPostgres(t *testing.T) {
	db := articleEditorDB(t)
	site := articleEditorRead(t, db, "site")
	before := articleEditorRead(t, db, "group", 3)
	input := copyArticleSnapshot(before)
	input.Blocks = nil
	if len(input.Targets[0].Assignments) != 0 {
		t.Fatal("fixture must start with an unassigned target")
	}
	for _, key := range articlePresentationKeys {
		input.Targets[0].Assignments = append(input.Targets[0].Assignments, articleLink{key, 0, "Inherited site bundle", 0})
	}
	for _, kind := range []string{"missing", "catalogue-only", "foreign", "duplicate"} {
		t.Run(kind, func(t *testing.T) {
			members := copyArticleSnapshot(input).Targets[0].Members
			switch kind {
			case "missing":
				members = members[:len(members)-1]
			case "catalogue-only":
				members[0].UID = 6
			case "foreign":
				members[0].UID = 99
			case "duplicate":
				members[0].UID = members[1].UID
			}
			raw, err := json.Marshal(members)
			if err != nil {
				t.Fatal(err)
			}
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			var id int64
			if err = tx.QueryRow(`SELECT app_save_article_presentations(10,NULL,3,0,$1::jsonb,'Incomplete inherited bundle',42)`, string(raw)).Scan(&id); err == nil {
				t.Fatal("SQL service accepted", kind, "member list")
			}
		})
	}
	if !reflect.DeepEqual(before, articleEditorRead(t, db, "group", 3)) {
		t.Fatal("refused writes changed the unassigned target")
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	result, err := persistArticlePresentations(tx, input, 42)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result.Targets[0].Members, input.Targets[0].Members) {
		t.Fatal("new target expanded the inherited bundle instead of preserving its complete membership")
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result, articleEditorRead(t, db, "group", 3)) || !reflect.DeepEqual(site, articleEditorRead(t, db, "site")) {
		t.Fatal("inherited readback or untouched site changed")
	}
}
func TestArticlePresentationsGroupScopeAtomicRollbackPostgres(t *testing.T) {
	db := articleEditorDB(t)
	before := articleEditorRead(t, db, "group", 8, 9)
	input := copyArticleSnapshot(before)
	input.Blocks = nil
	for i := range input.Targets {
		for j := range input.Targets[i].Assignments {
			input.Targets[i].Assignments[j].Name = "same-conflicting-name"
		}
	}
	tx, _ := db.Begin()
	_, err := persistArticlePresentations(tx, input, 42)
	if err == nil {
		t.Fatal("expected second-target unique-name failure")
	}
	_ = tx.Rollback()
	if !reflect.DeepEqual(before, articleEditorRead(t, db, "group", 8, 9)) {
		t.Fatal("partial target committed")
	}
	// Group blocks are refused before either target is changed.
	tx, _ = db.Begin()
	_, err = persistArticlePresentations(tx, before, 42)
	_ = tx.Rollback()
	if err == nil {
		t.Fatal("group blocks accepted")
	}
	input = copyArticleSnapshot(before)
	input.Blocks = nil
	for i := range input.Targets {
		for j := range input.Targets[i].Assignments {
			input.Targets[i].Assignments[j].Priority = 20 + i
		}
	}
	tx, _ = db.Begin()
	_, err = persistArticlePresentations(tx, input, 42)
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	after := articleEditorRead(t, db, "group", 8, 9)
	if !reflect.DeepEqual(before.Blocks, after.Blocks) {
		t.Fatal("group wrote dataset blocks")
	}
	for i := range after.Targets {
		if !reflect.DeepEqual(before.Targets[i].Members, after.Targets[i].Members) || after.Targets[i].Assignments[0].Priority != 20+i {
			t.Fatal("order/widths/priority lost")
		}
	}
	personal := articleEditorRead(t, db, "personal", 42)
	tx, _ = db.Begin()
	_, err = persistArticlePresentations(tx, personal, 42)
	_ = tx.Rollback()
	if err == nil {
		t.Fatal("personal blocks accepted")
	}
}
