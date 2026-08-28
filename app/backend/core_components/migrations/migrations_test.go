// migrations_test.go
// Regression tests for startup migration execution.
// Covers the shared helper between migration files on disk, database/sql transaction handling, and migration bookkeeping so startup refactors can keep the migration contract stable without running against a live PostgreSQL instance.
package migrations

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

type migrationExecRule struct {
	contains string
	arg0     string
	inTx     bool
	err      error
}

type migrationMockConfig struct {
	existing  map[string]bool
	beginErr  error
	queryErr  error
	commitErr error
	execRules []migrationExecRule
}

type migrationMockDriver struct {
	cfg   migrationMockConfig
	state *migrationMockState
}

type migrationMockConn struct {
	cfg   migrationMockConfig
	state *migrationMockState
	mu    sync.Mutex
	inTx  bool
}

type migrationMockTx struct {
	conn *migrationMockConn
}

type migrationMockRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

type migrationExecCall struct {
	query string
	args  []driver.NamedValue
}

type migrationMockState struct {
	mu              sync.Mutex
	existing        map[string]bool
	existsChecks    []string
	directExecCalls []migrationExecCall
	txExecCalls     []migrationExecCall
	commitCount     int
	rollbackCount   int
}

var migrationMockCounter int64

func (d *migrationMockDriver) Open(string) (driver.Conn, error) {
	return &migrationMockConn{
		cfg:   d.cfg,
		state: d.state,
	}, nil
}

func (c *migrationMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}

func (c *migrationMockConn) Close() error { return nil }

