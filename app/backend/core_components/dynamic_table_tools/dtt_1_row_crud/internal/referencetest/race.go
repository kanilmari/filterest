// race.go
// Shares the deterministic stored-key race proof between add-row and update-row.
// Runs only against a disposable PostgreSQL cluster, through production validators.
// A driver barrier stops after the real resolution/read; no timing or sleeps order it.
package referencetest

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lib/pq"
)

type barrier struct {
	ready, release chan struct{}
	once           sync.Once
	match          string
}

type connector struct {
	driver.Connector
	barrier *barrier
}

func (c connector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.Connector.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return &connection{Conn: conn, barrier: c.barrier}, nil
}

type connection struct {
	driver.Conn
	barrier *barrier
}

func (c *connection) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	rows, err := c.Conn.(driver.QueryerContext).QueryContext(ctx, query, args)
	if err != nil || !strings.HasPrefix(query, c.barrier.match) {
		return rows, err
	}
	return &barrierRows{Rows: rows, barrier: c.barrier, ctx: ctx}, nil
}

type barrierRows struct {
	driver.Rows
	barrier *barrier
	ctx     context.Context
}

func (r *barrierRows) Close() error {
	err := r.Rows.Close() // the server has already resolved (and, now, locked) the row
	r.barrier.once.Do(func() {
		close(r.barrier.ready)
		select {
		case <-r.barrier.release:
		case <-r.ctx.Done():
		}
	})
	return err
}

