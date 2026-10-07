// account_trigger_review_postgres_test.go
// Proves account-name trigger review accepts only the shipped bytes and safe catalogue shape.
// Uses exact migration definitions in an opt-in isolated PostgreSQL fixture.
// Makes changed bodies, paths, attachments and runtime ownership fail closed.
package runtime_grants

import (
	"context"
	"crypto/md5"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestReviewedAccountHelperMatchesMigration(t *testing.T) {
	_, body, _ := newestDefinerMigrationFunction(t, definerFunctionIdentity{Schema: "public", Name: "app_is_administrator_account"})
	if got := fmt.Sprintf("%x", md5.Sum([]byte(body))); got != reviewedAccountHelperBody {
		t.Fatalf("administrator helper changed; SQL-path review required: %s", got)
	}
}

func TestReviewedAccountNameTriggersPostgres(t *testing.T) {
	db, _ := grantDisposableDB(t)
	fixtureExec(t, db, `CREATE SCHEMA restricted;
        CREATE TABLE public.system_users(id bigint PRIMARY KEY,username text,admin_access_allowed boolean);
        CREATE TABLE public.system_user_group_memberships(user_id bigint,group_id bigint);
        CREATE TABLE restricted.users_restricted(id bigint,login_name text);
        CREATE TABLE public.system_config(key text,boolean_value boolean,creation_spec text);
        CREATE ROLE account_review_table_owner; CREATE ROLE account_review_function_owner; GRANT account_review_table_owner TO account_review_function_owner; CREATE ROLE account_review_basic; CREATE ROLE account_review_guest;
        CREATE ROLE account_review_readonly;CREATE ROLE account_review_confidential;
        CREATE TABLE public.unreviewed_account_attachment(id bigint,username text,admin_access_allowed boolean)`)
	helper, _, _ := newestDefinerMigrationFunction(t, definerFunctionIdentity{Schema: "public", Name: "app_is_administrator_account"})
	fixtureExec(t, db, helper)
	for _, name := range []string{"app_enforce_administrator_names_differ", "app_describe_account_name_setting"} {
		definition, _, _ := newestDefinerMigrationFunction(t, definerFunctionIdentity{Schema: "public", Name: name})
		fixtureExec(t, db, definition+`;REVOKE ALL ON FUNCTION public.`+name+`() FROM PUBLIC`)
	}
	fixtureExec(t, db, `CREATE TRIGGER app_users_names_differ AFTER UPDATE OF username,admin_access_allowed ON public.system_users FOR EACH ROW EXECUTE FUNCTION public.app_enforce_administrator_names_differ();
        CREATE TRIGGER app_memberships_names_differ AFTER INSERT OR UPDATE ON public.system_user_group_memberships FOR EACH ROW EXECUTE FUNCTION public.app_enforce_administrator_names_differ();
        CREATE TRIGGER app_credentials_names_differ AFTER INSERT OR UPDATE OF login_name,id ON restricted.users_restricted FOR EACH ROW EXECUTE FUNCTION public.app_enforce_administrator_names_differ();
        CREATE TRIGGER app_account_name_setting_description BEFORE UPDATE ON public.system_config FOR EACH ROW
        WHEN (NEW.key='display_name_may_equal_login_name' AND OLD.boolean_value IS DISTINCT FROM NEW.boolean_value)
        EXECUTE FUNCTION public.app_describe_account_name_setting()`)
	snapshot := GrantSnapshot{Objects: map[int64]Object{}}
	for _, label := range []string{"basic", "guest", "readonly", "confidential"} {
		role := Role{Label: label, Name: "account_review_" + label}
		if err := db.QueryRow(`SELECT oid FROM pg_roles WHERE rolname=$1`, role.Name).Scan(&role.OID); err != nil {
			t.Fatal(err)
		}
		snapshot.Roles = append(snapshot.Roles, role)
	}
	rows, err := db.Query(`SELECT c.oid,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','restricted') AND c.relkind='r'`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		object := Object{Kind: "table"}
		if err = rows.Scan(&object.OID, &object.Schema, &object.Name); err != nil {
			t.Fatal(err)
		}
		snapshot.Objects[object.OID] = object
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	check := func(t *testing.T, tx *sql.Tx, want bool) {
		t.Helper()
		s := snapshot
		s.Blockers = nil
		s.Dependencies = nil
		if err := readTriggerDependencies(context.Background(), tx, &s); err != nil {
			t.Fatal(err)
		}
		if (len(s.Blockers) == 0) != want {
			t.Fatalf("trigger recognition want=%v blockers=%+v", want, s.Blockers)
		}
		if len(s.Dependencies) != 0 {
			t.Fatal("account review widened limited-pool dependencies")
		}
	}
	checkRestore := func(t *testing.T, tx *sql.Tx, want bool) {
		t.Helper()
		if _, err := tx.Exec(`CREATE TEMP TABLE restore_reviewed_definers(policy jsonb);
            CREATE TEMP TABLE restore_original_functions(identity text,info jsonb)`); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(`INSERT INTO restore_reviewed_definers VALUES($1)`, string(reviewedDefinerBodiesJSON())); err != nil {
			t.Fatal(err)
		}
		script, err := os.ReadFile("../../../server_tools/ctl/lib/instance_restore_functions.sql")
		if err != nil {
			t.Fatal(err)
		}
		_, err = tx.Exec(string(script))
		if (err == nil) != want {
			t.Fatalf("restore account trigger recognition want=%v err=%v", want, err)
		}
	}
	for _, test := range []struct {
		name, sql string
		accepted  bool
	}{
		{"shipped bodies", "", true},
		{"function owner can act as table owner", `ALTER TABLE restricted.users_restricted OWNER TO account_review_table_owner;
   ALTER FUNCTION public.app_is_administrator_account(bigint) OWNER TO account_review_function_owner;
   ALTER FUNCTION public.app_enforce_administrator_names_differ() OWNER TO account_review_function_owner;
   ALTER FUNCTION public.app_describe_account_name_setting() OWNER TO account_review_function_owner;
   GRANT fixture_owner TO account_review_function_owner`, true},
		// fixture_owner is the cluster's superuser and so acts as every role; an ordinary owner shows the refusal.
		{"function owner cannot act as table owner", `CREATE ROLE account_review_foreign_owner;
   ALTER TABLE restricted.users_restricted OWNER TO account_review_foreign_owner;
   ALTER FUNCTION public.app_is_administrator_account(bigint) OWNER TO account_review_function_owner;
   ALTER FUNCTION public.app_enforce_administrator_names_differ() OWNER TO account_review_function_owner;
   ALTER FUNCTION public.app_describe_account_name_setting() OWNER TO account_review_function_owner;
   GRANT fixture_owner TO account_review_function_owner`, false},
		{"lookup path changed", `ALTER FUNCTION public.app_enforce_administrator_names_differ() SET search_path=public`, false},
		{"unreviewed attachment", `CREATE TRIGGER moved AFTER UPDATE OF username ON public.unreviewed_account_attachment FOR EACH ROW EXECUTE FUNCTION public.app_enforce_administrator_names_differ()`, false},
		{"runtime can execute function", `GRANT EXECUTE ON FUNCTION public.app_enforce_administrator_names_differ() TO account_review_basic`, false},
		{"public can execute function", `GRANT EXECUTE ON FUNCTION public.app_enforce_administrator_names_differ() TO PUBLIC`, false},
		{"runtime owns function", `ALTER FUNCTION public.app_enforce_administrator_names_differ() OWNER TO account_review_basic`, false},
		{"helper lookup path changed", `ALTER FUNCTION public.app_is_administrator_account(bigint) SET search_path=public`, false},
		{"helper volatility changed", `ALTER FUNCTION public.app_is_administrator_account(bigint) VOLATILE`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			if test.sql != "" {
				if _, err = tx.Exec(test.sql); err != nil {
					t.Fatal(err)
				}
			}
			check(t, tx, test.accepted)
			checkRestore(t, tx, test.accepted)
		})
	}
	for digest, identity := range reviewedDefinerBodies {
		if !identity.AccountTrigger {
			continue
		}
		t.Run(identity.Name+" changed bytes", func(t *testing.T) {
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			definition, body, _ := newestDefinerMigrationFunction(t, identity)
			if _, err = tx.Exec(strings.Replace(definition, body, body+" ", 1)); err != nil {
				t.Fatal(err)
			}
			check(t, tx, false)
			var oid int64
			if err = tx.QueryRow(`SELECT oid FROM pg_trigger WHERE tgfoid=to_regprocedure($1) LIMIT 1`, "public."+identity.Name+"()").Scan(&oid); err != nil {
				t.Fatal(err)
			}
			accepted, err := readReviewedAccountTrigger(context.Background(), tx, &snapshot, oid, digest)
			if err != nil || accepted {
				t.Fatal("modified body accepted", err)
			}
		})
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var recognized int
	if err = tx.QueryRow(`WITH reviewed_definer_bodies AS (SELECT key AS body_md5,value AS identity FROM jsonb_each($1::jsonb)) SELECT count(*) FROM (`+reviewedDefinerFunctionsSQL+`) reviewed`, string(reviewedDefinerBodiesJSON())).Scan(&recognized); err != nil || recognized != 2 {
		t.Fatal("audit and trigger reviews disagree", recognized, err)
	}
	var executable bool
	if err = tx.QueryRow(`SELECT has_function_privilege('account_review_basic','public.app_enforce_administrator_names_differ()','EXECUTE')`).Scan(&executable); err != nil || executable {
		t.Fatal("review granted trigger execution", err)
	}
}
