// row_policy_owner_resolver_postgres_test.go
// Proves the row-owner rule on a disposable PostgreSQL, read as a role that owns no table.
// Bridges the system-catalog foreign-key check with the results, row-count and filter-option reads.
// Exists because information_schema hides foreign keys from non-owners, and to show that removing
// the id guess changes only what it should for system_about, system_users and app_service_catalog.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/lib/pq"
)

const ownerResolverReaderRole = "wl58_reader"

const ownerResolverFixture = `
CREATE TABLE system_users (
    id integer PRIMARY KEY,
    username text NOT NULL UNIQUE,
    enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE system_db_tables (
    table_uid bigint PRIMARY KEY,
    table_name text NOT NULL UNIQUE,
    schema_name text NOT NULL DEFAULT 'public',
    row_policy_owner_column text
);
CREATE TABLE system_column_details (
    table_uid bigint NOT NULL,
    column_name text NOT NULL,
    must_be_true_unless_own boolean NOT NULL DEFAULT false
);
CREATE TABLE system_permission_actions (
    id bigint PRIMARY KEY,
    action_key text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    scope_type text NOT NULL DEFAULT 'row'
);
CREATE TABLE system_row_access_rules (
    table_uid bigint, action_id bigint, row_id bigint, user_id bigint, group_id bigint, effect text,
    valid_from timestamptz NOT NULL DEFAULT now(), valid_until timestamptz
);
CREATE TABLE system_user_group_memberships (user_id bigint, group_id bigint);
INSERT INTO system_permission_actions (id, action_key) VALUES (1, 'read'), (2, 'update'), (3, 'delete');

-- The three datasets that relied on the resolver, shaped like the local
-- development database: system_about has neither created_by nor user_id, and
-- the pilot's user_id has no foreign key and one row points at a missing user.
CREATE TABLE system_about (id integer PRIMARY KEY, title text NOT NULL, admin_approved boolean NOT NULL DEFAULT false);
CREATE TABLE app_service_catalog (
    id integer PRIMARY KEY, title text NOT NULL, user_id integer,
    published boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT false
);

-- Owner-check fixtures, one per way a named column can fail to prove ownership.
CREATE TABLE owned_notes (id integer PRIMARY KEY, title text, created_by integer REFERENCES system_users(id), published boolean NOT NULL DEFAULT false);
CREATE TABLE unvalidated_notes (id integer PRIMARY KEY, title text, owner_id integer, published boolean NOT NULL DEFAULT false);
ALTER TABLE unvalidated_notes ADD CONSTRAINT unvalidated_notes_owner_fk FOREIGN KEY (owner_id) REFERENCES system_users(id) NOT VALID;
CREATE TABLE plain_notes (id integer PRIMARY KEY, title text, user_id integer, published boolean NOT NULL DEFAULT false);
CREATE TABLE username_notes (id integer PRIMARY KEY, title text, author text REFERENCES system_users(username), published boolean NOT NULL DEFAULT false);
CREATE TABLE user_profiles (id integer PRIMARY KEY REFERENCES system_users(id), title text, published boolean NOT NULL DEFAULT false);
CREATE TABLE unnamed_notes (
    id integer PRIMARY KEY, title text,
    created_by integer REFERENCES system_users(id), user_id integer REFERENCES system_users(id),
    published boolean NOT NULL DEFAULT false
);

INSERT INTO system_db_tables (table_uid, table_name, row_policy_owner_column) VALUES
    (1, 'system_users', NULL),
    (2, 'system_about', NULL),
    (3, 'app_service_catalog', 'user_id'),
    (10, 'owned_notes', 'created_by'),
    (11, 'unvalidated_notes', 'owner_id'),
    (12, 'plain_notes', 'user_id'),
    (13, 'username_notes', 'author'),
    (14, 'user_profiles', 'id'),
    (15, 'unnamed_notes', NULL);
INSERT INTO system_column_details (table_uid, column_name, must_be_true_unless_own) VALUES
    (1, 'enabled', true), (1, 'username', false),
    (2, 'admin_approved', true), (2, 'title', false),
    (3, 'published', true), (3, 'enabled', true),
    (10, 'published', true), (11, 'published', true), (12, 'published', true),
    (13, 'published', true), (14, 'published', true), (15, 'published', true);

-- User numbers deliberately equal system_about row numbers, and user 40 is
-- disabled, so the old id guess and the users' self-ownership both show.
INSERT INTO system_users (id, username, enabled) VALUES
    (1, 'guest', true), (2, 'admin', true), (4, 'alice', true), (12, 'bob', true), (40, 'carol', false);
INSERT INTO system_about (id, title, admin_approved) VALUES
    (1, 'About', true), (4, 'Team', true), (12, 'History', true), (40, 'Draft roadmap', false), (41, 'Draft pricing', false);
INSERT INTO app_service_catalog (id, title, user_id, published, enabled) VALUES
    (1, 'Alpha', 4, true, true), (2, 'Beta', 4, false, true), (3, 'Gamma', 12, true, false),
    (40, 'Delta', 40, false, false), (169, 'Dangling', 42, true, true);
INSERT INTO owned_notes (id, title, created_by, published) VALUES
    (1, 'Public', 4, true), (2, 'Alice draft', 4, false), (3, 'Bob draft', 12, false);
`

