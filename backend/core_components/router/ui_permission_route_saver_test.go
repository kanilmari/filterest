// ui_permission_route_saver_test.go
// Verifies the startup-owned frontend permission registry and its transaction boundary.
// Bridges frontend route literals, canonical backend metadata, and rollback behavior.
// Exists so a fresh bootstrap cannot silently lose the UI permissions required by the SPA.
package router

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

type uiPermissionRouteExecCall struct {
	query string
	args  []driver.NamedValue
}

type uiPermissionRouteTestState struct {
	mu            sync.Mutex
	beginErr      error
	commitErr     error
	failExecAt    int
	beginCount    int
	commitCount   int
	rollbackCount int
	execCalls     []uiPermissionRouteExecCall
}

type uiPermissionRouteTestDriver struct {
	state *uiPermissionRouteTestState
}

type uiPermissionRouteTestConn struct {
	state *uiPermissionRouteTestState
}

type uiPermissionRouteTestTx struct {
	state *uiPermissionRouteTestState
}

var uiPermissionRouteDriverCounter atomic.Int64

func (d *uiPermissionRouteTestDriver) Open(string) (driver.Conn, error) {
	return &uiPermissionRouteTestConn{state: d.state}, nil
}

func (c *uiPermissionRouteTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not supported")
}

func (c *uiPermissionRouteTestConn) Close() error { return nil }

