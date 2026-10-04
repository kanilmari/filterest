// account_table_write_revocations_test.go
// Verifies the start-up step that removes the runtime roles' writes on the account and rights tables.
// Bridges role-setting validation, the configured-writer gate, grantor-aware execution and the fail-closed checks.
// Exists so a shared role, an automation aimed at an account table or a surprising catalog cannot quietly
// narrow other rights or leave a write behind.
package backend

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"log"
	"strings"
	"sync/atomic"
	"testing"
)

type accountTableTestState struct {
	problems       string
	accountNames   []string
	hasAutomations bool
	hasRegistry    bool
	automations    [][2]string
	cacheTargets   [][2]string
	galleryParents []string
	keptRights     []string
	revocations    [][]driver.Value
	violations     string
	review         [4]int64
	execs          []string
	queries        int
	keptReads      int
	committed      bool
	rolledBack     bool
}

type accountTableTestDriver struct{ state *accountTableTestState }
type accountTableTestConn struct{ state *accountTableTestState }
type accountTableTestTx struct{ state *accountTableTestState }
type accountTableTestRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

var accountTableDriverCounter int64

func openAccountTableTestDB(t *testing.T, state *accountTableTestState) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf("account_table_write_revocation_%d", atomic.AddInt64(&accountTableDriverCounter, 1))
	sql.Register(driverName, &accountTableTestDriver{state: state})
	database, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	database.SetMaxOpenConns(1)
	database.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = database.Close() })
	return database
}

// replaceAccountTableGalleryChild swaps the runtime gallery resolver for a fixed map for one test.
func replaceAccountTableGalleryChild(t *testing.T, children map[string]string, resolveErr error) {
	t.Helper()
	original := accountTableGalleryChild
	accountTableGalleryChild = func(_ *sql.Tx, parentTable string) (string, error) {
		if resolveErr != nil {
			return "", resolveErr
		}
		return children[parentTable], nil
	}
	t.Cleanup(func() { accountTableGalleryChild = original })
}

func singleAccountTableRow(values ...driver.Value) driver.Rows {
	columns := make([]string, len(values))
	for index := range values {
		columns[index] = fmt.Sprintf("column_%d", index)
	}
	return &accountTableTestRows{columns: columns, rows: [][]driver.Value{values}}
}

func (driverInstance *accountTableTestDriver) Open(string) (driver.Conn, error) {
	return &accountTableTestConn{state: driverInstance.state}, nil
}

func (*accountTableTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not supported")
}

func (*accountTableTestConn) Close() error { return nil }

func (connection *accountTableTestConn) Begin() (driver.Tx, error) {
	return &accountTableTestTx{state: connection.state}, nil
}

func (connection *accountTableTestConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	state := connection.state
	state.queries++
	switch {
	case strings.Contains(query, "'a runtime role owns an account table"):
		return singleAccountTableRow(state.problems), nil
	case strings.Contains(query, "WHERE relation.oid IN (SELECT oid FROM account_relations)\nORDER BY 1"):
		rows := make([][]driver.Value, 0, len(state.accountNames))
		for _, name := range state.accountNames {
			rows = append(rows, []driver.Value{name})
		}
		return &accountTableTestRows{columns: []string{"relname"}, rows: rows}, nil
	case strings.Contains(query, "to_regclass('public.system_triggers') IS NOT NULL,"):
		return singleAccountTableRow(state.hasAutomations, state.hasRegistry), nil
	case strings.Contains(query, "FROM public.system_triggers"):
		return accountTablePairRows(state.automations), nil
	case strings.Contains(query, "cache_target ->> 'table'"):
		return accountTablePairRows(state.cacheTargets), nil
	case strings.Contains(query, "image_column.attname = 'cached_image'"):
		rows := make([][]driver.Value, 0, len(state.galleryParents))
		for _, parent := range state.galleryParents {
			rows = append(rows, []driver.Value{parent})
		}
		return &accountTableTestRows{columns: []string{"relname"}, rows: rows}, nil
	case strings.Contains(query, "table_privileges (privilege_name, is_write)"):
		kept := ""
		if state.keptReads < len(state.keptRights) {
			kept = state.keptRights[state.keptReads]
		}
		state.keptReads++
		return singleAccountTableRow(kept), nil
	case strings.Contains(query, "revocations (category, acting_role, statement)"):
		return &accountTableTestRows{columns: []string{"category", "acting_role", "statement"}, rows: state.revocations}, nil
	case strings.Contains(query, "runtime roles can still write"):
		return singleAccountTableRow(state.violations), nil
	case strings.Contains(query, "runtime_writable (oid)"):
		return singleAccountTableRow(state.review[0], state.review[1], state.review[2], state.review[3]), nil
	}
	return nil, fmt.Errorf("unexpected query: %s", query)
}

func accountTablePairRows(pairs [][2]string) driver.Rows {
	rows := make([][]driver.Value, 0, len(pairs))
	for _, pair := range pairs {
		rows = append(rows, []driver.Value{pair[0], pair[1]})
	}
	return &accountTableTestRows{columns: []string{"first", "second"}, rows: rows}
}