// ownerResolverPostgres starts a disposable cluster, loads the fixture as the
// owning superuser, and returns that connection plus one for a login role that,
// like the guest and basic runtime roles, may SELECT but owns no table.
func ownerResolverPostgres(t *testing.T) (*sql.DB, *sql.DB) {
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
		db, err := sql.Open("postgres",
			fmt.Sprintf("host=%s port=%d user=%s dbname=postgres sslmode=disable", socket, port, user))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = db.Close() })
		return db
	}

	owner := open("test_owner")
	if _, err := owner.Exec(ownerResolverFixture); err != nil {
		t.Fatalf("load fixture: %v", err)
	}

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
		"CREATE ROLE " + ownerResolverReaderRole + " LOGIN NOSUPERUSER",
		"GRANT USAGE ON SCHEMA public TO " + ownerResolverReaderRole,
		"GRANT SELECT ON ALL TABLES IN SCHEMA public TO " + ownerResolverReaderRole,
	} {
		if _, err := owner.Exec(statement); err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}
	return owner, open(ownerResolverReaderRole)
}

func TestRowOwnerForeignKeyCheckWorksForARoleThatOwnsNoTablePostgres(t *testing.T) {
	owner, reader := ownerResolverPostgres(t)

	// The premise: information_schema names the referenced column of a foreign
	// key only to the owner of the table, so a check built on it would refuse
	// every owner on the guest and basic connections.
	const referencedColumns = `
		SELECT count(*) FROM information_schema.constraint_column_usage
		WHERE table_schema = 'public' AND table_name = 'system_users' AND column_name = 'id'
		  AND constraint_name IN (
		      SELECT conname FROM pg_catalog.pg_constraint WHERE conrelid = 'public.owned_notes'::regclass
		  )`
	var seenByOwner, seenByReader int
	if err := owner.QueryRow(referencedColumns).Scan(&seenByOwner); err != nil {
		t.Fatal(err)
	}
	if err := reader.QueryRow(referencedColumns).Scan(&seenByReader); err != nil {
		t.Fatal(err)
	}
	if seenByOwner != 1 || seenByReader != 0 {
		t.Fatalf("information_schema showed the owned_notes foreign key to owner %d / reader %d times, want 1 / 0", seenByOwner, seenByReader)
	}

	warnings := captureOwnerWarnings(t)
	want := map[string]string{
		"owned_notes":         "created_by", // named, validated foreign key to system_users(id)
		"user_profiles":       "id",         // id is accepted only because it is named and is such a foreign key
		"unvalidated_notes":   "",           // NOT VALID constraint: existing rows are unchecked
		"plain_notes":         "",           // named column without any foreign key
		"username_notes":      "",           // foreign key to system_users, but not to its id
		"unnamed_notes":       "",           // perfect candidates exist, but nothing is guessed
		"system_about":        "",           // no owner named: approved rows only
		"system_users":        "id",         // the only table that owns itself
		"app_service_catalog": "user_id",    // pilot keeps its enforced owner without a foreign key
	}
	for tableName, wantOwner := range want {
		for connectionName, db := range map[string]*sql.DB{"reader": reader, "owner": owner} {
			got, err := resolveRowPolicyOwnerColumn(db, tableName)
			if err != nil {
				t.Fatalf("%s as %s: %v", tableName, connectionName, err)
			}
			if got != wantOwner {
				t.Fatalf("%s as %s: owner = %q, want %q", tableName, connectionName, got, wantOwner)
			}
		}
	}
	for _, refused := range []string{"unvalidated_notes", "plain_notes", "username_notes", "unnamed_notes"} {
		if !strings.Contains(warnings.String(), "dataset "+refused+" has no proven row owner") {
			t.Fatalf("no administrator warning for %s; log was %q", refused, warnings.String())
		}
	}

	// The accepted owner reaches the read path: Alice sees her own draft, not Bob's.
	policy, err := getLegacyMustTrueReadPolicy(reader, "owned_notes")
	if err != nil {
		t.Fatal(err)
	}
	if got := ownerResolverVisibleIDs(t, reader, "owned_notes", "basic", 4, policy); !reflect.DeepEqual(got, []int{1, 2}) {
		t.Fatalf("alice sees owned_notes %v, want [1 2]", got)
	}
}

