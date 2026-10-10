// delete_privilege_metadata_test.go
// Unit tests for the dtt_1_row_delete package.
// Uses httptest for handler guard branches and a database/sql driver double for the extracted transaction-level helpers.
// Keeps privilege validation and protected metadata deletion checks together.
package dtt_1_row_delete

import (
	"context"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grants/granttest"
	"easelect/backend/core_components/update_capability"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCanonicalizeRevokePrivilegeAcceptsSupportedPrivileges(t *testing.T) {
	testCases := []struct {
		name  string
		raw   string
		scope revokePrivilegeScope
		want  string
	}{
		{name: "column select", raw: " select ", scope: revokeColumnPrivilegeScope, want: "SELECT"},
		{name: "column references", raw: "references", scope: revokeColumnPrivilegeScope, want: "REFERENCES"},
		{name: "table delete", raw: "delete", scope: revokeTablePrivilegeScope, want: "DELETE"},
		{name: "table trigger", raw: "TRIGGER", scope: revokeTablePrivilegeScope, want: "TRIGGER"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := canonicalizeRevokePrivilege(testCase.raw, testCase.scope)
			if err != nil {
				t.Fatalf("canonicalizeRevokePrivilege returned error: %v", err)
			}
			if got != testCase.want {
				t.Fatalf("canonicalizeRevokePrivilege(%q) = %q, want %q", testCase.raw, got, testCase.want)
			}
		})
	}
}

func TestRevokePrivilegesRejectInvalidValuesBeforeExec(t *testing.T) {
	testCases := []struct {
		name        string
		column      bool
		byID        bool
		privilege   string
		wantErrText string
	}{
		{
			name:        "column ID rejects injected statement",
			column:      true,
			byID:        true,
			privilege:   "SELECT; DROP TABLE public.users; --",
			wantErrText: "invalid column privilege",
		},
		{
			name:        "column row rejects unknown privilege",
			column:      true,
			privilege:   "EXECUTE",
			wantErrText: "unsupported column privilege",
		},
		{
			name:        "table ID rejects multi-token privilege",
			byID:        true,
			privilege:   "ALL PRIVILEGES",
			wantErrText: "invalid table privilege",
		},
		{
			name:        "table row rejects blank privilege",
			privilege:   "   ",
			wantErrText: "invalid table privilege",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			var queries []queuedQuery
			if testCase.byID {
				columns := []string{"role_name", "table_schema", "table_name", "privilege"}
				values := []driver.Value{"admin", "public", "users", testCase.privilege}
				if testCase.column {
					columns = []string{"role_name", "table_schema", "table_name", "column_name", "privilege"}
					values = []driver.Value{"admin", "public", "users", "email", testCase.privilege}
				}
				queries = []queuedQuery{{cols: columns, rows: [][]driver.Value{values}}}
			}

			_, tx, state := openDelRowTx(t, queries, nil)
			rows := []map[string]string{{
				"role_name":    "admin",
				"table_schema": "public",
				"table_name":   "users",
				"column_name":  "email",
				"privilege":    testCase.privilege,
			}}

			var err error
			switch {
			case testCase.column && testCase.byID:
				err = revokeColumnPrivileges(tx, []int{1}, nil)
			case testCase.column:
				err = revokeColumnPrivileges(tx, nil, rows)
			case testCase.byID:
				err = revokeTablePrivileges(tx, []int{1}, nil)
			default:
				err = revokeTablePrivileges(tx, nil, rows)
			}

			if err == nil || !strings.Contains(err.Error(), testCase.wantErrText) {
				t.Fatalf("err = %v, want error containing %q", err, testCase.wantErrText)
			}
			if len(state.execCalls) != 0 {
				t.Fatalf("exec calls = %v, want none for rejected privilege", state.execCalls)
			}
		})
	}
}

func TestRevokeColumnPrivilegesByIDs(t *testing.T) {
	_, tx, state := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"role_name", "table_schema", "table_name", "column_name", "privilege"},
			rows: [][]driver.Value{{"admin", "public", "users", "email", "SELECT"}},
		},
	}, []queuedExec{
		{}, // REVOKE
	})

	err := revokeColumnPrivileges(tx, []int{1}, nil)
	if err != nil {
		t.Fatalf("revokeColumnPrivileges returned error: %v", err)
	}
	if len(state.execCalls) != 1 || !strings.Contains(state.execCalls[0], "REVOKE") {
		t.Fatalf("exec calls = %v, want REVOKE", state.execCalls)
	}
}

func TestRevokeColumnPrivilegesByRows(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{}, // REVOKE
	})

	rows := []map[string]string{{
		"role_name":    "admin",
		"table_schema": "public",
		"table_name":   "users",
		"column_name":  "email",
		"privilege":    " select ",
	}}
	err := revokeColumnPrivileges(tx, nil, rows)
	if err != nil {
		t.Fatalf("revokeColumnPrivileges returned error: %v", err)
	}
	wantQuery := `REVOKE SELECT ("email") ON "public"."users" FROM "admin"`
	if len(state.execCalls) != 1 || state.execCalls[0] != wantQuery {
		t.Fatalf("exec calls = %v, want %q", state.execCalls, wantQuery)
	}
}