func (connection *accountTableTestConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	connection.state.execs = append(connection.state.execs, query)
	return driver.RowsAffected(0), nil
}

func (transaction *accountTableTestTx) Commit() error {
	transaction.state.committed = true
	return nil
}

func (transaction *accountTableTestTx) Rollback() error {
	if !transaction.state.committed {
		transaction.state.rolledBack = true
	}
	return nil
}

func (rows *accountTableTestRows) Columns() []string { return rows.columns }
func (*accountTableTestRows) Close() error           { return nil }
func (rows *accountTableTestRows) Next(values []driver.Value) error {
	if rows.index >= len(rows.rows) {
		return io.EOF
	}
	copy(values, rows.rows[rows.index])
	rows.index++
	return nil
}

func countAccountTableGrantStatements(execs []string) int {
	count := 0
	for _, statement := range execs {
		if strings.HasPrefix(statement, "REVOKE ") || strings.HasPrefix(statement, "GRANT ") ||
			strings.HasPrefix(statement, "ALTER DEFAULT PRIVILEGES") {
			count++
		}
	}
	return count
}

func TestAccountTableRolesRefuseSharedBasicAndConfidential(t *testing.T) {
	state := &accountTableTestState{}
	database := openAccountTableTestDB(t, state)
	setWriteRevocationTestEnvironment(t)
	t.Setenv("DB_CONFIDENTIAL_USER", "site_basic")

	err := EnsureAccountTableWriteRevocations(database)
	if err == nil || !strings.Contains(err.Error(), "DB_CONFIDENTIAL_USER must differ from DB_BASIC_USER") {
		t.Fatalf("error = %v, want the shared confidential role refused", err)
	}
	if len(state.execs) != 0 || state.queries != 0 {
		t.Fatalf("a refused setting reached the database: execs=%v queries=%d", state.execs, state.queries)
	}
}

func TestEnsureAccountTableWriteRevocationsSharesStageOneLock(t *testing.T) {
	state := &accountTableTestState{}
	database := openAccountTableTestDB(t, state)
	setWriteRevocationTestEnvironment(t)
	replaceAccountTableGalleryChild(t, nil, nil)

	if err := EnsureAccountTableWriteRevocations(database); err != nil {
		t.Fatalf("EnsureAccountTableWriteRevocations returned error: %v", err)
	}
	stageOneLock := "SELECT pg_advisory_xact_lock(hashtext('filterest.runtime_role_write_revocations'))"
	if len(state.execs) == 0 || state.execs[0] != stageOneLock {
		t.Fatalf("first statement = %v, want stage 1's advisory lock %q", state.execs, stageOneLock)
	}
	if !state.committed || state.rolledBack {
		t.Fatalf("transaction state: committed=%v rolledBack=%v", state.committed, state.rolledBack)
	}
}

func TestEnsureAccountTableWriteRevocationsRevokesAsEachGrantor(t *testing.T) {
	state := &accountTableTestState{
		accountNames:   []string{"system_users", "system_user_group_memberships", "user_names"},
		hasAutomations: true,
		hasRegistry:    true,
		automations:    [][2]string{{"4", "notes"}},
		cacheTargets:   [][2]string{{"9", "notes"}},
		galleryParents: []string{"notes"},
		keptRights:     []string{"basic public.notes INSERT", "basic public.notes INSERT"},
		revocations: [][]driver.Value{
			{"account_relation", "", `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.system_users FROM site_basic`},
			{"account_relation", "granting_editor", `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.system_user_groups FROM site_basic`},
			{"confidential_default", "", `ALTER DEFAULT PRIVILEGES FOR ROLE site_owner IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM site_confidential`},
		},
	}
	database := openAccountTableTestDB(t, state)
	setWriteRevocationTestEnvironment(t)
	replaceAccountTableGalleryChild(t, map[string]string{"notes": "notes_assets"}, nil)

	if err := EnsureAccountTableWriteRevocations(database); err != nil {
		t.Fatalf("EnsureAccountTableWriteRevocations returned error: %v", err)
	}
	want := []string{
		"SELECT pg_advisory_xact_lock(hashtext('filterest.runtime_role_write_revocations'))",
		`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.system_users FROM site_basic`,
		`SET LOCAL ROLE "granting_editor"`,
		`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.system_user_groups FROM site_basic`,
		"RESET ROLE",
		`ALTER DEFAULT PRIVILEGES FOR ROLE site_owner IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM site_confidential`,
	}
	if strings.Join(state.execs, "\n") != strings.Join(want, "\n") {
		t.Fatalf("executed statements:\n%s\nwant:\n%s", strings.Join(state.execs, "\n"), strings.Join(want, "\n"))
	}
	if !state.committed || state.rolledBack {
		t.Fatalf("transaction state: committed=%v rolledBack=%v", state.committed, state.rolledBack)
	}
}