// readPolicyBeforeWL58 rebuilds the policy the removed resolver produced: the
// named column when it existed, otherwise created_by, user_id, then id. It is
// a frozen copy kept only so the comparison below can show what the old rule
// allowed; nothing outside this test may use it.
func readPolicyBeforeWL58(t *testing.T, db *sql.DB, tableName string) ReadRowPolicy {
	t.Helper()
	if tableName == rlsPilotTableName {
		return ReadRowPolicy{}
	}
	flags, _, err := getMustBeTrueColumnsWithOwner(db, tableName)
	if err != nil {
		t.Fatal(err)
	}
	if len(flags) == 0 {
		return ReadRowPolicy{}
	}
	explicit, err := fetchExplicitRowPolicyOwnerColumn(db, tableName)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, tableName)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	columns := map[string]bool{}
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			t.Fatal(err)
		}
		columns[column] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if explicit != "" && columns[explicit] {
		return legacyMustTrueReadPolicy(flags, explicit)
	}
	for _, candidate := range []string{"created_by", "user_id", "id"} {
		if columns[candidate] {
			return legacyMustTrueReadPolicy(flags, candidate)
		}
	}
	return legacyMustTrueReadPolicy(flags, "")
}

// ownerResolverVisibleIDs lists rows the way the results listing filters them:
// BuildSelectQuery adds the read policy through appendReadPolicyToWhereClause.
func ownerResolverVisibleIDs(t *testing.T, db *sql.DB, tableName, userRole string, userID int, policy ReadRowPolicy) []int {
	t.Helper()
	whereClause, args := appendReadPolicyToWhereClause(tableName, userRole, userID, policy, "", nil)
	quotedTable := pq.QuoteIdentifier(tableName)
	return ownerResolverQueryIDs(t, db, fmt.Sprintf(`SELECT %s."id" FROM %s%s`, quotedTable, quotedTable, whereClause), args)
}

// ownerResolverFilterOptionIDs lists rows the way GetFilterOptionsHandler does:
// distinct value and display pairs, then the same read policy.
func ownerResolverFilterOptionIDs(t *testing.T, db *sql.DB, tableName, displayColumn, userRole string, userID int, policy ReadRowPolicy) []int {
	t.Helper()
	whereClause := fmt.Sprintf(" WHERE %s IS NOT NULL AND %s IS NOT NULL", pq.QuoteIdentifier("id"), pq.QuoteIdentifier(displayColumn))
	whereClause, args := appendReadPolicyToWhereClause(tableName, userRole, userID, policy, whereClause, nil)
	query := fmt.Sprintf("SELECT DISTINCT %s, %s FROM %s%s",
		pq.QuoteIdentifier("id"), pq.QuoteIdentifier(displayColumn), pq.QuoteIdentifier(tableName), whereClause)
	return ownerResolverQueryIDs(t, db, "SELECT id FROM ("+query+") AS options", args)
}