func (c *migrationMockConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (c *migrationMockConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	if c.cfg.beginErr != nil {
		return nil, c.cfg.beginErr
	}
	c.mu.Lock()
	c.inTx = true
	c.mu.Unlock()
	return &migrationMockTx{conn: c}, nil
}

func (c *migrationMockConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *migrationMockConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.mu.Lock()
	inTx := c.inTx
	c.mu.Unlock()

	call := migrationExecCall{
		query: query,
		args:  append([]driver.NamedValue(nil), args...),
	}

	c.state.mu.Lock()
	if inTx {
		c.state.txExecCalls = append(c.state.txExecCalls, call)
	} else {
		c.state.directExecCalls = append(c.state.directExecCalls, call)
	}
	c.state.mu.Unlock()

	for _, rule := range c.cfg.execRules {
		if rule.inTx != inTx {
			continue
		}
		if rule.contains != "" && !strings.Contains(query, rule.contains) {
			continue
		}
		if rule.arg0 != "" {
			if len(args) == 0 || fmt.Sprint(args[0].Value) != rule.arg0 {
				continue
			}
		}
		return nil, rule.err
	}

	if strings.Contains(query, "INSERT INTO system_schema_migrations") && len(args) > 0 {
		c.state.mu.Lock()
		c.state.existing[fmt.Sprint(args[0].Value)] = true
		c.state.mu.Unlock()
	}

	return driver.RowsAffected(1), nil
}

func (c *migrationMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *migrationMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if c.cfg.queryErr != nil {
		return nil, c.cfg.queryErr
	}
	if !strings.Contains(query, "SELECT EXISTS") {
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
	if len(args) == 0 {
		return nil, fmt.Errorf("missing filename arg")
	}

	filename := fmt.Sprint(args[0].Value)
	c.state.mu.Lock()
	c.state.existsChecks = append(c.state.existsChecks, filename)
	exists := c.state.existing[filename]
	c.state.mu.Unlock()

	return &migrationMockRows{
		columns: []string{"exists"},
		rows:    [][]driver.Value{{exists}},
	}, nil
}

func (tx *migrationMockTx) Commit() error {
	tx.conn.mu.Lock()
	tx.conn.inTx = false
	tx.conn.mu.Unlock()

	tx.conn.state.mu.Lock()
	tx.conn.state.commitCount++
	tx.conn.state.mu.Unlock()

	return tx.conn.cfg.commitErr
}

func (tx *migrationMockTx) Rollback() error {
	tx.conn.mu.Lock()
	tx.conn.inTx = false
	tx.conn.mu.Unlock()

	tx.conn.state.mu.Lock()
	tx.conn.state.rollbackCount++
	tx.conn.state.mu.Unlock()

	return nil
}

func (r *migrationMockRows) Columns() []string {
	return append([]string(nil), r.columns...)
}

func (r *migrationMockRows) Close() error { return nil }

func (r *migrationMockRows) Next(dest []driver.Value) error {
	if r.index >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}

func openMigrationMockDB(t *testing.T, cfg migrationMockConfig) (*sql.DB, *migrationMockState) {
	t.Helper()

	state := &migrationMockState{
		existing: make(map[string]bool),
	}
	for k, v := range cfg.existing {
		state.existing[k] = v
	}

	driverName := fmt.Sprintf("migrations_mock_%d_%d", os.Getpid(), atomic.AddInt64(&migrationMockCounter, 1))
	sql.Register(driverName, &migrationMockDriver{cfg: cfg, state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	return db, state
}

func writeMigrationFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatalf("os.WriteFile(%s) returned error: %v", name, err)
	}
}

func txQueries(state *migrationMockState) []string {
	state.mu.Lock()
	defer state.mu.Unlock()
	out := make([]string, len(state.txExecCalls))
	for i, call := range state.txExecCalls {
		out[i] = call.query
	}
	return out
}

func directQueries(state *migrationMockState) []string {
	state.mu.Lock()
	defer state.mu.Unlock()
	out := make([]string, len(state.directExecCalls))
	for i, call := range state.directExecCalls {
		out[i] = call.query
	}
	return out
}

func existsChecks(state *migrationMockState) []string {
	state.mu.Lock()
	defer state.mu.Unlock()
	return append([]string(nil), state.existsChecks...)
}

func TestRunMigrationsReturnsCreateTableError(t *testing.T) {
	dir := t.TempDir()
	db, _ := openMigrationMockDB(t, migrationMockConfig{
		execRules: []migrationExecRule{
			{contains: "CREATE TABLE IF NOT EXISTS system_schema_migrations", inTx: false, err: fmt.Errorf("create table failed")},
		},
	})

	err := RunMigrations(db, dir)
	if err == nil || !strings.Contains(err.Error(), "create table failed") {
		t.Fatalf("RunMigrations() error = %v, want create-table error", err)
	}
}

func TestRunMigrationsAppliesTransactionalFilesInSortedOrderAndSkipsExisting(t *testing.T) {
	dir := t.TempDir()
	writeMigrationFile(t, dir, "002_second.sql", "SELECT 2;")
	writeMigrationFile(t, dir, "001_first.sql", "SELECT 1;")
	writeMigrationFile(t, dir, "003_existing.sql", "SELECT 3;")

	db, state := openMigrationMockDB(t, migrationMockConfig{
		existing: map[string]bool{"003_existing.sql": true},
	})

	if err := RunMigrations(db, dir); err != nil {
		t.Fatalf("RunMigrations() returned error: %v", err)
	}

	if got := existsChecks(state); strings.Join(got, ",") != "001_first.sql,002_second.sql,003_existing.sql" {
		t.Fatalf("exists checks = %v, want sorted order", got)
	}

	gotTx := txQueries(state)
	if len(gotTx) != 4 {
		t.Fatalf("tx exec count = %d, want 4", len(gotTx))
	}
	if gotTx[0] != "SELECT 1;" || gotTx[2] != "SELECT 2;" {
		t.Fatalf("tx exec queries = %v, want migration contents in sorted order", gotTx)
	}

	state.mu.Lock()
	commits := state.commitCount
	state.mu.Unlock()
	if commits != 2 {
		t.Fatalf("commit count = %d, want 2", commits)
	}
}

func TestRunMigrationsFromDirectoriesUsesOneGlobalFilenameOrder(t *testing.T) {
	publicDirectory := t.TempDir()
	privateDirectory := t.TempDir()
	writeMigrationFile(t, publicDirectory, "002_public.sql", "SELECT 2;")
	writeMigrationFile(t, privateDirectory, "001_private.sql", "SELECT 1;")
	writeMigrationFile(t, privateDirectory, "003_private.sql", "SELECT 3;")

	db, state := openMigrationMockDB(t, migrationMockConfig{})
	if err := RunMigrationsFromDirectories(
		db,
		[]string{publicDirectory, privateDirectory},
	); err != nil {
		t.Fatalf("RunMigrationsFromDirectories() returned error: %v", err)
	}

	if got := existsChecks(state); strings.Join(got, ",") != "001_private.sql,002_public.sql,003_private.sql" {
		t.Fatalf("exists checks = %v, want global filename order", got)
	}
}

func TestRunMigrationsFromDirectoriesRejectsFilenameCollision(t *testing.T) {
	publicDirectory := t.TempDir()
	privateDirectory := t.TempDir()
	writeMigrationFile(t, publicDirectory, "001_shared.sql", "SELECT 1;")
	writeMigrationFile(t, privateDirectory, "001_shared.sql", "SELECT 2;")

	db, state := openMigrationMockDB(t, migrationMockConfig{})
	err := RunMigrationsFromDirectories(
		db,
		[]string{publicDirectory, privateDirectory},
	)
	if err == nil || !strings.Contains(err.Error(), "migration filename collision 001_shared.sql") {
		t.Fatalf("RunMigrationsFromDirectories() error = %v, want collision error", err)
	}
	if got := existsChecks(state); len(got) != 0 {
		t.Fatalf("exists checks = %v, want no migration execution after collision", got)
	}
	if got := directQueries(state); len(got) != 0 {
		t.Fatalf("direct queries = %v, want no database writes after collision", got)
	}
}

func TestRunMigrationsFromDirectoriesRejectsMissingSource(t *testing.T) {
	db, state := openMigrationMockDB(t, migrationMockConfig{})
	missingDirectory := filepath.Join(t.TempDir(), "missing")

	err := RunMigrationsFromDirectories(db, []string{missingDirectory})
	if err == nil || !strings.Contains(err.Error(), "migration directory") {
		t.Fatalf("RunMigrationsFromDirectories() error = %v, want missing-directory error", err)
	}
	if got := directQueries(state); len(got) != 0 {
		t.Fatalf("direct queries = %v, want no database writes for missing source", got)
	}
}

func TestRunMigrationsFromDirectoriesRejectsEmptySources(t *testing.T) {
	db, state := openMigrationMockDB(t, migrationMockConfig{})

	err := RunMigrationsFromDirectories(db, nil)
	if err == nil || !strings.Contains(err.Error(), "at least one migration directory") {
		t.Fatalf("RunMigrationsFromDirectories() error = %v, want empty-source error", err)
	}
	if got := directQueries(state); len(got) != 0 {
		t.Fatalf("direct queries = %v, want no database writes for empty sources", got)
	}
}

func TestRunMigrationsHonorsExactFilenameAllowlist(t *testing.T) {
	dir := t.TempDir()
	writeMigrationFile(t, dir, "001_private.sql", "SELECT 1;")
	writeMigrationFile(t, dir, "002_public_repair.sql", "SELECT 2;")
	writeMigrationFile(t, dir, "003_private.sql", "SELECT 3;")
	t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", " 002_public_repair.sql ")

	db, state := openMigrationMockDB(t, migrationMockConfig{})
	if err := RunMigrations(db, dir); err != nil {
		t.Fatalf("RunMigrations() returned error: %v", err)
	}

	if got := existsChecks(state); strings.Join(got, ",") != "002_public_repair.sql" {
		t.Fatalf("exists checks = %v, want only the allowlisted migration", got)
	}
	gotTx := txQueries(state)
	if len(gotTx) != 2 || gotTx[0] != "SELECT 2;" {
		t.Fatalf("tx queries = %v, want only the allowlisted migration and tracking insert", gotTx)
	}
}

func TestRunMigrationsExecutesSelfManagedMigrationDirectly(t *testing.T) {
	dir := t.TempDir()
	content := "-- migration header\n-- more context\n\nBEGIN;\nSELECT 1;\nCOMMIT;"
	writeMigrationFile(t, dir, "001_self.sql", content)

	db, state := openMigrationMockDB(t, migrationMockConfig{})

	if err := RunMigrations(db, dir); err != nil {
		t.Fatalf("RunMigrations() returned error: %v", err)
	}

	if got := txQueries(state); len(got) != 0 {
		t.Fatalf("tx queries = %v, want none for self-managed migration", got)
	}
	gotDirect := directQueries(state)
	if len(gotDirect) < 3 || gotDirect[1] != content {
		t.Fatalf("direct queries = %v, want self-managed content via direct exec", gotDirect)
	}
}

func TestRunMigrationsSkipsOptionalTransactionalFailureAndRecordsMigration(t *testing.T) {
	dir := t.TempDir()
	filename := "001_optional.sql"
	content := "-- skip-on-error\nSELECT broken;"
	writeMigrationFile(t, dir, filename, content)

	db, state := openMigrationMockDB(t, migrationMockConfig{
		execRules: []migrationExecRule{
			{contains: "SELECT broken;", inTx: true, err: fmt.Errorf("migration exploded")},
		},
	})

	if err := RunMigrations(db, dir); err != nil {
		t.Fatalf("RunMigrations() returned error: %v", err)
	}

	state.mu.Lock()
	rollbacks := state.rollbackCount
	recorded := state.existing[filename]
	state.mu.Unlock()

	if rollbacks != 1 {
		t.Fatalf("rollback count = %d, want 1", rollbacks)
	}
	if !recorded {
		t.Fatalf("migration %s was not recorded as applied after skip-on-error", filename)
	}
}

func TestRunMigrationsReturnsMigrationExecutionErrorWhenNotOptional(t *testing.T) {
	dir := t.TempDir()
	writeMigrationFile(t, dir, "001_fail.sql", "SELECT broken;")

	db, state := openMigrationMockDB(t, migrationMockConfig{
		execRules: []migrationExecRule{
			{contains: "SELECT broken;", inTx: true, err: fmt.Errorf("boom")},
		},
	})

	err := RunMigrations(db, dir)
	if err == nil || !strings.Contains(err.Error(), "migration 001_fail.sql failed") {
		t.Fatalf("RunMigrations() error = %v, want migration failure", err)
	}

	state.mu.Lock()
	rollbacks := state.rollbackCount
	state.mu.Unlock()
	if rollbacks != 1 {
		t.Fatalf("rollback count = %d, want 1", rollbacks)
	}
}

func TestRunMigrationsReturnsTrackingInsertFailure(t *testing.T) {
	dir := t.TempDir()
	filename := "001_track.sql"
	writeMigrationFile(t, dir, filename, "SELECT 1;")

	db, state := openMigrationMockDB(t, migrationMockConfig{
		execRules: []migrationExecRule{
			{contains: "INSERT INTO system_schema_migrations", arg0: filename, inTx: true, err: fmt.Errorf("track failed")},
		},
	})

	err := RunMigrations(db, dir)
	if err == nil || !strings.Contains(err.Error(), "tracking insert failed") {
		t.Fatalf("RunMigrations() error = %v, want tracking-insert failure", err)
	}

	state.mu.Lock()
	rollbacks := state.rollbackCount
	state.mu.Unlock()
	if rollbacks != 1 {
		t.Fatalf("rollback count = %d, want 1", rollbacks)
	}
}

func TestRunMigrationsReturnsCommitFailure(t *testing.T) {
	dir := t.TempDir()
	writeMigrationFile(t, dir, "001_commit.sql", "SELECT 1;")

	db, _ := openMigrationMockDB(t, migrationMockConfig{
		commitErr: fmt.Errorf("commit failed"),
	})

	err := RunMigrations(db, dir)
	if err == nil || !strings.Contains(err.Error(), "commit failed") {
		t.Fatalf("RunMigrations() error = %v, want commit failure", err)
	}
}