func (c *uiPermissionRouteTestConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (c *uiPermissionRouteTestConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()
	c.state.beginCount++
	if c.state.beginErr != nil {
		return nil, c.state.beginErr
	}
	return &uiPermissionRouteTestTx{state: c.state}, nil
}

func (c *uiPermissionRouteTestConn) ExecContext(
	_ context.Context,
	query string,
	args []driver.NamedValue,
) (driver.Result, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()
	c.state.execCalls = append(c.state.execCalls, uiPermissionRouteExecCall{
		query: query,
		args:  append([]driver.NamedValue(nil), args...),
	})
	if c.state.failExecAt > 0 && len(c.state.execCalls) == c.state.failExecAt {
		return nil, errors.New("scripted UI route reconciliation failure")
	}
	return driver.RowsAffected(1), nil
}

func (tx *uiPermissionRouteTestTx) Commit() error {
	tx.state.mu.Lock()
	defer tx.state.mu.Unlock()
	tx.state.commitCount++
	return tx.state.commitErr
}

func (tx *uiPermissionRouteTestTx) Rollback() error {
	tx.state.mu.Lock()
	defer tx.state.mu.Unlock()
	tx.state.rollbackCount++
	return nil
}

func TestCanonicalUIPermissionRoutesAreUniqueAndComplete(t *testing.T) {
	if got, want := len(canonicalUIPermissionRoutes), 30; got != want {
		t.Fatalf("canonical UI route count = %d, want %d", got, want)
	}

	names := make(map[string]struct{}, len(canonicalUIPermissionRoutes))
	endpoints := make(map[string]struct{}, len(canonicalUIPermissionRoutes))
	tableSpecificCount := 0
	for _, route := range canonicalUIPermissionRoutes {
		if route.Name == "" || route.URLRouteEndpoint == "" {
			t.Fatalf("canonical UI route has empty identity: %#v", route)
		}
		if _, duplicate := names[route.Name]; duplicate {
			t.Fatalf("duplicate canonical UI route name %q", route.Name)
		}
		if _, duplicate := endpoints[route.URLRouteEndpoint]; duplicate {
			t.Fatalf("duplicate canonical UI route endpoint %q", route.URLRouteEndpoint)
		}
		names[route.Name] = struct{}{}
		endpoints[route.URLRouteEndpoint] = struct{}{}
		if route.SpecificTableRelated {
			tableSpecificCount++
			if route.URLRouteEndpoint != "/ui/table-view-style-buttons" {
				t.Fatalf("unexpected table-specific UI route: %#v", route)
			}
		}
	}
	if tableSpecificCount != 1 {
		t.Fatalf("table-specific canonical UI route count = %d, want 1", tableSpecificCount)
	}

	frontendEndpoints := collectFrontendUIPermissionLiterals(t)
	canonicalEndpoints := make([]string, 0, len(endpoints))
	for endpoint := range endpoints {
		canonicalEndpoints = append(canonicalEndpoints, endpoint)
	}
	sort.Strings(canonicalEndpoints)
	if !reflect.DeepEqual(canonicalEndpoints, frontendEndpoints) {
		t.Fatalf(
			"canonical UI registry differs from frontend literals\ncanonical: %v\nfrontend:  %v",
			canonicalEndpoints,
			frontendEndpoints,
		)
	}
}

func TestReactivateUIRoutesCommitsCompleteRegistry(t *testing.T) {
	db, state := newUIPermissionRouteTestDB(t, &uiPermissionRouteTestState{})

	if err := ReactivateUIRoutes(db); err != nil {
		t.Fatalf("ReactivateUIRoutes() error = %v", err)
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.beginCount != 1 || state.commitCount != 1 || state.rollbackCount != 0 {
		t.Fatalf(
			"transaction counts = begin:%d commit:%d rollback:%d, want 1/1/0",
			state.beginCount,
			state.commitCount,
			state.rollbackCount,
		)
	}
	if len(state.execCalls) != len(canonicalUIPermissionRoutes) {
		t.Fatalf("reconcile exec count = %d, want %d", len(state.execCalls), len(canonicalUIPermissionRoutes))
	}

	for index, call := range state.execCalls {
		route := canonicalUIPermissionRoutes[index]
		wantArgs := []any{
			route.Name,
			route.SpecificTableRelated,
			route.URLRouteEndpoint,
			int64(defaultRateLimitAmount),
			int64(defaultRateLimitMinutes),
		}
		gotArgs := make([]any, len(call.args))
		for argIndex, arg := range call.args {
			gotArgs[argIndex] = arg.Value
		}
		if !reflect.DeepEqual(gotArgs, wantArgs) {
			t.Fatalf("route %d args = %#v, want %#v", index, gotArgs, wantArgs)
		}
		for _, requiredSQL := range []string{
			"WITH canonical_route AS",
			"ON CONFLICT (name) DO UPDATE",
			"endpoint_aliases AS",
			"copied_alias_grants AS",
			"alias.id <> canonical.id",
			`alias."package" = 'frontend'`,
			"alias.ui_only IS TRUE",
			"ON alias.id = legacy.function_id",
			"existing.function_id = canonical.id",
			"COALESCE(existing.target_table_uid, 0) = COALESCE(legacy.target_table_uid, 0)",
			"UPDATE public.system_functions AS alias",
			"url_route_endpoint = NULL",
			"WHERE alias.id IN (SELECT id FROM endpoint_aliases)",
			`"package" = 'frontend'`,
			"ui_only = true",
		} {
			if !strings.Contains(call.query, requiredSQL) {
				t.Fatalf("reconciliation SQL missing %q", requiredSQL)
			}
		}
	}
}

func TestReactivateUIRoutesRollsBackOnRouteFailure(t *testing.T) {
	db, state := newUIPermissionRouteTestDB(t, &uiPermissionRouteTestState{failExecAt: 4})

	err := ReactivateUIRoutes(db)
	if err == nil || !strings.Contains(err.Error(), canonicalUIPermissionRoutes[3].URLRouteEndpoint) {
		t.Fatalf("ReactivateUIRoutes() error = %v, want failing route context", err)
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.commitCount != 0 || state.rollbackCount != 1 {
		t.Fatalf(
			"transaction counts = commit:%d rollback:%d, want 0/1",
			state.commitCount,
			state.rollbackCount,
		)
	}
	if len(state.execCalls) != state.failExecAt {
		t.Fatalf("exec count after failure = %d, want %d", len(state.execCalls), state.failExecAt)
	}
}

func TestReactivateUIRoutesReportsBeginAndCommitFailures(t *testing.T) {
	t.Run("begin", func(t *testing.T) {
		db, state := newUIPermissionRouteTestDB(t, &uiPermissionRouteTestState{
			beginErr: errors.New("begin unavailable"),
		})
		err := ReactivateUIRoutes(db)
		if err == nil || !strings.Contains(err.Error(), "begin UI route reconciliation") {
			t.Fatalf("ReactivateUIRoutes() error = %v, want begin context", err)
		}
		state.mu.Lock()
		defer state.mu.Unlock()
		if len(state.execCalls) != 0 || state.commitCount != 0 || state.rollbackCount != 0 {
			t.Fatalf("begin failure performed transaction work: %#v", state)
		}
	})

	t.Run("commit", func(t *testing.T) {
		db, state := newUIPermissionRouteTestDB(t, &uiPermissionRouteTestState{
			commitErr: errors.New("commit unavailable"),
		})
		err := ReactivateUIRoutes(db)
		if err == nil || !strings.Contains(err.Error(), "commit UI route reconciliation") {
			t.Fatalf("ReactivateUIRoutes() error = %v, want commit context", err)
		}
		state.mu.Lock()
		defer state.mu.Unlock()
		if state.commitCount != 1 {
			t.Fatalf("commit count = %d, want 1", state.commitCount)
		}
	})
}

func collectFrontendUIPermissionLiterals(t *testing.T) []string {
	t.Helper()
	frontendRoot := filepath.Join("..", "..", "..", "frontend")
	literalPattern := regexp.MustCompile(`["'](/ui/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*)["']`)
	endpoints := make(map[string]struct{})

	err := filepath.WalkDir(frontendRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if entry.Name() == "dist" || entry.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(path) != ".js" || strings.HasSuffix(path, ".test.js") {
			return nil
		}
		contents, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, match := range literalPattern.FindAllSubmatch(contents, -1) {
			endpoints[string(match[1])] = struct{}{}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan frontend UI permission literals: %v", err)
	}

	result := make([]string, 0, len(endpoints))
	for endpoint := range endpoints {
		result = append(result, endpoint)
	}
	sort.Strings(result)
	return result
}

func newUIPermissionRouteTestDB(
	t *testing.T,
	state *uiPermissionRouteTestState,
) (*sql.DB, *uiPermissionRouteTestState) {
	t.Helper()
	driverName := fmt.Sprintf(
		"easelect-ui-permission-route-test-%d",
		uiPermissionRouteDriverCounter.Add(1),
	)
	sql.Register(driverName, &uiPermissionRouteTestDriver{state: state})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open(): %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db, state
}