func ownerResolverQueryIDs(t *testing.T, db *sql.DB, query string, args []interface{}) []int {
	t.Helper()
	rows, err := db.Query(query, args...)
	if err != nil {
		t.Fatalf("%v\n%s", err, query)
	}
	defer rows.Close()
	ids := []int{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	sort.Ints(ids)
	return ids
}

func ownerResolverIDsMissingFrom(ids, reference []int) []int {
	present := map[int]bool{}
	for _, id := range reference {
		present[id] = true
	}
	missing := []int{}
	for _, id := range ids {
		if !present[id] {
			missing = append(missing, id)
		}
	}
	return missing
}

// TestRemovingTheIDGuessChangesOnlyIntendedRowsPostgres compares the removed
// rule with the new one for every actor on the three read paths. Non-admins
// may only lose rows; the only row lost is the unapproved system_about row
// whose number equals the disabled user carol's number.
func TestRemovingTheIDGuessChangesOnlyIntendedRowsPostgres(t *testing.T) {
	owner, reader := ownerResolverPostgres(t)
	captureOwnerWarnings(t)

	actors := []struct {
		name     string
		userRole string
		userID   int
	}{
		{"guest", "guest", 1},
		{"alice", "basic", 4},
		{"bob", "basic", 12},
		{"carol", "basic", 40},
		{"admin", "admin", 2},
	}
	datasets := []struct {
		tableName     string
		displayColumn string
	}{
		{"system_about", "title"},
		{"system_users", "username"},
		{"app_service_catalog", "title"},
	}

	lostRows := map[string][]int{}
	for _, dataset := range datasets {
		before := readPolicyBeforeWL58(t, owner, dataset.tableName)
		after, err := getLegacyMustTrueReadPolicy(reader, dataset.tableName)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%s: owner before %q, after %q", dataset.tableName, before.OwnerColumn, after.OwnerColumn)

		for _, actor := range actors {
			label := dataset.tableName + "/" + actor.name
			oldResults := ownerResolverVisibleIDs(t, reader, dataset.tableName, actor.userRole, actor.userID, before)
			newResults := ownerResolverVisibleIDs(t, reader, dataset.tableName, actor.userRole, actor.userID, after)
			oldOptions := ownerResolverFilterOptionIDs(t, reader, dataset.tableName, dataset.displayColumn, actor.userRole, actor.userID, before)
			newOptions := ownerResolverFilterOptionIDs(t, reader, dataset.tableName, dataset.displayColumn, actor.userRole, actor.userID, after)
			oldCount, err := getRowCountWithReadPolicy(reader, dataset.tableName, actor.userRole, actor.userID, before)
			if err != nil {
				t.Fatal(err)
			}
			newCount, err := getACLFilteredRowCount(reader, reader, dataset.tableName, actor.userRole, actor.userID)
			if err != nil {
				t.Fatal(err)
			}

			if gained := ownerResolverIDsMissingFrom(newResults, oldResults); len(gained) > 0 {
				t.Fatalf("%s gained rows %v (before %v, after %v)", label, gained, oldResults, newResults)
			}
			if !reflect.DeepEqual(oldOptions, oldResults) || !reflect.DeepEqual(newOptions, newResults) {
				t.Fatalf("%s filter options before %v / after %v disagree with results before %v / after %v", label, oldOptions, newOptions, oldResults, newResults)
			}
			if oldCount != len(oldResults) || newCount != len(newResults) {
				t.Fatalf("%s row count before %d / after %d disagrees with results before %v / after %v", label, oldCount, newCount, oldResults, newResults)
			}
			if lost := ownerResolverIDsMissingFrom(oldResults, newResults); len(lost) > 0 {
				lostRows[label] = lost
			}
			t.Logf("%s: before %v, after %v", label, oldResults, newResults)
		}
	}

	if want := map[string][]int{"system_about/carol": {40}}; !reflect.DeepEqual(lostRows, want) {
		t.Fatalf("rows lost by removing the id guess = %v, want only %v", lostRows, want)
	}
	for _, actor := range actors[:4] {
		policy, err := getLegacyMustTrueReadPolicy(reader, "system_about")
		if err != nil {
			t.Fatal(err)
		}
		if got := ownerResolverVisibleIDs(t, reader, "system_about", actor.userRole, actor.userID, policy); !reflect.DeepEqual(got, []int{1, 4, 12}) {
			t.Fatalf("system_about/%s sees %v, want only the approved rows [1 4 12]", actor.name, got)
		}
	}

	// The browser's copy follows the same owners: none for system_about, the
	// user row itself for system_users, and the pilot's user_id.
	hideUnlessOwn := map[string]interface{}{"title": buildColumnDescription(map[string]interface{}{"hide_on_bg_crd_if_not_own": true})}
	for tableName, wantOwner := range map[string]string{"system_about": "", "system_users": "id", "app_service_catalog": "user_id"} {
		policy, err := getLegacyMustTrueReadPolicy(reader, tableName)
		if err != nil {
			t.Fatal(err)
		}
		got, err := resolveResultsRowOwnerColumn(reader, tableName, policy, hideUnlessOwn)
		if err != nil || got != wantOwner {
			t.Fatalf("%s article owner = (%q, %v), want %q", tableName, got, err, wantOwner)
		}
	}
}
