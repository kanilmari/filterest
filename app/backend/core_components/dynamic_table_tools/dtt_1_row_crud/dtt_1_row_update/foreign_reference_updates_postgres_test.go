// foreign_reference_updates_postgres_test.go
// Proves ordinary FK edits with real integer and text keys, without a race.
// Uses production conversion, source policy, reference checks and post-write check.
// Creates and removes an isolated cluster; never reads installation settings.
package dtt_1_row_update

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/httpresponse"
	"github.com/lib/pq"
)

func TestUpdateRowForeignReferenceChangePostgres(t *testing.T) {
	owner, reader := updateReferencePostgres(t)
	for keyIndex, key := range []struct {
		name, column, udt, original string
		readable, hidden, denied    interface{}
	}{
		{"integer", "target_number", "int4", "103", float64(101), float64(102), float64(104)},
		{"text", "target_text", "text", "OLD", "ONE", "TWO", "DENIED"},
	} {
		for caseIndex, tc := range []struct {
			name    string
			value   interface{}
			allowed bool
		}{
			{"readable", key.readable, true},
			{"hidden_row", key.hidden, false},
			{"explicit_deny", key.denied, false},
		} {
			t.Run(key.name+"/"+tc.name, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				tx, err := reader.BeginTx(ctx, nil)
				if err != nil {
					t.Fatal(err)
				}
				defer tx.Rollback()
				rowID := int64(41 + keyIndex*3 + caseIndex)
				visible, err := read.LockRowsVisibleForMutation(tx, "update_reference_sources", "basic", 4, []int64{rowID})
				if err != nil || !visible {
					t.Fatalf("lock editable source: visible=%v, error=%v", visible, err)
				}
				// Convert as the handler does, using the real source column metadata.
				dataType, err := getColumnDataType("update_reference_sources", key.column, tx)
				if err != nil {
					t.Fatal(err)
				}
				var udt string
				if err := tx.QueryRow(`SELECT udt_name FROM information_schema.columns
					WHERE table_schema='public' AND table_name='update_reference_sources' AND column_name=$1`, key.column).Scan(&udt); err != nil || udt != key.udt {
					t.Fatalf("actual key type: %q, error=%v; want %q", udt, err, key.udt)
				}
				value, err := convertValue(tc.value, dataType)
				if err != nil {
					t.Fatal(err)
				}
				refs, err := validateUpdatedForeignReferences(tx, "update_reference_sources", key.column, value, 4, "basic")
				if !tc.allowed {
					var refusal *httpresponse.Refusal
					if !errors.As(err, &refusal) || refusal.Status != 403 || !strings.Contains(refusal.Message, "foreign row cannot be read") {
						t.Fatalf("unreadable target: %v; want reference refusal (403)", err)
					}
					if err := tx.Rollback(); err != nil {
						t.Fatal(err)
					}
				} else {
					if err != nil || len(refs) != 1 || refs[0].id != 1 {
						t.Fatalf("resolve readable non-ID key: refs=%v, error=%v", refs, err)
					}
					where, args, err := read.AppendUpdateRowPolicyToWhereClause(tx, "update_reference_sources", "basic", 4,
						` WHERE "update_reference_sources"."id"=$2`, []interface{}{value, rowID})
					if err != nil {
						t.Fatal(err)
					}
					query := `UPDATE "update_reference_sources" SET ` + pq.QuoteIdentifier(key.column) + `=$1` + where
					result, err := tx.ExecContext(ctx, query, args...)
					if err != nil {
						t.Fatal(err)
					}
					if count, err := result.RowsAffected(); err != nil || count != 1 {
						t.Fatalf("updated %d rows: %v", count, err)
					}
					if err := recheckUpdatedForeignReferences(tx, refs, 4, "basic"); err != nil {
						t.Fatal(err)
					}
					if err := tx.Commit(); err != nil {
						t.Fatal(err)
					}
				}
				// Check from another connection after commit/refusal, not just in tx.
				var stored string
				query := `SELECT ` + pq.QuoteIdentifier(key.column) + `::text FROM update_reference_sources WHERE id=$1`
				if err := owner.QueryRowContext(ctx, query, rowID).Scan(&stored); err != nil {
					t.Fatal(err)
				}
				want := key.original
				if tc.allowed {
					want = fmt.Sprint(value)
				}
				if stored != want {
					t.Fatalf("stored key=%q; want %q", stored, want)
				}
			})
		}
	}
}

