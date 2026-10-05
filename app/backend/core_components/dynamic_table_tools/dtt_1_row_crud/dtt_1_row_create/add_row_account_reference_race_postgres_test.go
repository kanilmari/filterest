// add_row_account_reference_race_postgres_test.go
// Proves on a disposable PostgreSQL that adding a row cannot store a reference to a user an administrator hid meanwhile.
// Bridges insertDataAccordingToPayload, run on a role that may read system_users but not update it (the signed-in
// users' role after WL124 stage 2a), with an administrator's editor lock and update on another connection.
// Exists because the account-table reference check takes no row lock (P4a), so the add-row path repeats it after the
// insert, when the insert's foreign-key check holds the row. Every interleaving is forced with locks and a wait on
// pg_blocking_pids, never with timing.
package dtt_1_row_create

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
)

const raceReaderRole = "wl124_basic"

// Alice and Bob belong to the users group, which may read the users dataset and add notes; a note's reviewer refers
// to a user, and a note's watchers are users linked through a many-to-many bridge. As on the local development
// database, a disabled user is hidden from everyone else.
const raceFixture = `
CREATE TABLE system_users (id integer PRIMARY KEY, username text NOT NULL UNIQUE, enabled boolean NOT NULL DEFAULT true);
CREATE TABLE system_db_tables (
    table_uid integer PRIMARY KEY, table_name text NOT NULL UNIQUE, schema_name text NOT NULL DEFAULT 'public',
    row_policy_owner_column text
);
CREATE TABLE system_column_details (
    table_uid bigint NOT NULL, column_name text NOT NULL, must_be_true_unless_own boolean NOT NULL DEFAULT false,
    insertable boolean, is_multilingual boolean, hide_everywhere boolean, client_delivery_mode text, co_number integer
);
CREATE TABLE system_languages (
    language_code text, english_name text, native_name text, is_default boolean, sort_order integer,
    is_enabled boolean, public_selector_ready boolean, coverage_status text, review_status text
);
CREATE TABLE system_foreign_key_relations_1_m (
    id bigint PRIMARY KEY, source_table_uid bigint, target_table_uid bigint, source_column_name text,
    target_column_name text, reference_direction text, insert_new_target_with_source boolean,
    insert_new_source_with_target boolean, source_insert_specs jsonb, target_insert_specs jsonb
);
CREATE TABLE system_functions (id bigint PRIMARY KEY, url_route_endpoint text NOT NULL, disabled boolean NOT NULL DEFAULT false);
CREATE TABLE system_group_table_func_rights (
    id bigserial PRIMARY KEY, user_group_id bigint NOT NULL, function_id bigint NOT NULL, target_table_uid bigint,
    target_schema_name text NOT NULL DEFAULT 'public'
);
CREATE TABLE system_user_group_memberships (user_id bigint, group_id bigint);
CREATE TABLE system_permission_actions (
    id bigint PRIMARY KEY, action_key text NOT NULL, enabled boolean NOT NULL DEFAULT true, scope_type text NOT NULL DEFAULT 'row'
);
CREATE TABLE system_row_access_rules (
    table_uid bigint, action_id bigint, row_id bigint, user_id bigint, group_id bigint, effect text,
    valid_from timestamptz NOT NULL DEFAULT now(), valid_until timestamptz
);
CREATE TABLE system_foreign_key_relations_m_m (
    id bigint PRIMARY KEY, table_a_uid bigint, table_b_uid bigint, bridging_table_uid bigint, bridging_col_a text, bridging_col_b text
);
CREATE TABLE review_notes (id serial PRIMARY KEY, title text NOT NULL, reviewer_id integer REFERENCES system_users(id));
CREATE TABLE review_note_watchers (
    id serial PRIMARY KEY, review_notes_id integer NOT NULL REFERENCES review_notes(id),
    system_users_id integer NOT NULL REFERENCES system_users(id)
);
INSERT INTO system_db_tables (table_uid, table_name) VALUES (21, 'review_note_watchers');
INSERT INTO system_foreign_key_relations_m_m VALUES (1, 20, 1, 21, 'review_notes_id', 'system_users_id');
INSERT INTO system_group_table_func_rights (user_group_id, function_id, target_table_uid) VALUES (3, 11, 21);

INSERT INTO system_permission_actions (id, action_key) VALUES (1, 'read'), (2, 'update'), (3, 'delete');
INSERT INTO system_db_tables (table_uid, table_name) VALUES (1, 'system_users'), (20, 'review_notes');
INSERT INTO system_column_details (table_uid, column_name, must_be_true_unless_own) VALUES
    (1, 'enabled', true), (1, 'username', false), (20, 'title', false), (20, 'reviewer_id', false);
INSERT INTO system_users (id, username, enabled) VALUES (1, 'guest', true), (2, 'admin', true), (4, 'alice', true), (12, 'bob', true);
INSERT INTO system_functions (id, url_route_endpoint) VALUES (10, '/api/get-results'), (11, '/api/add-row-multipart');
INSERT INTO system_group_table_func_rights (user_group_id, function_id, target_table_uid) VALUES (3, 10, 1), (3, 10, 20), (3, 11, 20);
INSERT INTO system_user_group_memberships (user_id, group_id) VALUES (4, 3), (12, 3);
`

