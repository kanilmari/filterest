// create_table_registration_test.go
// Verifies requested dataset reads and atomic permission failure rollback.
// Exercises creation helpers against an isolated PostgreSQL cluster and pools.
// Prevents application grants from promising access the SQL reader cannot use.
package dtt_crud_workflows

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	dtt_3_table_create "easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_create"
	"github.com/lib/pq"
)

func TestRequestedTableReadPermissionsNoFlagsNeedNoPools(t *testing.T) {
	oldBasic, oldGuest := backend.DbBasic, backend.DbGuest
	backend.DbBasic, backend.DbGuest = nil, nil
	t.Cleanup(func() { backend.DbBasic, backend.DbGuest = oldBasic, oldGuest })
	if err := grantRequestedTableReadPermissions(nil, "new_dataset", false, false); err != nil {
		t.Fatal(err)
	}
	for _, flags := range [][2]bool{{true, false}, {false, true}} {
		if err := grantRequestedTableReadPermissions(nil, "new_dataset", flags[0], flags[1]); err == nil {
			t.Fatal("requested reader without its runtime pool was accepted")
		}
	}
}

func registrationDisposableDB(t *testing.T) (*sql.DB, func(string) *sql.DB) {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 to run isolated PostgreSQL verification")
	}
	root, err := os.MkdirTemp("", "filterest-create-acl-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(root); err != nil {
			t.Errorf("remove isolated cluster: %v", err)
		}
	})
	socket := filepath.Join(root, "socket")
	if err := os.Mkdir(socket, 0700); err != nil {
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
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		output, err := exec.Command(bin+"pg_ctl", "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
		if err != nil {
			t.Errorf("stop isolated PostgreSQL: %v: %s", err, output)
		}
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"),
		"-o", "-h '' -k '"+socket+"' -p 15461", "-w", "start")
	connect := func(role string) *sql.DB {
		t.Helper()
		// Roles below are fixed test data; the quoted role exercises SQL identifier escaping.
		db, err := sql.Open("postgres", "host="+socket+" port=15461 user='"+role+"' dbname=postgres sslmode=disable")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		return db
	}
	owner := connect("test_owner")
	if err := owner.Ping(); err != nil {
		t.Fatal(err)
	}
	return owner, connect
}

