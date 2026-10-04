// account_table_write_revocations_postgres_test.go
// Proves the account-table write revocations (WL124 stage 2a) on a disposable PostgreSQL 16 cluster.
// Bridges databases granted like the Docker sites, serlog.com and the local development database with the
// start-up step, run after stage 1 as the application runs it.
// Exists to show that exactly the intended rights disappear, that ordinary writes and the credential connection keep
// working, that configured writers and unsafe setups stop the start with nothing changed, that simultaneous starts
// agree, and that each site's inverse-GRANT script restores every removed grant.
package backend

import (
	"bytes"
	"database/sql"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// accountTableFixture holds the five account and rights tables with their sequences, views over them (one over
// another view, one joining a content table), the relation registry with one ordinary gallery and one cache target,
// one ordinary automation, content datasets referencing system_users, and the credential table. Stage 1 has guest
// writes to remove, so the simultaneous-start test exercises both steps.
const accountTableFixture = `
CREATE SCHEMA restricted;
CREATE TABLE public.system_users (
    id serial PRIMARY KEY, username text NOT NULL, full_name text, website text,
    enabled boolean NOT NULL DEFAULT true, main_group_id integer);
CREATE TABLE public.system_user_groups (id serial PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.system_user_group_memberships (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES public.system_users (id) ON DELETE CASCADE,
    group_id integer NOT NULL REFERENCES public.system_user_groups (id) ON DELETE CASCADE);
CREATE TABLE public.system_functions (id serial PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.system_group_table_func_rights (
    id serial PRIMARY KEY,
    group_id integer NOT NULL REFERENCES public.system_user_groups (id) ON DELETE CASCADE,
    function_id integer REFERENCES public.system_functions (id) ON DELETE CASCADE,
    table_uid integer);
CREATE TABLE public.system_db_tables (table_uid serial PRIMARY KEY, table_name text NOT NULL UNIQUE);
CREATE TABLE public.system_foreign_key_relations_1_m (
    id serial PRIMARY KEY, source_table_uid integer, target_table_uid integer,
    source_column_name text, target_insert_specs jsonb);
CREATE TABLE public.system_triggers (
    id serial PRIMARY KEY, source_table text, condition text, target_table text, action_values text);
CREATE TABLE public.saved_views (id serial PRIMARY KEY, user_id integer REFERENCES public.system_users (id), name text);
CREATE TABLE public.notes (
    id serial PRIMARY KEY, owner_id integer REFERENCES public.system_users (id), title text, cached_image text);
CREATE TABLE public.notes_assets (
    id serial PRIMARY KEY, notes_id integer REFERENCES public.notes (id) ON DELETE CASCADE,
    asset_kind text, stored_filename text, sort_order integer);
CREATE TABLE restricted.users_restricted (
    user_id integer PRIMARY KEY REFERENCES public.system_users (id) ON DELETE CASCADE, password_hash text);
CREATE VIEW public.user_names AS SELECT id, username, full_name FROM public.system_users;
CREATE VIEW public.user_names_short AS SELECT id, username FROM public.user_names;
CREATE VIEW public.notes_with_owner AS
    SELECT note.id, note.title, owner_row.username
    FROM public.notes AS note JOIN public.system_users AS owner_row ON owner_row.id = note.owner_id;
CREATE VIEW public.recent_notes AS SELECT id, title FROM public.notes;

INSERT INTO public.system_users (username) VALUES ('admin'), ('guest'), ('alice');
INSERT INTO public.system_user_groups (name) VALUES ('admins'), ('users');
INSERT INTO public.system_user_group_memberships (user_id, group_id) VALUES (1, 1), (3, 2);
INSERT INTO public.system_functions (name) VALUES ('/api/get-results');
INSERT INTO public.system_group_table_func_rights (group_id, function_id) VALUES (2, 1);
INSERT INTO public.system_db_tables (table_name) VALUES ('notes'), ('notes_assets');
INSERT INTO public.system_foreign_key_relations_1_m (source_table_uid, target_table_uid, source_column_name, target_insert_specs)
    VALUES (2, 1, 'notes_id', '{"file_upload": {"profile_key": "asset_linking", "asset_kinds": ["image"],
            "cache_targets": [{"table": "notes", "column": "cached_image"}]}}');
INSERT INTO public.system_triggers (source_table, condition, target_table, action_values)
    VALUES ('notes', 'title = ''daily''', 'saved_views', '{"name": "{{title}}"}');

GRANT USAGE ON SCHEMA public TO guest_role, basic_role, readonly_role, confidential_role;
GRANT USAGE ON SCHEMA restricted TO confidential_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO guest_role, readonly_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON restricted.users_restricted TO confidential_role;
GRANT INSERT ON public.notes TO guest_role;
GRANT UPDATE (website) ON public.system_users TO guest_role;
`

// accountTableDockerGrants: filterest.com and fintravel.fi — basic and confidential insert and update every table
// (Docker's install and default privileges), basic also deletes its content datasets.
const accountTableDockerGrants = `
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO basic_role, confidential_role;
GRANT DELETE ON public.saved_views, public.notes, public.notes_assets TO basic_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO basic_role, confidential_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO basic_role, confidential_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO basic_role, confidential_role;
`

// accountTableSerlogGrants: serlog.com — basic and confidential insert, update and delete every table; the
// confidential role's default privileges are global (no schema).
const accountTableSerlogGrants = `
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO basic_role, confidential_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO basic_role, confidential_role;
ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO confidential_role;
`

// accountTableLNCDGrants: the local development database — basic holds every table privilege on the five, also
// column by column, and writes through the views over them; one grant is recorded under another grantor; the
// confidential role reads system_users (id, enabled) only; a SECURITY DEFINER function every role may call.
const accountTableLNCDGrants = `
GRANT SELECT ON ALL TABLES IN SCHEMA public TO basic_role;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.system_users, public.system_user_groups,
    public.system_user_group_memberships, public.system_group_table_func_rights, public.system_functions TO basic_role;
GRANT INSERT (username, full_name), UPDATE (website), REFERENCES (id) ON public.system_users TO basic_role;
GRANT INSERT, UPDATE ON public.user_names, public.user_names_short, public.notes_with_owner TO basic_role;
GRANT INSERT, UPDATE, DELETE ON public.saved_views, public.notes, public.notes_assets, public.recent_notes TO basic_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO basic_role;
GRANT UPDATE ON public.system_user_groups TO granting_editor WITH GRANT OPTION;
SET ROLE granting_editor;
GRANT UPDATE ON public.system_user_groups TO basic_role;
RESET ROLE;
GRANT SELECT (id, enabled) ON public.system_users TO confidential_role;
CREATE FUNCTION public.resolve_effective_row_access() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ SELECT true $$;
`

// accountTableACLSnapshot lists every ACL entry of the fixture's schemas and every default privilege, grantor and
// grant option included, so a restore can be compared entry for entry.
const accountTableACLSnapshot = `
WITH acl_sources AS (
    SELECT format('%I.%I', n.nspname, c.relname) AS object_name, c.relacl AS acl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'restricted') AND c.relacl IS NOT NULL
    UNION ALL
    SELECT format('%I.%I(%I)', n.nspname, c.relname, a.attname), a.attacl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname IN ('public', 'restricted') AND a.attacl IS NOT NULL
    UNION ALL
    SELECT format('default:%s:%s:%s', pg_get_userbyid(d.defaclrole), coalesce(dn.nspname, '*'), d.defaclobjtype), d.defaclacl
    FROM pg_default_acl d LEFT JOIN pg_namespace dn ON dn.oid = d.defaclnamespace
)
SELECT format('%s %s->%s %s%s', object_name,
              CASE WHEN entry.grantor = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(entry.grantor) END,
              CASE WHEN entry.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(entry.grantee) END,
              entry.privilege_type, CASE WHEN entry.is_grantable THEN '*' ELSE '' END)
FROM acl_sources CROSS JOIN LATERAL aclexplode(acl) AS entry
ORDER BY 1`

type accountTableShape struct {
	name     string
	grants   string
	mustLose []string
	mustKeep []string
	defaults []accountTableCheck
}

type accountTableCheck struct {
	query string
	want  bool
}

var accountTableShapes = []accountTableShape{
	{
		name:   "docker",
		grants: accountTableDockerGrants,
		mustLose: []string{
			"basic_role public.system_users INSERT", "basic_role public.system_user_group_memberships UPDATE",
			"basic_role public.user_names_short INSERT", "basic_role public.system_users_id_seq USAGE",
			"confidential_role public.notes INSERT", "confidential_role public.notes_id_seq USAGE",
		},
		mustKeep: []string{
			"basic_role public.notes INSERT", "basic_role public.saved_views DELETE", "basic_role public.system_users SELECT",
			"basic_role public.system_users_id_seq SELECT", "basic_role public.notes_id_seq USAGE",
			"confidential_role public.system_users SELECT", "confidential_role restricted.users_restricted DELETE",
			"confidential_role public.notes_id_seq SELECT",
		},
		defaults: []accountTableCheck{
			{`SELECT has_table_privilege('confidential_role', 'public.later_items', 'INSERT')`, false},
			{`SELECT has_table_privilege('confidential_role', 'public.later_items', 'SELECT')`, true},
			{`SELECT has_sequence_privilege('confidential_role', 'public.later_items_id_seq', 'USAGE')`, false},
			{`SELECT has_sequence_privilege('confidential_role', 'public.later_items_id_seq', 'SELECT')`, true},
			{`SELECT has_table_privilege('basic_role', 'public.later_items', 'INSERT')`, true},
		},
	},
	{
		name:   "serlog",
		grants: accountTableSerlogGrants,
		mustLose: []string{
			"basic_role public.system_users DELETE", "basic_role public.system_group_table_func_rights INSERT",
			"basic_role public.notes_with_owner UPDATE", "basic_role public.system_functions_id_seq USAGE",
			"confidential_role public.saved_views DELETE",
		},
		mustKeep: []string{
			"basic_role public.notes DELETE", "basic_role public.notes_id_seq USAGE", "basic_role public.recent_notes INSERT",
			"confidential_role restricted.users_restricted INSERT", "confidential_role public.notes SELECT",
		},
		defaults: []accountTableCheck{
			{`SELECT has_table_privilege('confidential_role', 'public.later_items', 'INSERT')`, false},
			{`SELECT has_table_privilege('confidential_role', 'public.later_items', 'DELETE')`, false},
			{`SELECT has_table_privilege('confidential_role', 'public.later_items', 'SELECT')`, true},
		},
	},
	{
		name:   "lncd",
		grants: accountTableLNCDGrants,
		mustLose: []string{
			"basic_role public.system_users TRUNCATE", "basic_role public.system_users REFERENCES",
			"basic_role public.system_user_groups UPDATE", "basic_role public.system_functions TRIGGER",
			"basic_role public.user_names_short UPDATE", "basic_role public.notes_with_owner INSERT",
		},
		mustKeep: []string{
			"basic_role public.recent_notes INSERT", "basic_role public.notes_assets DELETE",
			"confidential_role public.system_users(enabled) SELECT", "confidential_role public.system_users(id) SELECT",
			"basic_role public.resolve_effective_row_access EXECUTE",
		},
		defaults: []accountTableCheck{
			{`SELECT has_table_privilege('confidential_role', 'public.later_items', 'INSERT')`, false},
			{`SELECT has_table_privilege('basic_role', 'public.later_items', 'INSERT')`, false},
		},
	},
}

func accountTableShapeNamed(t *testing.T, name string) accountTableShape {
	t.Helper()
	for _, shape := range accountTableShapes {
		if shape.name == name {
			return shape
		}
	}
	t.Fatalf("no shape %q", name)
	return accountTableShape{}
}

// newAccountTableDatabase creates a database with the fixture and one site's grants, runs stage 1 on it as every
// start does, and returns its administrator connection.
func newAccountTableDatabase(cluster *writeRevocationCluster, name, grants string) *sql.DB {
	cluster.t.Helper()
	cluster.exec(cluster.open("test_owner", "postgres"), "CREATE DATABASE "+name)
	owner := cluster.open("test_owner", name)
	cluster.exec(owner, accountTableFixture)
	cluster.exec(owner, grants)
	if err := EnsureGuestAndPrivilegeViewWriteRevocations(owner); err != nil {
		cluster.t.Fatalf("stage 1 on %s: %v", name, err)
	}
	return owner
}

// The fixture's account relations and sequences, written independently of the step's SQL so it can judge it.
var accountTableFixtureRelations = map[string]bool{
	"public.system_users": true, "public.system_user_groups": true, "public.system_user_group_memberships": true,
	"public.system_group_table_func_rights": true, "public.system_functions": true,
	"public.user_names": true, "public.user_names_short": true, "public.notes_with_owner": true,
}

var accountTableFixtureSequences = map[string]bool{
	"public.system_users_id_seq": true, "public.system_user_groups_id_seq": true,
	"public.system_user_group_memberships_id_seq": true, "public.system_group_table_func_rights_id_seq": true,
	"public.system_functions_id_seq": true,
}

// expectedAccountTableLoss says whether stage 2a may take one privilege-matrix entry away: a runtime role's write
// on an account relation or use of an account sequence, or any write or sequence use of the confidential role in
// schema public. Reads and function rights are never taken.
func expectedAccountTableLoss(entry string) bool {
	fields := strings.Fields(entry)
	if len(fields) != 3 {
		return false
	}
	role, relation, privilege := fields[0], fields[1], fields[2]
	if index := strings.Index(relation, "("); index >= 0 {
		relation = relation[:index]
	}
	tableWrite := privilege == "INSERT" || privilege == "UPDATE" || privilege == "DELETE" ||
		privilege == "TRUNCATE" || privilege == "REFERENCES" || privilege == "TRIGGER"
	sequenceUse := privilege == "USAGE" || privilege == "UPDATE"
	isSequence := strings.HasSuffix(relation, "_seq")
	switch {
	case privilege == "EXECUTE":
		return false
	case accountTableFixtureRelations[relation]:
		return tableWrite
	case accountTableFixtureSequences[relation]:
		return sequenceUse
	case role == "confidential_role" && strings.HasPrefix(relation, "public."):
		if isSequence {
			return sequenceUse
		}
		return tableWrite
	}
	return false
}

func requireAccountTableOutcome(t *testing.T, shape accountTableShape, before, after map[string]bool) {
	t.Helper()
	if gained := writeRevocationDifference(after, before); len(gained) > 0 {
		t.Fatalf("rights gained: %v", gained)
	}
	var want []string
	for entry := range before {
		if expectedAccountTableLoss(entry) {
			want = append(want, entry)
		}
	}
	sort.Strings(want)
	if lost := writeRevocationDifference(before, after); strings.Join(lost, "\n") != strings.Join(want, "\n") {
		t.Fatalf("rights lost:\n%s\nwant exactly:\n%s", strings.Join(lost, "\n"), strings.Join(want, "\n"))
	}
	for _, entry := range shape.mustLose {
		if !before[entry] || after[entry] {
			t.Fatalf("%q: held before = %v, after = %v; want held and then removed", entry, before[entry], after[entry])
		}
	}
	for _, entry := range shape.mustKeep {
		if !after[entry] {
			t.Fatalf("%q was not kept", entry)
		}
	}
}

func requireAccountTablePermissionDenied(t *testing.T, db *sql.DB, statement string) {
	t.Helper()
	if _, err := db.Exec(statement); err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("%s: error = %v, want permission denied", statement, err)
	}
}

