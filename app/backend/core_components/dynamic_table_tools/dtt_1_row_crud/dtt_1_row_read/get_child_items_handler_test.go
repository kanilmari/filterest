// get_child_items_handler_test.go
// Runs the related-rows endpoint end to end against a scripted database.
// Between the endpoint's HTTP answer and every statement it sends through the general
// connection and the viewer's role connection (backend.Db and backend.DbBasic), which these
// tests swap for scripted ones and restore afterwards, so they must never run in parallel.
// Exists to hold two answers the article depends on: a viewer who may read no relation gets
// an empty list, never null; and when the gallery's snapshot cannot start, the request fails
// before any related row or picture is read.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
)

// scriptedReads grows the one-answer driver of get_child_items_test.go
// (relatedItemsQueryDriver) into a database that answers each statement by what it asks,
// refuses every transaction, and records each statement and transaction start in order.
type scriptedReads struct {
	rules []scriptedRule

	mu         sync.Mutex
	steps      []scriptedStep
	unexpected []string
}

// scriptedRule answers every statement that contains fragment with these rows.
type scriptedRule struct {
	fragment string
	columns  []string
	rows     [][]driver.Value
	matches  func([]driver.Value) bool
}

// scriptedStep is one statement, or one transaction start, on the connection that got it.
type scriptedStep struct {
	connection string
	statement  string
	args       []driver.Value
	begin      *driver.TxOptions
}

func (reads *scriptedReads) record(step scriptedStep) {
	reads.mu.Lock()
	defer reads.mu.Unlock()
	reads.steps = append(reads.steps, step)
}

// recorded returns the steps so far and the statements no rule answered.
func (reads *scriptedReads) recorded() ([]scriptedStep, []string) {
	reads.mu.Lock()
	defer reads.mu.Unlock()
	return append([]scriptedStep(nil), reads.steps...), append([]string(nil), reads.unexpected...)
}

type scriptedDriver struct {
	reads      *scriptedReads
	connection string
}

func (scripted scriptedDriver) Open(string) (driver.Conn, error) {
	return scriptedConn{reads: scripted.reads, connection: scripted.connection}, nil
}

type scriptedConn struct {
	reads      *scriptedReads
	connection string
}

func (scriptedConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepared statements are not scripted")
}

func (scriptedConn) Close() error { return nil }

func (scriptedConn) Begin() (driver.Tx, error) {
	return nil, errors.New("a transaction without options is not scripted")
}

func (conn scriptedConn) BeginTx(_ context.Context, options driver.TxOptions) (driver.Tx, error) {
	conn.reads.record(scriptedStep{connection: conn.connection, begin: &options})
	return nil, errors.New("the scripted database starts no transaction")
}

func (conn scriptedConn) QueryContext(_ context.Context, statement string, args []driver.NamedValue) (driver.Rows, error) {
	values := make([]driver.Value, len(args))
	for index, arg := range args {
		values[index] = arg.Value
	}
	conn.reads.record(scriptedStep{connection: conn.connection, statement: statement, args: values})
	for _, rule := range conn.reads.rules {
		if strings.Contains(statement, rule.fragment) && (rule.matches == nil || rule.matches(values)) {
			return &scriptedRows{columns: rule.columns, rows: rule.rows}, nil
		}
	}
	conn.reads.mu.Lock()
	conn.reads.unexpected = append(conn.reads.unexpected, statement)
	conn.reads.mu.Unlock()
	return nil, fmt.Errorf("no scripted answer for %q", statement)
}

type scriptedRows struct {
	columns []string
	rows    [][]driver.Value
	next    int
}

func (rows *scriptedRows) Columns() []string { return rows.columns }
func (rows *scriptedRows) Close() error      { return nil }

func (rows *scriptedRows) Next(destination []driver.Value) error {
	if rows.next >= len(rows.rows) {
		return io.EOF
	}
	copy(destination, rows.rows[rows.next])
	rows.next++
	return nil
}