func updateReferencePostgres(t *testing.T) (*sql.DB, *sql.DB) {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL verification")
	}
	root := t.TempDir()
	socket, data := filepath.Join(root, "socket"), filepath.Join(root, "db")
	if err := os.Mkdir(socket, 0o700); err != nil {
		t.Fatal(err)
	}
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
	// A unique socket directory needs no TCP listener or port reservation.
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", fmt.Sprintf("-h '' -k '%s'", socket), "-w", "start")
	open := func(user string) *sql.DB {
		t.Helper()
		db, err := sql.Open("postgres", fmt.Sprintf("host=%s dbname=postgres user=%s sslmode=disable", socket, user))
		if err != nil {
			t.Fatal(err)
		}
		db.SetMaxOpenConns(1)
		t.Cleanup(func() { _ = db.Close() })
		return db
	}
	owner := open("test_owner")
	if _, err := owner.Exec(updateReferenceFixture); err != nil {
		t.Fatal(err)
	}
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
	if _, err := owner.Exec("CREATE OR REPLACE FUNCTION public.resolve_effective_row_access(" + body + "$$;"); err != nil {
		t.Fatal(err)
	}
	return owner, open("update_reference_reader")
}

const updateReferenceFixture = `
CREATE TABLE system_db_tables(table_uid bigint PRIMARY KEY,table_name text UNIQUE,schema_name text DEFAULT 'public',row_policy_owner_column text);
CREATE TABLE system_column_details(table_uid bigint,column_name text,must_be_true_unless_own boolean DEFAULT false);
CREATE TABLE system_permission_actions(id bigint PRIMARY KEY,action_key text,enabled boolean DEFAULT true,scope_type text DEFAULT 'row');
CREATE TABLE system_row_access_rules(table_uid bigint,action_id bigint,row_id bigint,user_id bigint,group_id bigint,effect text,valid_from timestamptz DEFAULT now(),valid_until timestamptz);
CREATE TABLE system_user_group_memberships(user_id bigint,group_id bigint);
CREATE TABLE system_functions(id bigint PRIMARY KEY,url_route_endpoint text,disabled boolean);
CREATE TABLE system_group_table_func_rights(user_group_id bigint,function_id bigint,target_table_uid bigint);
CREATE TABLE update_reference_targets(id integer PRIMARY KEY,key_number integer UNIQUE,key_text text UNIQUE,published boolean);
CREATE TABLE update_reference_sources(id integer PRIMARY KEY,target_number integer REFERENCES update_reference_targets(key_number),target_text text REFERENCES update_reference_targets(key_text));
INSERT INTO system_permission_actions VALUES(1,'read',true,'row'),(2,'update',true,'row');
INSERT INTO system_user_group_memberships VALUES(4,2);
INSERT INTO system_functions VALUES(1,'/api/get-results',false);
INSERT INTO system_group_table_func_rights VALUES(2,1,102);
INSERT INTO system_db_tables(table_uid,table_name) VALUES(101,'update_reference_sources'),(102,'update_reference_targets');
INSERT INTO system_column_details VALUES(102,'published',true);
INSERT INTO system_row_access_rules(table_uid,action_id,row_id,user_id,effect) VALUES(102,1,4,4,'deny');
INSERT INTO update_reference_targets VALUES(1,101,'ONE',true),(2,102,'TWO',false),(3,103,'OLD',true),(4,104,'DENIED',true);
INSERT INTO update_reference_sources SELECT id,103,'OLD' FROM generate_series(41,46) AS id;
CREATE ROLE update_reference_reader LOGIN NOSUPERUSER;
GRANT USAGE ON SCHEMA public TO update_reference_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO update_reference_reader;
GRANT UPDATE ON update_reference_sources TO update_reference_reader;
GRANT UPDATE(id) ON update_reference_targets TO update_reference_reader;
`