func requireAccountTableStatementWorks(t *testing.T, db *sql.DB, statement string) {
	t.Helper()
	if _, err := db.Exec(statement); err != nil {
		t.Fatalf("%s: %v", statement, err)
	}
}

// requireAccountTableStatementWorksRolledBack proves a write was allowed without keeping it.
func requireAccountTableStatementWorksRolledBack(t *testing.T, db *sql.DB, statement string) {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(statement); err != nil {
		t.Fatalf("%s before the step: %v", statement, err)
	}
}

func requireAccountTableUnchanged(t *testing.T, before, after map[string]bool) {
	t.Helper()
	if lost, gained := writeRevocationDifference(before, after), writeRevocationDifference(after, before); len(lost)+len(gained) > 0 {
		t.Fatalf("rights changed: lost %v, gained %v", lost, gained)
	}
}

func accountTableACLEntries(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.Query(accountTableACLSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var entries []string
	for rows.Next() {
		var entry string
		if err := rows.Scan(&entry); err != nil {
			t.Fatal(err)
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return entries
}

func TestAccountTableWriteRevocationsPostgres(t *testing.T) {
	cluster := startWriteRevocationCluster(t)
	for _, shape := range accountTableShapes {
		t.Run(shape.name, func(t *testing.T) {
			database := shape.name + "_shape"
			owner := newAccountTableDatabase(cluster, database, shape.grants)
			basic := cluster.open("basic_role", database)
			confidential := cluster.open("confidential_role", database)
			before := writeRevocationMatrix(t, owner)

			// Before the step a signed-in user can make themselves an administrator.
			requireAccountTableStatementWorksRolledBack(t, basic,
				`INSERT INTO public.system_user_group_memberships (user_id, group_id) VALUES (3, 1)`)

			var logBuffer bytes.Buffer
			originalWriter := log.Writer()
			log.SetOutput(&logBuffer)
			err := EnsureAccountTableWriteRevocations(owner)
			log.SetOutput(originalWriter)
			if err != nil {
				t.Fatalf("first start: %v", err)
			}
			after := writeRevocationMatrix(t, owner)
			requireAccountTableOutcome(t, shape, before, after)
			if !strings.Contains(logBuffer.String(), "[ACCOUNT TABLE WRITE REVOCATIONS] removed runtime-role write grants") {
				t.Fatalf("start log = %q, want the removal counts", logBuffer.String())
			}
			if shape.name == "lncd" && !strings.Contains(logBuffer.String(), "to review: 1 SECURITY DEFINER function(s) a runtime role may call") {
				t.Fatalf("start log = %q, want the owner-rights review counts", logBuffer.String())
			}

			// A second start finds nothing to do and changes nothing.
			if err := EnsureAccountTableWriteRevocations(owner); err != nil {
				t.Fatalf("second start: %v", err)
			}
			requireAccountTableUnchanged(t, after, writeRevocationMatrix(t, owner))

			// A signed-in user still saves a view and writes a dataset that references a user: the foreign-key
			// check runs with the table owner's rights.
			requireAccountTableStatementWorks(t, basic, `INSERT INTO public.saved_views (user_id, name) VALUES (3, 'mine')`)
			requireAccountTableStatementWorks(t, basic, `INSERT INTO public.notes (owner_id, title) VALUES (3, 'a note')`)
			var username string
			if err := basic.QueryRow(`SELECT username FROM public.system_users WHERE id = 3`).Scan(&username); err != nil || username != "alice" {
				t.Fatalf("basic read of system_users = %q (%v), want alice", username, err)
			}

			// But writes nothing in the account tables, directly, through a view or by drawing an account id.
			for _, statement := range []string{
				`INSERT INTO public.system_user_group_memberships (user_id, group_id) VALUES (3, 1)`,
				`UPDATE public.system_users SET website = 'https://example.test' WHERE id = 3`,
				`DELETE FROM public.system_group_table_func_rights`,
				`INSERT INTO public.system_functions (name) VALUES ('/api/everything')`,
				`UPDATE public.system_user_groups SET name = 'owners' WHERE id = 2`,
				`INSERT INTO public.user_names_short (username) VALUES ('mallory')`,
				`SELECT nextval('public.system_users_id_seq')`,
			} {
				requireAccountTablePermissionDenied(t, basic, statement)
			}

			// The credential connection keeps its own table and its two columns, and writes nothing in public.
			for _, statement := range []string{
				`INSERT INTO restricted.users_restricted (user_id, password_hash) VALUES (3, 'first')`,
				`UPDATE restricted.users_restricted SET password_hash = 'second' WHERE user_id = 3`,
				`DELETE FROM restricted.users_restricted WHERE user_id = 3`,
			} {
				requireAccountTableStatementWorks(t, confidential, statement)
			}
			var enabled bool
			if err := confidential.QueryRow(`SELECT enabled FROM public.system_users WHERE id = 3`).Scan(&enabled); err != nil || !enabled {
				t.Fatalf("confidential read of system_users (id, enabled) = %v (%v), want true", enabled, err)
			}
			requireAccountTablePermissionDenied(t, confidential, `INSERT INTO public.notes (title) VALUES ('from the credential connection')`)

			// The administrator connection still writes the account tables.
			requireAccountTableStatementWorks(t, owner, `INSERT INTO public.system_user_group_memberships (user_id, group_id) VALUES (3, 2)`)
			requireAccountTableStatementWorks(t, owner, `UPDATE public.system_users SET website = 'https://alice.test' WHERE id = 3`)

			// Tables created later follow the default privileges without the confidential role's writes.
			requireAccountTableStatementWorks(t, owner, `CREATE TABLE public.later_items (id serial PRIMARY KEY, label text)`)
			for _, check := range shape.defaults {
				var got bool
				if err := owner.QueryRow(check.query).Scan(&got); err != nil || got != check.want {
					t.Fatalf("%s = %v (%v), want %v", check.query, got, err, check.want)
				}
			}
		})
	}
}

func TestAccountTableWriteRevocationsCoverDependentViewsPostgres(t *testing.T) {
	cluster := startWriteRevocationCluster(t)
	owner := newAccountTableDatabase(cluster, "dependent_views", accountTableLNCDGrants)
	basic := cluster.open("basic_role", "dependent_views")

	// The view over a view writes system_users with the view owner's rights.
	requireAccountTableStatementWorksRolledBack(t, basic, `INSERT INTO public.user_names_short (username) VALUES ('via two views')`)
	if err := EnsureAccountTableWriteRevocations(owner); err != nil {
		t.Fatalf("start: %v", err)
	}
	requireAccountTablePermissionDenied(t, basic, `INSERT INTO public.user_names (username) VALUES ('via a view')`)
	requireAccountTablePermissionDenied(t, basic, `INSERT INTO public.user_names_short (username) VALUES ('via two views')`)
	for _, check := range []accountTableCheck{
		{`SELECT has_table_privilege('basic_role', 'public.notes_with_owner', 'UPDATE')`, false},
		{`SELECT has_table_privilege('basic_role', 'public.notes_with_owner', 'SELECT')`, true},
		{`SELECT has_table_privilege('basic_role', 'public.user_names_short', 'SELECT')`, true},
	} {
		var got bool
		if err := owner.QueryRow(check.query).Scan(&got); err != nil || got != check.want {
			t.Fatalf("%s = %v (%v), want %v", check.query, got, err, check.want)
		}
	}
	// A view over content only keeps its writes.
	requireAccountTableStatementWorks(t, basic, `INSERT INTO public.recent_notes (title) VALUES ('through an ordinary view')`)
}

func TestAccountTableWriteRevocationsRefuseConfiguredWritersPostgres(t *testing.T) {
	cluster := startWriteRevocationCluster(t)
	for _, testCase := range []struct {
		name      string
		database  string
		setup     string
		wantError string
	}{
		{
			name:      "an automation writes the memberships",
			database:  "automation_membership",
			setup:     `INSERT INTO public.system_triggers (source_table, condition, target_table, action_values) VALUES ('notes', 'title = ''promote''', 'system_user_group_memberships', '{"user_id": "{{owner_id}}", "group_id": "1"}')`,
			wantError: "automation 2 writes system_user_group_memberships",
		},
		{
			name:      "an automation writes a view over a view over the users",
			database:  "automation_view",
			setup:     `INSERT INTO public.system_triggers (source_table, condition, target_table, action_values) VALUES ('notes', 'title = ''x''', ' user_names_short ', '{}')`,
			wantError: "automation 2 writes user_names_short",
		},
		{
			name:     "a file upload caches into the user table",
			database: "cache_target",
			setup: `INSERT INTO public.system_foreign_key_relations_1_m (source_table_uid, target_table_uid, source_column_name, target_insert_specs)
			        VALUES (2, 1, 'notes_id', '{"file_upload": {"cache_targets": [{"table": "system_users", "column": "website"}]}}')`,
			wantError: "file-upload relation 2 caches into system_users",
		},
		{
			name:      "the user table has a <parent>_assets gallery and no card picture field",
			database:  "gallery_parent",
			setup:     `CREATE TABLE public.system_users_assets (id serial PRIMARY KEY, system_users_id integer REFERENCES public.system_users (id), asset_kind text, stored_filename text, sort_order integer)`,
			wantError: "the gallery of system_users (system_users_assets) writes an account table",
		},
		{
			name:     "a gallery found by relation metadata without upload configuration",
			database: "gallery_by_relation",
			setup: `CREATE TABLE public.group_pictures (id serial PRIMARY KEY, group_id integer REFERENCES public.system_user_groups (id), asset_kind text, filename text);
			        INSERT INTO public.system_db_tables (table_name) VALUES ('group_pictures'), ('system_user_groups');
			        INSERT INTO public.system_foreign_key_relations_1_m (source_table_uid, target_table_uid, source_column_name)
			        SELECT child.table_uid, parent.table_uid, 'group_id'
			        FROM public.system_db_tables AS child, public.system_db_tables AS parent
			        WHERE child.table_name = 'group_pictures' AND parent.table_name = 'system_user_groups'`,
			wantError: "the gallery of system_user_groups (group_pictures) writes an account table",
		},
		{
			name:     "a gallery child is a view over the user table",
			database: "gallery_child_view",
			setup: `CREATE TABLE public.teams (id serial PRIMARY KEY, name text, cached_image text);
			        CREATE VIEW public.teams_assets AS
			            SELECT id, main_group_id AS teams_id, 'image'::text AS asset_kind, username AS filename FROM public.system_users`,
			wantError: "the gallery of teams (teams_assets) writes an account table",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			owner := newAccountTableDatabase(cluster, testCase.database, accountTableDockerGrants)
			cluster.exec(owner, testCase.setup)
			before := writeRevocationMatrix(t, owner)
			aclBefore := accountTableACLEntries(t, owner)

			err := EnsureAccountTableWriteRevocations(owner)
			if err == nil || !strings.Contains(err.Error(), "unsafe setup, nothing changed") || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("error = %v, want %q", err, testCase.wantError)
			}
			requireAccountTableUnchanged(t, before, writeRevocationMatrix(t, owner))
			if aclAfter := accountTableACLEntries(t, owner); strings.Join(aclAfter, "\n") != strings.Join(aclBefore, "\n") {
				t.Fatalf("a refused start changed grants")
			}
		})
	}
}

func TestAccountTableWriteRevocationsKeyShareLockNeedsUpdatePostgres(t *testing.T) {
	cluster := startWriteRevocationCluster(t)
	owner := newAccountTableDatabase(cluster, "key_share", accountTableDockerGrants)
	basic := cluster.open("basic_role", "key_share")
	lock := `SELECT id FROM public.system_users WHERE id = 3 FOR KEY SHARE`

	requireAccountTableStatementWorks(t, basic, lock)
	if err := EnsureAccountTableWriteRevocations(owner); err != nil {
		t.Fatalf("start: %v", err)
	}
	// RowsVisibleForRead's lock needs UPDATE on the locked table (plan_stage2.md §2.2 item 3, check C3, P4)...
	requireAccountTablePermissionDenied(t, basic, lock)
	// ...while the insert's own foreign-key check, run with the owner's rights, still holds the reference.
	requireAccountTableStatementWorks(t, basic, `INSERT INTO public.notes (owner_id, title) VALUES (3, 'still linked')`)
	if _, err := basic.Exec(`INSERT INTO public.notes (owner_id, title) VALUES (999, 'no such user')`); err == nil || !strings.Contains(err.Error(), "violates foreign key constraint") {
		t.Fatalf("insert referencing a missing user: error = %v, want a foreign-key violation", err)
	}
}

func TestAccountTableWriteRevocationsWithStageOneSimultaneousStartsPostgres(t *testing.T) {
	cluster := startWriteRevocationCluster(t)
	for _, database := range []string{"sequential_starts", "simultaneous_starts"} {
		cluster.exec(cluster.open("test_owner", "postgres"), "CREATE DATABASE "+database)
		cluster.exec(cluster.open("test_owner", database), accountTableFixture+accountTableLNCDGrants)
	}

	sequential := cluster.open("test_owner", "sequential_starts")
	if err := EnsureGuestAndPrivilegeViewWriteRevocations(sequential); err != nil {
		t.Fatalf("sequential stage 1: %v", err)
	}
	if err := EnsureAccountTableWriteRevocations(sequential); err != nil {
		t.Fatalf("sequential stage 2a: %v", err)
	}

	// Three instances start at once, each running stage 1 and then stage 2a as Run does.
	var wait sync.WaitGroup
	errs := make([]error, 3)
	for index := range errs {
		instance := cluster.open("test_owner", "simultaneous_starts")
		wait.Add(1)
		go func(index int, instance *sql.DB) {
			defer wait.Done()
			if err := EnsureGuestAndPrivilegeViewWriteRevocations(instance); err != nil {
				errs[index] = err
				return
			}
			errs[index] = EnsureAccountTableWriteRevocations(instance)
		}(index, instance)
	}
	wait.Wait()
	for index, err := range errs {
		if err != nil {
			t.Fatalf("instance %d: %v", index, err)
		}
	}

	simultaneous := cluster.open("test_owner", "simultaneous_starts")
	requireAccountTableUnchanged(t, writeRevocationMatrix(t, sequential), writeRevocationMatrix(t, simultaneous))
	if left, right := accountTableACLEntries(t, sequential), accountTableACLEntries(t, simultaneous); strings.Join(left, "\n") != strings.Join(right, "\n") {
		t.Fatalf("simultaneous starts left other grants than one start:\n%s\nwant:\n%s", strings.Join(right, "\n"), strings.Join(left, "\n"))
	}
}

func TestAccountTableWriteRevocationsChangeNothingWhenUnsafePostgres(t *testing.T) {
	cluster := startWriteRevocationCluster(t)
	administrator := cluster.open("test_owner", "postgres")
	for _, testCase := range []struct {
		name      string
		database  string
		setup     string
		undo      string
		wantError string
	}{
		{
			name:      "a runtime role inherits through membership",
			database:  "unsafe_membership",
			setup:     `GRANT readonly_role TO basic_role`,
			undo:      `REVOKE readonly_role FROM basic_role`,
			wantError: "role inherits rights as a member of another role: basic",
		},
		{
			name:      "the confidential role is a superuser",
			database:  "unsafe_superuser",
			setup:     `ALTER ROLE confidential_role SUPERUSER`,
			undo:      `ALTER ROLE confidential_role NOSUPERUSER`,
			wantError: "role is a superuser: confidential",
		},
		{
			name:      "a runtime role owns an account table",
			database:  "unsafe_owner",
			setup:     `ALTER TABLE public.system_functions OWNER TO basic_role`,
			wantError: "a runtime role owns an account table, a view over one or an account sequence: basic",
		},
		{
			name:      "the confidential role owns a public relation",
			database:  "unsafe_confidential_owner",
			setup:     `ALTER TABLE public.saved_views OWNER TO confidential_role`,
			wantError: "the confidential role owns 2 relation(s) in schema public",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			owner := newAccountTableDatabase(cluster, testCase.database, accountTableSerlogGrants)
			cluster.exec(owner, testCase.setup)
			if testCase.undo != "" {
				t.Cleanup(func() { _, _ = administrator.Exec(testCase.undo) })
			}
			before := writeRevocationMatrix(t, owner)

			err := EnsureAccountTableWriteRevocations(owner)
			if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("error = %v, want %q", err, testCase.wantError)
			}
			requireAccountTableUnchanged(t, before, writeRevocationMatrix(t, owner))
		})
	}
}