var scriptedDriverCounter atomic.Int64

// useScriptedDatabase puts the scripted database in place of the general connection and
// the basic role's connection (auth.GetDBForRole) for one test, and restores both after it.
func useScriptedDatabase(t *testing.T, rules []scriptedRule) *scriptedReads {
	t.Helper()
	reads := &scriptedReads{rules: rules}
	open := func(connection string) *sql.DB {
		name := fmt.Sprintf("scripted_related_reads_%d", scriptedDriverCounter.Add(1))
		sql.Register(name, scriptedDriver{reads: reads, connection: connection})
		db, err := sql.Open(name, "")
		if err != nil {
			t.Fatalf("sql.Open(%s): %v", name, err)
		}
		return db
	}
	general, role := open("general"), open("role")
	previousGeneral, previousBasic := backend.Db, backend.DbBasic
	backend.Db, backend.DbBasic = general, role
	t.Cleanup(func() {
		backend.Db, backend.DbBasic = previousGeneral, previousBasic
		_ = general.Close()
		_ = role.Close()
	})
	return reads
}

// parentWithAGallery scripts row 7 of parent_rows: visible to its viewer, with no row
// policy, no picture field and no relation of its own, and referred to by two datasets —
// parent_rows_notes, and parent_rows_assets, its gallery, which a shared-asset upload
// relation names. permission answers whether the viewer may read a related dataset.
func parentWithAGallery(permission scriptedRule) []scriptedRule {
	return []scriptedRule{
		{fragment: "must_be_true_unless_own", columns: []string{"column_name"}},
		{
			fragment: `SELECT EXISTS (SELECT 1 FROM "parent_rows"`,
			columns:  []string{"exists"},
			rows:     [][]driver.Value{{true}},
		},
		{
			fragment: "AS referencing_table",
			columns:  []string{"constraint_name", "referencing_table", "referencing_column", "referenced_table", "referenced_column"},
			rows: [][]driver.Value{
				{"parent_rows_notes_parent_rows_id_fkey", "parent_rows_notes", "parent_rows_id", "parent_rows", "id"},
				{"parent_rows_assets_parent_rows_id_fkey", "parent_rows_assets", "parent_rows_id", "parent_rows", "id"},
			},
		},
		permission,
		{
			fragment: "target_insert_specs",
			columns:  []string{"child_table", "parent_table", "source_column_name", "target_insert_specs"},
			rows: [][]driver.Value{{
				"parent_rows_assets", "parent_rows", "parent_rows_id",
				`{"file_upload": {"profile_key": "asset_linking", "filename_column": "filename", "profiles": {"image": {}}}}`,
			}},
		},
		{fragment: "information_schema.tables", columns: []string{"exists"}, rows: [][]driver.Value{{true}}},
		{
			fragment: "SELECT column_name, data_type",
			columns:  []string{"column_name", "data_type"},
			rows: [][]driver.Value{
				{"id", "bigint"}, {"parent_rows_id", "bigint"}, {"filename", "text"},
				{"asset_kind", "text"}, {"is_primary", "boolean"},
			},
		},
		{fragment: "tc.table_name = $1", columns: []string{"referencing_column", "referenced_table", "referenced_column"}},
		{fragment: "c.data_type IN", columns: []string{"column_name", "image_role", "hides_false"}},
	}
}

// requestRelatedRows asks the endpoint, as routed, for row 7 of parent_rows as a basic viewer.
func requestRelatedRows() *httptest.ResponseRecorder {
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/fetch-dynamic-children?dataset=parent_rows",
		strings.NewReader(`{"parent_dataset":"parent_rows","parent_pk_value":"7"}`),
	)
	request = request.WithContext(dbutils.SetRequestActorContext(
		request.Context(),
		dbutils.NewRequestActorContext(42, "basic"),
	))
	response := httptest.NewRecorder()
	GetDynamicChildItemsHandler(response, request)
	return response
}