func TestRevokeColumnPrivilegesQueryError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{err: errors.New("query boom")},
	}, nil)

	err := revokeColumnPrivileges(tx, []int{1}, nil)
	if err == nil || !strings.Contains(err.Error(), "error fetching row") {
		t.Fatalf("err = %v, want wrapped query error", err)
	}
}

func TestRevokeColumnPrivilegesExecError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"role_name", "table_schema", "table_name", "column_name", "privilege"},
			rows: [][]driver.Value{{"admin", "public", "users", "email", "SELECT"}},
		},
	}, []queuedExec{
		{err: errors.New("revoke boom")},
	})

	err := revokeColumnPrivileges(tx, []int{1}, nil)
	if err == nil || !strings.Contains(err.Error(), "error revoking privilege") {
		t.Fatalf("err = %v, want wrapped revoke error", err)
	}
}

// ── revokeTablePrivileges tests ────────────────────────────────────────

func TestRevokeTablePrivilegesByIDs(t *testing.T) {
	_, tx, state := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"role_name", "table_schema", "table_name", "privilege"},
			rows: [][]driver.Value{{"admin", "public", "users", "SELECT"}},
		},
	}, []queuedExec{
		{}, // REVOKE
	})

	err := revokeTablePrivileges(tx, []int{1}, nil)
	if err != nil {
		t.Fatalf("revokeTablePrivileges returned error: %v", err)
	}
	if len(state.execCalls) != 1 || !strings.Contains(state.execCalls[0], "REVOKE") {
		t.Fatalf("exec calls = %v, want REVOKE", state.execCalls)
	}
}

func TestRevokeTablePrivilegesQueryError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{err: errors.New("query boom")},
	}, nil)

	err := revokeTablePrivileges(tx, []int{1}, nil)
	if err == nil || !strings.Contains(err.Error(), "error fetching row") {
		t.Fatalf("err = %v, want wrapped query error", err)
	}
}

func TestRevokeTablePrivilegesByRows(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{}, // REVOKE
	})

	rows := []map[string]string{{
		"role_name":    "admin",
		"table_schema": "public",
		"table_name":   "users",
		"privilege":    " delete ",
	}}
	err := revokeTablePrivileges(tx, nil, rows)
	if err != nil {
		t.Fatalf("revokeTablePrivileges returned error: %v", err)
	}
	wantQuery := `REVOKE DELETE ON "public"."users" FROM "admin"`
	if len(state.execCalls) != 1 || state.execCalls[0] != wantQuery {
		t.Fatalf("exec calls = %v, want %q", state.execCalls, wantQuery)
	}
}

// ── deleteSystemTables tests ───────────────────────────────────────────

func TestDeleteSystemTablesQueryError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{err: errors.New("fetch boom")},
	}, nil)

	err := deleteSystemTables(context.Background(), tx, []int{1})
	if err == nil || !strings.Contains(err.Error(), "error fetching table name") {
		t.Fatalf("err = %v, want wrapped fetch error", err)
	}
}

func TestDeleteSystemTablesDropError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"table_name", "table_uid", "schema_name"},
			rows: [][]driver.Value{{"test_table", int64(1), "public"}},
		},
	}, []queuedExec{
		{err: errors.New("drop boom")},
	})

	err := deleteSystemTables(context.Background(), tx, []int{1})
	if err == nil || !strings.Contains(err.Error(), "error dropping table") {
		t.Fatalf("err = %v, want wrapped drop error", err)
	}
}

func TestDeleteSystemTablesNullUIDFallback(t *testing.T) {
	// When table_uid IS NULL, it skips CleanupTableMetadata and deletes the row directly
	_, tx, state := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"table_name", "table_uid", "schema_name"},
			rows: [][]driver.Value{{"orphan_table", nil, nil}},
		},
	}, []queuedExec{
		{}, // DROP TABLE
		{}, // DELETE FROM system_db_tables (fallback)
	})

	err := deleteSystemTables(context.Background(), tx, []int{99})
	if err != nil {
		t.Fatalf("deleteSystemTables returned error: %v", err)
	}
	if len(state.execCalls) != 2 {
		t.Fatalf("exec calls = %d, want 2 (DROP + fallback DELETE)", len(state.execCalls))
	}
	if !strings.Contains(state.execCalls[0], "DROP TABLE") {
		t.Fatalf("exec[0] = %q, want DROP TABLE", state.execCalls[0])
	}
	if !strings.Contains(state.execCalls[1], "DELETE FROM system_db_tables") {
		t.Fatalf("exec[1] = %q, want fallback DELETE", state.execCalls[1])
	}
}