// accountTableRestoreScript is what the dry run saves as a site's recovery script.
func accountTableRestoreScript(t *testing.T, owner *sql.DB, mainRole string) []string {
	t.Helper()
	rows, err := owner.Query(accountTableWriteRestoreSQL,
		"guest_role", "basic_role", "readonly_role", "confidential_role", "test_owner", mainRole)
	if err != nil {
		t.Fatalf("restore script: %v", err)
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, line)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return lines
}

// accountTableRecoveryGrants adds what a recovery must give back exactly as it was: a grant option on a table
// grant and on default privileges, and default privileges created by a role outside the configured ones (with
// accountTableLNCDGrants, whose other grantor is outside them too when no main role is named).
const accountTableRecoveryGrants = `
GRANT DELETE ON public.system_functions TO basic_role WITH GRANT OPTION;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT ON TABLES TO confidential_role WITH GRANT OPTION;
ALTER DEFAULT PRIVILEGES FOR ROLE granting_editor IN SCHEMA public GRANT UPDATE ON TABLES TO confidential_role WITH GRANT OPTION;
ALTER DEFAULT PRIVILEGES FOR ROLE granting_editor GRANT USAGE ON SEQUENCES TO confidential_role;
`

// runAccountTableRestoreScript runs a saved recovery script as the operator does: with psql, its role variables
// given with -v, stopping at the first error.
func runAccountTableRestoreScript(t *testing.T, cluster *writeRevocationCluster, database string, lines []string, mainRole string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "recovery.sql")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	output, err := exec.Command("/usr/lib/postgresql/16/bin/psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
		"-v", "guest_role=guest_role", "-v", "basic_role=basic_role", "-v", "readonly_role=readonly_role",
		"-v", "confidential_role=confidential_role", "-v", "admin_role=test_owner", "-v", "main_role="+mainRole,
		"-h", cluster.socket, "-p", strconv.Itoa(cluster.port), "-U", "test_owner", "-d", database, "-f", path,
	).CombinedOutput()
	if err != nil {
		t.Fatalf("psql -f recovery.sql: %v\n%s", err, output)
	}
}