// raceCluster starts a disposable cluster, loads the fixture as the owning superuser, and returns that connection
// plus one for a login role that, like the signed-in users' role after stage 2a, reads every table, adds notes and
// updates nothing.
func raceCluster(t *testing.T) (*sql.DB, *sql.DB) {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 to run isolated PostgreSQL verification")
	}
	root := t.TempDir()
	socket := filepath.Join(root, "socket")
	if err := os.Mkdir(socket, 0o700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "db")
	bin := "/usr/lib/postgresql/16/bin/"
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(bin+name, args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, output)
		}
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("find an unused port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("release the port: %v", err)
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		_, _ = exec.Command(bin+"pg_ctl", "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"),
		"-o", fmt.Sprintf("-h '' -k '%s' -p %d", socket, port), "-w", "start")
	open := func(user string) *sql.DB {
		t.Helper()
		db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%d user=%s dbname=postgres sslmode=disable", socket, port, user))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = db.Close() })
		return db
	}

	owner := open("test_owner")
	if _, err := owner.Exec(raceFixture); err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	loadRowActorFixture(t, owner)
	// Every non-admin read wraps its policy in the canonical exact-row resolver.
	migration, err := os.ReadFile("../../../../../server_tools/migrations/20260902000004_finalize_row_access_fail_closed_defaults.sql")
	if err != nil {
		t.Fatal(err)
	}
	migrationText := string(migration)
	begin := strings.Index(migrationText, "CREATE OR REPLACE FUNCTION public.resolve_effective_row_access(")
	if begin < 0 {
		t.Fatal("exact-row resolver definition not found in its migration")
	}
	end := strings.Index(migrationText[begin:], "$$;") + len("$$;")
	if _, err := owner.Exec(migrationText[begin : begin+end]); err != nil {
		t.Fatalf("load exact-row resolver: %v", err)
	}
	for _, statement := range []string{
		"CREATE ROLE " + raceReaderRole + " LOGIN NOSUPERUSER",
		"GRANT USAGE ON SCHEMA public TO " + raceReaderRole,
		"GRANT SELECT ON ALL TABLES IN SCHEMA public TO " + raceReaderRole,
		"GRANT INSERT ON review_notes, review_note_watchers TO " + raceReaderRole,
		"GRANT USAGE ON SEQUENCE review_notes_id_seq, review_note_watchers_id_seq TO " + raceReaderRole,
	} {
		if _, err := owner.Exec(statement); err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}
	return owner, open(raceReaderRole)
}

// raceRequest is an add-row request from alice's signed-in session.
func raceRequest(t *testing.T) *http.Request {
	t.Helper()
	originalStore, originalName := e_sessions.Store, e_sessions.SessionName
	store := sessions.NewCookieStore([]byte("test-secret-key-32-bytes-long!!"))
	store.Options = &sessions.Options{Path: "/", MaxAge: 3600, HttpOnly: true}
	e_sessions.Store = store
	e_sessions.SessionName = "session"
	t.Cleanup(func() {
		e_sessions.Store = originalStore
		e_sessions.SessionName = originalName
	})
	request := httptest.NewRequest(http.MethodPost, "/api/add-row-multipart?dataset=review_notes", nil)
	cookieRequest := httptest.NewRequest(http.MethodPost, "/", nil)
	cookieRecorder := httptest.NewRecorder()
	session, err := store.Get(cookieRequest, e_sessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"] = 4
	session.Values["user_role"] = "basic"
	session.Values["username"] = "alice"
	if err := session.Save(cookieRequest, cookieRecorder); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range cookieRecorder.Result().Cookies() {
		request.AddCookie(cookie)
	}
	return request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(4, "basic")))
}

func raceBackendPID(t *testing.T, tx *sql.Tx) int {
	t.Helper()
	var pid int
	if err := tx.QueryRow(`SELECT pg_backend_pid()`).Scan(&pid); err != nil {
		t.Fatal(err)
	}
	return pid
}