// Run attempts the gate's key reassignment after resolution. Ordinary targets
// must hold row 1; accounts permit the swap but must refuse the resulting hidden
// row 2 after the write. Only the actor and editor connections are open in the race.
func Run(t *testing.T, account bool, write func(*sql.Tx, string) error) {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL verification")
	}
	target := "reference_targets"
	if account {
		target = "system_users"
	}
	owner, dsn := cluster(t)
	execSQL(t, owner, fmt.Sprintf(fixture, pq.QuoteIdentifier(target), pq.QuoteIdentifier(target), target, pq.QuoteIdentifier(target)))
	b := &barrier{ready: make(chan struct{}), release: make(chan struct{}), match: `SELECT "id" FROM "reference_targets" WHERE "code" = $1`}
	if account {
		// Stop after the entire initial visibility read, before the source write.
		b.match = `SELECT "system_users"."id" FROM "system_users"`
	} else {
		execSQL(t, owner, `GRANT UPDATE(id) ON reference_targets TO reference_reader`)
	}
	base, err := pq.NewConnector(dsn + " user=reference_reader")
	if err != nil {
		t.Fatal(err)
	}
	reader := sql.OpenDB(connector{Connector: base, barrier: b})
	reader.SetMaxOpenConns(1)
	defer reader.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	tx, err := reader.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var release sync.Once
	resume := func() { release.Do(func() { close(b.release) }) }
	defer resume()
	done := make(chan error, 1)
	go func() { done <- write(tx, target) }()
	select {
	case <-b.ready:
	case err := <-done:
		t.Fatalf("write finished before the resolution barrier: %v", err)
	case <-ctx.Done():
		t.Fatal("resolution barrier timed out")
	}
	editor, err := owner.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer editor.Rollback()
	// NOWAIT deterministically distinguishes a held row lock from the round-1
	// gap. When no lock exists, complete exactly the gate's two-row key swap.
	_, lockErr := editor.ExecContext(ctx, "SELECT id FROM "+pq.QuoteIdentifier(target)+" WHERE id=1 FOR UPDATE NOWAIT")
	if lockErr == nil {
		execSQL(t, editor, "UPDATE "+pq.QuoteIdentifier(target)+" SET code='OLD' WHERE id=1")
		execSQL(t, editor, "UPDATE "+pq.QuoteIdentifier(target)+" SET code='ONE' WHERE id=2")
		if err := editor.Commit(); err != nil {
			t.Fatal(err)
		}
	} else {
		var pgErr *pq.Error
		if !errors.As(lockErr, &pgErr) || pgErr.Code != "55P03" || account {
			t.Fatalf("unexpected editor lock refusal: %v", lockErr)
		}
		_ = editor.Rollback()
	}
	// No lock may have spilled onto row 2, including on the denied account path.
	unrelated, err := owner.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	execSQL(t, unrelated, "SELECT id FROM "+pq.QuoteIdentifier(target)+" WHERE id=2 FOR UPDATE NOWAIT")
	_ = unrelated.Rollback()
	resume()
	var writeErr error
	select {
	case writeErr = <-done:
	case <-ctx.Done():
		t.Fatal("write did not finish after the barrier")
	}
	if account {
		_ = tx.Rollback()
		if writeErr == nil || !strings.Contains(writeErr.Error(), "foreign row cannot be read") {
			t.Fatalf("account key moved to hidden row 2: write error=%v, want unreadable refusal", writeErr)
		}
		var count int
		if err := owner.QueryRow(`SELECT count(*) FROM reference_sources WHERE target_code IS NOT NULL`).Scan(&count); err != nil || count != 0 {
			t.Fatalf("refused write persisted %d references: %v", count, err)
		}
		return
	}
	if writeErr != nil {
		t.Fatal(writeErr)
	}
	var id int
	query := "SELECT target.id FROM reference_sources source JOIN " + pq.QuoteIdentifier(target) + " target ON target.code=source.target_code"
	if err := tx.QueryRowContext(ctx, query).Scan(&id); err != nil || id != 1 {
		t.Fatalf("stored reference resolves to row %d: %v; want the authorized row 1", id, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func execSQL(t *testing.T, q interface {
	Exec(string, ...interface{}) (sql.Result, error)
}, query string) {
	t.Helper()
	if _, err := q.Exec(query); err != nil {
		t.Fatal(err)
	}
}

// cluster never reads installation settings or uses an installation database.
func cluster(t *testing.T) (*sql.DB, string) {
	t.Helper()
	root := t.TempDir()
	socket, data := filepath.Join(root, "socket"), filepath.Join(root, "db")
	if err := os.Mkdir(socket, 0o700); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	const bin = "/usr/lib/postgresql/16/bin/"
	run := func(name string, args ...string) {
		t.Helper()
		if out, err := exec.Command(bin+name, args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, out)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		_, _ = exec.Command(bin+"pg_ctl", "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", fmt.Sprintf("-h '' -k '%s' -p %d", socket, port), "-w", "start")
	dsn := fmt.Sprintf("host=%s port=%d dbname=postgres sslmode=disable", socket, port)
	owner, err := sql.Open("postgres", dsn+" user=test_owner")
	if err != nil {
		t.Fatal(err)
	}
	owner.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = owner.Close() })
	migration, err := os.ReadFile("../../../../../server_tools/migrations/20260902000004_finalize_row_access_fail_closed_defaults.sql")
	if err != nil {
		t.Fatal(err)
	}
	_, definition, found := strings.Cut(string(migration), "CREATE OR REPLACE FUNCTION public.resolve_effective_row_access(")
	if !found {
		t.Fatal("exact-row resolver missing")
	}
	body, _, found := strings.Cut(definition, "$$;")
	if !found {
		t.Fatal("exact-row resolver end missing")
	}
	// Tables must precede the resolver because it declares their row types.
	execSQL(t, owner, metadataFixture)
	execSQL(t, owner, "CREATE OR REPLACE FUNCTION public.resolve_effective_row_access("+body+"$$;")
	return owner, dsn
}

const metadataFixture = `
CREATE TABLE system_db_tables(table_uid bigint PRIMARY KEY,table_name text UNIQUE,schema_name text DEFAULT 'public',row_policy_owner_column text);
CREATE TABLE system_column_details(table_uid bigint,column_name text,must_be_true_unless_own boolean DEFAULT false);
CREATE TABLE system_permission_actions(id bigint PRIMARY KEY,action_key text,enabled boolean DEFAULT true,scope_type text DEFAULT 'row');
CREATE TABLE system_row_access_rules(table_uid bigint,action_id bigint,row_id bigint,user_id bigint,group_id bigint,effect text,valid_from timestamptz DEFAULT now(),valid_until timestamptz);
CREATE TABLE system_user_group_memberships(user_id bigint,group_id bigint);
CREATE TABLE system_functions(id bigint PRIMARY KEY,url_route_endpoint text,disabled boolean);
CREATE TABLE system_group_table_func_rights(user_group_id bigint,function_id bigint,target_table_uid bigint);
INSERT INTO system_permission_actions VALUES(1,'read',true,'row');
INSERT INTO system_user_group_memberships VALUES(4,2);
INSERT INTO system_functions VALUES(1,'/api/get-results',false);
INSERT INTO system_group_table_func_rights VALUES(2,1,102);
`

const fixture = `
CREATE TABLE %s(id integer PRIMARY KEY,code text UNIQUE,published boolean,enabled boolean DEFAULT true);
CREATE TABLE reference_sources(id integer PRIMARY KEY,target_code text REFERENCES %s(code));
INSERT INTO system_db_tables(table_uid,table_name) VALUES(101,'reference_sources'),(102,'%s');
INSERT INTO system_column_details VALUES(102,'published',true);
INSERT INTO %s(id,code,published) VALUES(1,'ONE',true),(2,'TWO',false);
INSERT INTO reference_sources VALUES(41,NULL);
CREATE ROLE reference_reader LOGIN NOSUPERUSER;
GRANT USAGE ON SCHEMA public TO reference_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reference_reader;
GRANT INSERT,UPDATE ON reference_sources TO reference_reader;
`