func TestDeleteSystemTablesNullUIDFallbackExecError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"table_name", "table_uid", "schema_name"},
			rows: [][]driver.Value{{"orphan_table", nil, nil}},
		},
	}, []queuedExec{
		{},                                 // DROP TABLE succeeds
		{err: errors.New("fallback boom")}, // fallback DELETE fails
	})

	err := deleteSystemTables(context.Background(), tx, []int{99})
	if err == nil || !strings.Contains(err.Error(), "error deleting row from system_db_tables") {
		t.Fatalf("err = %v, want wrapped fallback error", err)
	}
}

// ── preprocessColumnDetailsDeletion tests ──────────────────────────────

func TestPreprocessColumnDetailsFirstQueryError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{err: errors.New("col fetch boom")},
	}, nil)

	err := preprocessColumnDetailsDeletion(tx, []int{1})
	if err == nil || !strings.Contains(err.Error(), "error fetching row") {
		t.Fatalf("err = %v, want wrapped fetch error", err)
	}
}

func TestPreprocessColumnDetailsTableNameQueryError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"column_name", "table_uid"},
			rows: [][]driver.Value{{"col_a", int64(5)}},
		},
		{err: errors.New("table fetch boom")},
	}, nil)

	err := preprocessColumnDetailsDeletion(tx, []int{1})
	if err == nil || !strings.Contains(err.Error(), "error fetching table name") {
		t.Fatalf("err = %v, want wrapped table name error", err)
	}
}

func TestPreprocessColumnDetailsInvalidTableName(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"column_name", "table_uid"},
			rows: [][]driver.Value{{"col_a", int64(5)}},
		},
		{
			cols: []string{"table_name"},
			rows: [][]driver.Value{{"bad-table-name!"}},
		},
	}, nil)

	err := preprocessColumnDetailsDeletion(tx, []int{1})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	var bre *badRequestError
	if !errors.As(err, &bre) {
		t.Fatalf("err = %v (type %T), want *badRequestError", err, err)
	}
	if bre.msg != "invalid table name" {
		t.Fatalf("badRequestError.msg = %q, want 'invalid table name'", bre.msg)
	}
}

func TestPreprocessColumnDetailsInvalidColumnName(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"column_name", "table_uid"},
			rows: [][]driver.Value{{"bad-col-name!", int64(5)}},
		},
		{
			cols: []string{"table_name"},
			rows: [][]driver.Value{{"valid_table"}},
		},
	}, nil)

	err := preprocessColumnDetailsDeletion(tx, []int{1})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	var bre *badRequestError
	if !errors.As(err, &bre) {
		t.Fatalf("err = %v (type %T), want *badRequestError", err, err)
	}
	if bre.msg != "invalid column name" {
		t.Fatalf("badRequestError.msg = %q, want 'invalid column name'", bre.msg)
	}
}

// ── respondOK test ─────────────────────────────────────────────────────

func TestRespondOKWritesJSON(t *testing.T) {
	rec := httptest.NewRecorder()
	respondOK(rec, "test message")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "test message") {
		t.Fatalf("body = %q, want 'test message'", rec.Body.String())
	}
}

func TestDeletingActorMetadataReturnsRefusalWithoutDDL(t *testing.T) {
	for _, column := range []string{"created_by", "user_id"} {
		_, tx, state := openDelRowTx(t, []queuedQuery{
			// Capture must complete before the actor-column protection refuses deletion.
			{cols: []string{"granted"}, rows: [][]driver.Value{{false}}},
			{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(42)}}},
			{cols: []string{"id"}, rows: [][]driver.Value{{int64(5)}}},
			{cols: []string{"column_name", "table_uid"}, rows: [][]driver.Value{{column, int64(42)}}},
			{cols: []string{"table_name"}, rows: [][]driver.Value{{"notes"}}},
			{cols: []string{"column_name", "actor_role"}, rows: [][]driver.Value{{"created_by", "creator"}, {"user_id", "owner"}}},
		}, nil)
		req := httptest.NewRequest("POST", "/", strings.NewReader(`{"ids":[5]}`))
		ctx := dbutils.SetTx(req.Context(), tx)
		ctx = dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(2, "admin"))
		rec := httptest.NewRecorder()
		DeleteRowsHandler(granttest.Recorder{ResponseRecorder: rec}, req.WithContext(ctx), "system_column_details")
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), `"error_lang_key":"error_owner_column_protected"`) || len(state.execCalls) != 0 || len(state.queries) != 0 {
			t.Fatalf("%s: %d %s writes=%v", column, rec.Code, rec.Body, state.execCalls)
		}
		args := state.queryArgs[0]
		if !strings.Contains(state.queryCalls[0], "f.name=$1") || len(args) != 3 || args[0].Value != update_capability.Name || args[1].Value != update_capability.Route || args[2].Value != int64(2) {
			t.Fatal("update capability capture did not use the requesting actor", state.queryCalls[0], args)
		}
	}
}