func raceExec(t *testing.T, q interface {
	Exec(string, ...interface{}) (sql.Result, error)
}, query string, args ...interface{}) {
	t.Helper()
	if _, err := q.Exec(query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

// reviewedByBob and watchedByBob are add-row payloads as the browser's JSON sends them: a note whose reviewer is bob,
// and a note linked to bob through the watchers' many-to-many relation.
func reviewedByBob(title string) string {
	return fmt.Sprintf(`{"title": %q, "reviewer_id": 12}`, title)
}

func watchedByBob(title string) string {
	return fmt.Sprintf(`{"title": %q, "_existingLinks": [{"relationKind": "many_to_many", "relationId": 1, "rowIds": [12]}]}`, title)
}

// raceAdd is one add-row request, run in its own transaction on its own goroutine.
type raceAdd struct {
	pid      int
	tx       *sql.Tx
	finished chan struct{}
	status   int
	body     string
	err      error
}

func startRaceAdd(t *testing.T, reader *sql.DB, request *http.Request, payloadJSON string) *raceAdd {
	t.Helper()
	tx, err := reader.Begin()
	if err != nil {
		t.Fatal(err)
	}
	add := &raceAdd{pid: raceBackendPID(t, tx), tx: tx, finished: make(chan struct{})}
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		t.Fatal(err)
	}
	go func() {
		defer close(add.finished)
		recorder := httptest.NewRecorder()
		_, _, add.err = insertDataAccordingToPayload(recorder, request, "review_notes", "20", payload, tx)
		add.status, add.body = recorder.Code, recorder.Body.String()
	}()
	return add
}

// String describes a finished request; it is read only after finished is closed.
func (add *raceAdd) String() string {
	return fmt.Sprintf("status %d, body %q, err %v", add.status, add.body, add.err)
}

// editorOutcome describes the administrator's finished editor goroutine, in the same way.
type editorOutcome struct{ err *error }

func (outcome editorOutcome) String() string { return fmt.Sprintf("err %v", *outcome.err) }

// waitUntilBlocked returns once PostgreSQL reports that backend waiting waits for backend holding.
func waitUntilBlocked(t *testing.T, observer *sql.DB, waiting, holding int, finished <-chan struct{}, outcome fmt.Stringer) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		select {
		case <-finished:
			t.Fatalf("backend %d finished before it waited for backend %d: %v", waiting, holding, outcome)
		default:
		}
		var blocked bool
		if err := observer.QueryRow(`SELECT $2::int = ANY(pg_blocking_pids($1::int))`, waiting, holding).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("backend %d did not wait for backend %d", waiting, holding)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestAddRowRefusesAUserHiddenWhileTheRowIsAddedPostgres(t *testing.T) {
	owner, reader := raceCluster(t)
	originalDb := backend.Db
	backend.Db = owner // the column metadata is read on the administrator connection, as in the application
	t.Cleanup(func() { backend.Db = originalDb })
	request := raceRequest(t)

	// The premise: the reader may not lock a user row, as the signed-in users' role may not after stage 2a.
	if _, err := reader.Exec(`SELECT id FROM system_users WHERE id = 12 FOR KEY SHARE`); err == nil || !strings.Contains(err.Error(), "permission denied for table system_users") {
		t.Fatalf("FOR KEY SHARE as the reader: error = %v, want permission denied", err)
	}
	enableBob := func() { raceExec(t, owner, `UPDATE system_users SET enabled = true WHERE id = 12`) }
	notes := func(title string) int {
		t.Helper()
		var count int
		if err := owner.QueryRow(`SELECT count(*) FROM review_notes WHERE title = $1`, title).Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count
	}
	refused := func(t *testing.T, add *raceAdd, title, refusal string) {
		t.Helper()
		<-add.finished
		_ = add.tx.Rollback() // what the request's transaction middleware does after a refusal
		if add.err == nil || add.status != http.StatusForbidden || !strings.Contains(add.body, refusal) {
			t.Fatalf("adding a note that refers to the hidden bob: %v; want 403 %q", add, refusal)
		}
		var notes, watchers int
		if err := owner.QueryRow(`SELECT (SELECT count(*) FROM review_notes WHERE title = $1), (SELECT count(*) FROM review_note_watchers)`,
			title).Scan(&notes, &watchers); err != nil {
			t.Fatal(err)
		}
		if notes != 0 || watchers != 0 {
			t.Fatalf("after the refusal: %d notes titled %q and %d watcher links, want none", notes, title, watchers)
		}
	}
	// hideBobWhileStoppedAt has the request stop at its INSERT into table, after the check, while the administrator's
	// editor locks and disables bob and commits; the editor does not wait, for the check left no lock on bob's row.
	hideBobWhileStoppedAt := func(t *testing.T, table, payloadJSON string) *raceAdd {
		t.Helper()
		locker, err := owner.Begin()
		if err != nil {
			t.Fatal(err)
		}
		lockerPID := raceBackendPID(t, locker)
		raceExec(t, locker, `LOCK TABLE `+table+` IN SHARE ROW EXCLUSIVE MODE`)
		add := startRaceAdd(t, reader, request, payloadJSON)
		waitUntilBlocked(t, owner, add.pid, lockerPID, add.finished, add)

		editor, err := owner.Begin()
		if err != nil {
			t.Fatal(err)
		}
		lockContext, cancelLock := context.WithTimeout(context.Background(), 10*time.Second)
		_, lockErr := editor.ExecContext(lockContext, `SELECT id FROM system_users WHERE id = 12 FOR UPDATE`)
		cancelLock()
		if lockErr != nil {
			t.Fatalf("the editor's lock on bob while a check of him is open: %v (the check must hold no lock)", lockErr)
		}
		raceExec(t, editor, `UPDATE system_users SET enabled = false WHERE id = 12`)
		if err := editor.Commit(); err != nil {
			t.Fatal(err)
		}
		if err := locker.Commit(); err != nil {
			t.Fatal(err)
		}
		return add
	}

	t.Run("bob is hidden and the change committed between the check and the insert", func(t *testing.T) {
		enableBob()
		const title = "hidden between the check and the insert"
		refused(t, hideBobWhileStoppedAt(t, "review_notes", reviewedByBob(title)), title, foreignRowUnreadable)
	})

	t.Run("bob is hidden and the change committed between the check and the many-to-many link", func(t *testing.T) {
		enableBob()
		const title = "watched by bob, hidden before the link"
		// The note itself is inserted; the request stops at the link to bob, checked by authorizeExistingLink.
		refused(t, hideBobWhileStoppedAt(t, "review_note_watchers", watchedByBob(title)), title, relatedRowsUnreadable)
	})

	t.Run("bob is hidden while the insert waits for the editor", func(t *testing.T) {
		enableBob()
		const title = "hidden while the insert waits"
		editor, err := owner.Begin()
		if err != nil {
			t.Fatal(err)
		}
		editorPID := raceBackendPID(t, editor)
		raceExec(t, editor, `SELECT id FROM system_users WHERE id = 12 FOR UPDATE`)
		raceExec(t, editor, `UPDATE system_users SET enabled = false WHERE id = 12`)
		// The check reads the committed, visible bob; the insert's foreign-key check then waits for the editor.
		add := startRaceAdd(t, reader, request, reviewedByBob(title))
		waitUntilBlocked(t, owner, add.pid, editorPID, add.finished, add)
		if err := editor.Commit(); err != nil {
			t.Fatal(err)
		}
		refused(t, add, title, foreignRowUnreadable)
	})

	t.Run("the editor waits for the insert and then sees the reference", func(t *testing.T) {
		enableBob()
		const title = "stored before the editor"
		add := startRaceAdd(t, reader, request, reviewedByBob(title))
		<-add.finished
		if add.err != nil {
			_ = add.tx.Rollback()
			t.Fatalf("adding a note reviewed by the visible bob: status %d, body %q, err %v", add.status, add.body, add.err)
		}

		editor, err := owner.Begin()
		if err != nil {
			t.Fatal(err)
		}
		editorPID := raceBackendPID(t, editor)
		editorFinished := make(chan struct{})
		var editorErr error
		seen := -1
		go func() {
			defer close(editorFinished)
			if _, editorErr = editor.Exec(`SELECT id FROM system_users WHERE id = 12 FOR UPDATE`); editorErr != nil {
				return
			}
			if editorErr = editor.QueryRow(`SELECT count(*) FROM review_notes WHERE reviewer_id = 12 AND title = $1`, title).Scan(&seen); editorErr != nil {
				return
			}
			if _, editorErr = editor.Exec(`UPDATE system_users SET enabled = false WHERE id = 12`); editorErr != nil {
				return
			}
			editorErr = editor.Commit()
		}()
		// The insert's foreign-key check holds bob, so the editor's lock waits until the request commits.
		waitUntilBlocked(t, owner, editorPID, add.pid, editorFinished, editorOutcome{&editorErr})
		if err := add.tx.Commit(); err != nil {
			t.Fatal(err)
		}
		<-editorFinished
		if editorErr != nil {
			t.Fatal(editorErr)
		}
		if seen != 1 {
			t.Fatalf("the editor saw %d notes reviewed by bob once it had his row, want the committed 1", seen)
		}
		var enabled bool
		if err := owner.QueryRow(`SELECT enabled FROM system_users WHERE id = 12`).Scan(&enabled); err != nil || enabled {
			t.Fatalf("bob enabled = %v (%v) after the editor, want false", enabled, err)
		}
		if got := notes(title); got != 1 {
			t.Fatalf("notes titled %q: %d, want 1", title, got)
		}
	})
}