func TestAccountTableWriteRevocationsInverseGrantRoundTripPostgres(t *testing.T) {
	cluster := startWriteRevocationCluster(t)
	for _, testCase := range []struct {
		name      string
		shape     string
		extra     string
		mainRole  string
		wantLines []string
	}{
		{name: "docker", shape: "docker", wantLines: []string{
			`^ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_role" IN SCHEMA public GRANT INSERT ON TABLES TO :"confidential_role";$`}},
		{name: "serlog", shape: "serlog", wantLines: []string{
			`^ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_role" GRANT DELETE ON TABLES TO :"confidential_role";$`}},
		{name: "lncd", shape: "lncd", mainRole: "granting_editor", wantLines: []string{
			`^SET ROLE :"main_role"; GRANT UPDATE ON TABLE public\.system_user_groups TO :"basic_role"; RESET ROLE;$`}},
		{name: "grant options and roles outside the configured ones", shape: "lncd", extra: accountTableRecoveryGrants, wantLines: []string{
			`^SELECT rolname AS role_\d+ FROM pg_catalog\.pg_roles WHERE oid = \d+ \\gset$`,
			`^SET ROLE :"role_\d+"; GRANT UPDATE ON TABLE public\.system_user_groups TO :"basic_role"; RESET ROLE;$`,
			`^GRANT DELETE ON TABLE public\.system_functions TO :"basic_role" WITH GRANT OPTION;$`,
			`^ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_role" IN SCHEMA public GRANT INSERT ON TABLES TO :"confidential_role" WITH GRANT OPTION;$`,
			`^ALTER DEFAULT PRIVILEGES FOR ROLE :"role_\d+" IN SCHEMA public GRANT UPDATE ON TABLES TO :"confidential_role" WITH GRANT OPTION;$`,
			`^ALTER DEFAULT PRIVILEGES FOR ROLE :"role_\d+" GRANT USAGE ON SEQUENCES TO :"confidential_role";$`,
		}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			database := "restore_" + strings.ReplaceAll(testCase.name, " ", "_")
			owner := newAccountTableDatabase(cluster, database, accountTableShapeNamed(t, testCase.shape).grants+testCase.extra)
			aclBefore := accountTableACLEntries(t, owner)
			script := accountTableRestoreScript(t, owner, testCase.mainRole)

			joined := strings.Join(script, "\n")
			for _, want := range testCase.wantLines {
				if !regexp.MustCompile(`(?m)` + want).MatchString(joined) {
					t.Fatalf("restore script lacks a line matching %s:\n%s", want, joined)
				}
			}
			// Every grant is restored by a statement, never left as a comment, and no role is named.
			if strings.Contains(joined, "--") || strings.Contains(joined, "test_owner") || strings.Contains(joined, "granting_editor") {
				t.Fatalf("restore script names a role or leaves a grant to restore by hand:\n%s", joined)
			}

			if err := EnsureAccountTableWriteRevocations(owner); err != nil {
				t.Fatalf("start: %v", err)
			}
			if aclMiddle := accountTableACLEntries(t, owner); strings.Join(aclMiddle, "\n") == strings.Join(aclBefore, "\n") {
				t.Fatalf("the step removed nothing, so the round trip proves nothing")
			}

			runAccountTableRestoreScript(t, cluster, database, script, testCase.mainRole)
			if aclAfter := accountTableACLEntries(t, owner); strings.Join(aclAfter, "\n") != strings.Join(aclBefore, "\n") {
				t.Fatalf("restored grants differ:\n%s\nwant:\n%s", strings.Join(aclAfter, "\n"), strings.Join(aclBefore, "\n"))
			}
		})
	}
}

func TestAccountTableWriteTargetPostgres(t *testing.T) {
	cluster := startWriteRevocationCluster(t)
	owner := newAccountTableDatabase(cluster, "write_target", accountTableLNCDGrants)
	basic := cluster.open("basic_role", "write_target")
	for _, connection := range []*sql.DB{owner, basic} {
		for name, want := range map[string]bool{
			"system_users": true, "system_group_table_func_rights": true, " user_names_short ": true,
			"notes_with_owner": true, "notes": false, "recent_notes": false, "saved_views": false,
			"no_such_table": false, "": false,
		} {
			got, err := AccountTableWriteTarget(connection, name)
			if err != nil || got != want {
				t.Fatalf("AccountTableWriteTarget(%q) = %v (%v), want %v", name, got, err, want)
			}
		}
	}
}