func TestCreatedDatasetReadPermissionMatrixPostgres(t *testing.T) {
	db, connect := registrationDisposableDB(t)
	const basicRole = "wl74_basic_reader"
	const guestRole = `wl74 guest "reader"`
	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, role := range []string{basicRole, guestRole} {
		mustExec("CREATE ROLE " + pq.QuoteIdentifier(role) + " LOGIN")
		mustExec("GRANT USAGE ON SCHEMA public TO " + pq.QuoteIdentifier(role))
	}
	mustExec(`
        CREATE TABLE system_db_tables(table_uid integer PRIMARY KEY,table_name text,schema_name text);
        CREATE TABLE system_functions(id integer PRIMARY KEY,name text,specific_table_related boolean,disabled boolean);
        CREATE TABLE system_user_groups(id integer PRIMARY KEY,name text);
        CREATE TABLE system_group_table_func_rights(user_group_id integer,function_id integer,target_table_uid integer,target_schema_name text);
        CREATE UNIQUE INDEX fixture_permission_identity ON system_group_table_func_rights(user_group_id,function_id,COALESCE(target_table_uid,0));
        INSERT INTO system_user_groups VALUES(1,'admins'),(2,'users'),(3,'guests');
        INSERT INTO system_functions VALUES
            (1,'dtt_1_row_read.GetResultsHandlerWrapper',true,false),
            (4,'dtt_1_row_read.FilterbarAICodexQueryHandler',true,false),
            (5,'router.RetiredHandler',true,true),
            (6,'system_table_tools.GetGroupedTables',false,false);
        -- Creating a dataset now also names it and its columns for the
        -- interface, so the fixture carries the two stores those names live in.
        -- Without them the fixture passes for a reason production does not share.
        CREATE TABLE system_lang_keys(id bigserial PRIMARY KEY,lang_key text UNIQUE,fi text,en text,ch text,yue text,lang_key_type integer,creation_spec text,created timestamp DEFAULT now(),updated timestamp DEFAULT now());
        CREATE TABLE system_lang_key_translations(id bigserial PRIMARY KEY,lang_key_id bigint REFERENCES system_lang_keys(id) ON DELETE CASCADE,language_code text,translation text,source_kind text,review_status text,created timestamptz DEFAULT now(),updated timestamptz DEFAULT now(),UNIQUE(lang_key_id,language_code));
        CREATE TABLE system_lang_key_sources(id serial PRIMARY KEY,lang_key_id integer,source_type text,source_high text,source_low text,last_seen date,usage_explanation text,UNIQUE(lang_key_id,source_type,source_high));
        CREATE TABLE system_languages(id bigserial PRIMARY KEY,language_code text UNIQUE,english_name text,native_name text,is_enabled boolean DEFAULT false,is_default boolean DEFAULT false,sort_order integer DEFAULT 0);
        INSERT INTO system_languages(language_code,english_name,native_name,is_enabled,is_default,sort_order)
            VALUES ('fi','Finnish','suomi',true,true,10),('en','English','English',true,false,20);
        CREATE TABLE existing_dataset(id integer PRIMARY KEY,title text);
        INSERT INTO existing_dataset VALUES(1,'preserved');
    `)
	oldBasic, oldGuest := backend.DbBasic, backend.DbGuest
	backend.DbBasic, backend.DbGuest = connect(basicRole), connect(guestRole)
	t.Cleanup(func() { backend.DbBasic, backend.DbGuest = oldBasic, oldGuest })
	// An existing runtime pool is authoritative even when env/default resolution differs.
	t.Setenv("DB_BASIC_USER", "deliberately_not_the_connected_role")
	t.Setenv("DB_GUEST_USER", "")
	var baselineACL string
	if err := db.QueryRow("SELECT COALESCE(relacl::text,'') FROM pg_class WHERE oid='existing_dataset'::regclass").Scan(&baselineACL); err != nil {
		t.Fatal(err)
	}

	create := func(name string, uid int, users, guests bool) error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if err := dtt_3_table_create.CreateNewTableInDatabase(tx, name, map[string]string{"id": "SERIAL", "title": "TEXT"}, nil); err != nil {
			return err
		}
		if _, err := tx.Exec("INSERT INTO system_db_tables VALUES($1,$2,'public')", uid, name); err != nil {
			return err
		}
		if err := ensureTablePermissions(tx, name, users, guests); err != nil {
			return err
		}
		if _, err := tx.Exec("INSERT INTO " + pq.QuoteIdentifier(name) + "(title) VALUES('visible')"); err != nil {
			return err
		}
		return tx.Commit()
	}
	for i, flags := range [][2]bool{{false, false}, {true, false}, {false, true}, {true, true}} {
		name := fmt.Sprintf("new_dataset_%d", i)
		t.Run(name, func(t *testing.T) {
			if err := create(name, i+1, flags[0], flags[1]); err != nil {
				t.Fatal(err)
			}
			for j, reader := range []struct {
				role string
				pool *sql.DB
			}{{basicRole, backend.DbBasic}, {guestRole, backend.DbGuest}} {
				var title string
				err := reader.pool.QueryRow("SELECT title FROM " + pq.QuoteIdentifier(name)).Scan(&title)
				if flags[j] {
					if err != nil || title != "visible" {
						t.Fatalf("requested read failed: %v %q", err, title)
					}
				} else if err == nil {
					t.Fatal("unrequested reader could read")
				}
				var appRight bool
				if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM system_group_table_func_rights WHERE target_table_uid=$1 AND user_group_id=$2 AND function_id=1)", i+1, j+2).Scan(&appRight); err != nil {
					t.Fatal(err)
				}
				if appRight != flags[j] {
					t.Fatal("application and physical read rights disagree")
				}
				var sqlRights, sequenceRights string
				if err := db.QueryRow(`SELECT COALESCE(string_agg(privilege_type,',' ORDER BY privilege_type),'')
                    FROM information_schema.table_privileges WHERE table_schema='public' AND table_name=$1 AND grantee=$2`, name, reader.role).Scan(&sqlRights); err != nil {
					t.Fatal(err)
				}
				expected := ""
				if flags[j] {
					expected = "SELECT"
				}
				if sqlRights != expected {
					t.Fatalf("unexpected table privileges: %q", sqlRights)
				}
				if err := db.QueryRow(`SELECT has_sequence_privilege($1,$2,'USAGE')::text || ',' ||
                    has_sequence_privilege($1,$2,'SELECT')::text || ',' || has_sequence_privilege($1,$2,'UPDATE')::text`, reader.role, name+"_id_seq").Scan(&sequenceRights); err != nil {
					t.Fatal(err)
				}
				if sequenceRights != "false,false,false" {
					t.Fatalf("unexpected sequence rights: %s", sequenceRights)
				}
				if _, err := reader.pool.Exec("INSERT INTO " + pq.QuoteIdentifier(name) + "(title) VALUES('forbidden')"); err == nil {
					t.Fatal("reader could write")
				}
			}
			// A dataset-specific route registered after this code was written
			// must still work for administrators on a brand-new dataset, while
			// retired and dataset-independent routes stay out of the grant.
			var adminFunctions string
			if err := db.QueryRow(`SELECT COALESCE(string_agg(function_id::text,',' ORDER BY function_id),'')
                FROM system_group_table_func_rights WHERE user_group_id=1 AND target_table_uid=$1`, i+1).Scan(&adminFunctions); err != nil {
				t.Fatal(err)
			}
			if adminFunctions != "1,4" {
				t.Fatalf("admin dataset rights = %q, want the enabled dataset-specific functions", adminFunctions)
			}
		})
	}
	t.Run("duplicate_dataset_preserves_existing_rows_metadata_and_acl", func(t *testing.T) {
		for _, name := range []string{"existing_dataset", "new_dataset_0"} {
			var aclBefore, aclAfter string
			if err := db.QueryRow("SELECT COALESCE(relacl::text,'') FROM pg_class WHERE oid=to_regclass($1)", name).Scan(&aclBefore); err != nil {
				t.Fatal(err)
			}
			err := create(name, 77, true, true)
			var sqlErr *pq.Error
			if !errors.As(err, &sqlErr) || sqlErr.Code != "42P07" {
				t.Fatalf("duplicate creation should fail before registration: %v", err)
			}
			if err := db.QueryRow("SELECT COALESCE(relacl::text,'') FROM pg_class WHERE oid=to_regclass($1)", name).Scan(&aclAfter); err != nil {
				t.Fatal(err)
			}
			if aclAfter != aclBefore {
				t.Fatal("duplicate request changed existing dataset privileges")
			}
			var registrations int
			if err := db.QueryRow("SELECT count(*) FROM system_db_tables WHERE table_uid=77").Scan(&registrations); err != nil {
				t.Fatal(err)
			}
			if registrations != 0 {
				t.Fatal("duplicate request registered metadata")
			}
		}
	})
	t.Run("missing_runtime_role_rolls_back_table_metadata_and_grants", func(t *testing.T) {
		old := backend.DbGuest
		backend.DbGuest = connect("wl74_missing_reader")
		defer func() { backend.DbGuest = old }()
		err := create("failed_dataset", 99, true, true)
		if err == nil || !strings.Contains(err.Error(), "resolve guest database role") {
			t.Fatalf("expected role failure, got %v", err)
		}
		var relationExists bool
		var metadataCount, permissionCount int
		if err := db.QueryRow("SELECT to_regclass('public.failed_dataset') IS NOT NULL").Scan(&relationExists); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow("SELECT count(*) FROM system_db_tables WHERE table_uid=99").Scan(&metadataCount); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow("SELECT count(*) FROM system_group_table_func_rights WHERE target_table_uid=99").Scan(&permissionCount); err != nil {
			t.Fatal(err)
		}
		if relationExists || metadataCount != 0 || permissionCount != 0 {
			t.Fatal("failed creation was not atomic")
		}
	})
	var currentACL, title string
	if err := db.QueryRow("SELECT COALESCE(relacl::text,'') FROM pg_class WHERE oid='existing_dataset'::regclass").Scan(&currentACL); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT title FROM existing_dataset").Scan(&title); err != nil {
		t.Fatal(err)
	}
	if currentACL != baselineACL || title != "preserved" {
		t.Fatal("existing dataset changed")
	}
}