// A viewer who may read the parent but none of the datasets that refer to it still gets a
// final answer: an empty list, which the browser takes as the gallery and pictures there
// are. null would be no answer at all.
func TestRelatedRowsAnswerAnEmptyListWhenNoRelationIsReadable(t *testing.T) {
	reads := useScriptedDatabase(t, parentWithAGallery(scriptedRule{
		fragment: "system_group_table_func_rights", // no grant row: not readable
		columns:  []string{"granted"},
	}))

	response := requestRelatedRows()

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("the answer is not a JSON object: %v; body=%s", err, response.Body.String())
	}
	if got := string(body["child_tables"]); got != "[]" {
		t.Fatalf("child_tables = %s, want exactly []", got)
	}
	if _, named := body["gallery_relation"]; named {
		t.Fatalf("a gallery this viewer may not read was named: %s", response.Body.String())
	}

	steps, unexpected := reads.recorded()
	if len(unexpected) > 0 {
		t.Fatalf("statements nobody scripted: %q", unexpected)
	}
	asked := map[string]bool{}
	for _, step := range steps {
		if step.begin != nil {
			t.Fatal("a snapshot was started for a gallery this viewer may not read")
		}
		if strings.Contains(step.statement, "system_group_table_func_rights") && len(step.args) == 3 {
			asked[fmt.Sprint(step.args[2])] = true
		}
		for _, related := range []string{`FROM "parent_rows_notes"`, `FROM "parent_rows_assets"`} {
			if strings.Contains(step.statement, related) {
				t.Fatalf("a dataset this viewer may not read was read: %s", step.statement)
			}
		}
	}
	// Both relations exist and were refused, so the empty list is the refusal's answer and
	// not a parent without relations.
	if !asked["parent_rows_notes"] || !asked["parent_rows_assets"] {
		t.Fatalf("the viewer's permission was not asked for both relations: %v", asked)
	}
}

// The gallery rows and the parent's shown picture are read in one read-only REPEATABLE READ
// snapshot, so a picture deleted or marked primary meanwhile cannot make them disagree. When
// the snapshot cannot start, the request fails, and nothing is read after the attempt: no
// gallery row, no other related row, no picture.
func TestRelatedRowsFailBeforeAnyReadWhenTheGallerySnapshotCannotStart(t *testing.T) {
	reads := useScriptedDatabase(t, parentWithAGallery(scriptedRule{
		fragment: "system_group_table_func_rights", // a grant row: readable
		columns:  []string{"granted"},
		rows:     [][]driver.Value{{int64(1)}},
	}))

	response := requestRelatedRows()

	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "error reading the gallery") {
		t.Fatalf("status = %d, body=%s; want %d for the gallery snapshot", response.Code, response.Body.String(), http.StatusInternalServerError)
	}

	steps, unexpected := reads.recorded()
	if len(unexpected) > 0 {
		t.Fatalf("statements nobody scripted: %q", unexpected)
	}
	attempt := -1
	for index, step := range steps {
		if step.begin == nil {
			continue
		}
		if attempt >= 0 {
			t.Fatal("the snapshot was attempted more than once")
		}
		attempt = index
	}
	if attempt < 0 {
		t.Fatal("no snapshot was attempted for a gallery the viewer may read")
	}
	snapshot := steps[attempt]
	if snapshot.connection != "role" {
		t.Fatalf("the snapshot was attempted on the %s connection, want the viewer's role connection", snapshot.connection)
	}
	if snapshot.begin.Isolation != driver.IsolationLevel(sql.LevelRepeatableRead) || !snapshot.begin.ReadOnly {
		t.Fatalf("snapshot options = %+v, want a read-only REPEATABLE READ transaction", *snapshot.begin)
	}
	if after := steps[attempt+1:]; len(after) > 0 {
		statements := make([]string, 0, len(after))
		for _, step := range after {
			statements = append(statements, step.statement)
		}
		t.Fatalf("reads ran after the failed snapshot: %q", statements)
	}
}