func TestEnsureAccountTableWriteRevocationsFailsClosed(t *testing.T) {
	revokeUsers := []driver.Value{"account_relation", "", `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.system_users FROM site_basic`}
	accountNames := []string{"system_users", "system_user_group_memberships", "team_members"}
	for _, testCase := range []struct {
		name        string
		state       accountTableTestState
		children    map[string]string
		resolveErr  error
		wantError   string
		wantRevokes int
	}{
		{
			name:      "unsafe role setup",
			state:     accountTableTestState{problems: "role is a superuser: basic", revocations: [][]driver.Value{revokeUsers}},
			wantError: "unsafe setup, nothing changed: role is a superuser: basic",
		},
		{
			name: "an automation writes a membership",
			state: accountTableTestState{
				accountNames: accountNames, hasAutomations: true,
				automations: [][2]string{{"3", "notes"}, {"7", "system_user_group_memberships"}},
				revocations: [][]driver.Value{revokeUsers},
			},
			wantError: "automation 7 writes system_user_group_memberships",
		},
		{
			name: "a file-upload relation caches into the user table",
			state: accountTableTestState{
				accountNames: accountNames, hasRegistry: true,
				cacheTargets: [][2]string{{"12", "system_users"}},
				revocations:  [][]driver.Value{revokeUsers},
			},
			wantError: "file-upload relation 12 caches into system_users",
		},
		{
			name: "a gallery's child is a view over the user table",
			state: accountTableTestState{
				accountNames: accountNames, hasRegistry: true, galleryParents: []string{"teams"},
				revocations: [][]driver.Value{revokeUsers},
			},
			children:  map[string]string{"teams": "team_members"},
			wantError: "the gallery of teams (team_members) writes an account table",
		},
		{
			// No card picture field: a new gallery row still locks its parent row FOR NO KEY UPDATE.
			name: "the user table has a gallery without a card picture field",
			state: accountTableTestState{
				accountNames: accountNames, hasRegistry: true, galleryParents: []string{"notes"},
				revocations: [][]driver.Value{revokeUsers},
			},
			children:  map[string]string{"notes": "notes_assets", "system_users": "system_users_assets"},
			wantError: "the gallery of system_users (system_users_assets) writes an account table",
		},
		{
			name: "a gallery cannot be resolved",
			state: accountTableTestState{
				accountNames: accountNames, hasRegistry: true, galleryParents: []string{"notes"},
				revocations: [][]driver.Value{revokeUsers},
			},
			resolveErr: errors.New("relation registry unreadable"),
			wantError:  "resolve the gallery of notes: relation registry unreadable",
		},
		{
			name: "other rights would change",
			state: accountTableTestState{
				keptRights:  []string{"basic public.notes INSERT\nconfidential public.system_users(id) SELECT", "basic public.notes INSERT"},
				revocations: [][]driver.Value{revokeUsers},
			},
			wantError:   "would lose confidential public.system_users(id) SELECT; would gain nothing",
			wantRevokes: 1,
		},
		{
			name: "a right survives",
			state: accountTableTestState{
				revocations: [][]driver.Value{revokeUsers},
				violations:  "runtime roles can still write 1 account table(s) or view(s) over them, for example public.system_users",
			},
			wantError:   "rights remain after the revocations (runtime roles can still write 1 account table(s)",
			wantRevokes: 1,
		},
		{
			name:      "an unexpected statement",
			state:     accountTableTestState{revocations: [][]driver.Value{{"account_relation", "", "GRANT ALL ON TABLE public.system_users TO site_basic"}}},
			wantError: "refused unexpected statement",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			state := testCase.state
			database := openAccountTableTestDB(t, &state)
			setWriteRevocationTestEnvironment(t)
			replaceAccountTableGalleryChild(t, testCase.children, testCase.resolveErr)

			err := EnsureAccountTableWriteRevocations(database)
			if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("error = %v, want %q", err, testCase.wantError)
			}
			if revokes := countAccountTableGrantStatements(state.execs); revokes != testCase.wantRevokes {
				t.Fatalf("executed %d grant statement(s), want %d: %v", revokes, testCase.wantRevokes, state.execs)
			}
			if state.committed || !state.rolledBack {
				t.Fatalf("transaction state: committed=%v rolledBack=%v, want rolled back", state.committed, state.rolledBack)
			}
		})
	}
}

func TestEnsureAccountTableWriteRevocationsReportsOwnerRightsPaths(t *testing.T) {
	state := &accountTableTestState{review: [4]int64{1, 2, 0, 0}}
	database := openAccountTableTestDB(t, state)
	setWriteRevocationTestEnvironment(t)
	replaceAccountTableGalleryChild(t, nil, nil)

	var logBuffer bytes.Buffer
	originalWriter := log.Writer()
	log.SetOutput(&logBuffer)
	t.Cleanup(func() { log.SetOutput(originalWriter) })

	if err := EnsureAccountTableWriteRevocations(database); err != nil {
		t.Fatalf("EnsureAccountTableWriteRevocations returned error: %v", err)
	}
	if !strings.Contains(logBuffer.String(), "owner-rights SQL paths these revocations cannot stop, to review: 1 SECURITY DEFINER function(s)") {
		t.Fatalf("log = %q, want the owner-rights review counts", logBuffer.String())
	}
	if !state.committed {
		t.Fatalf("owner-rights paths are reported, not refused; the step must still commit")
	}
}
