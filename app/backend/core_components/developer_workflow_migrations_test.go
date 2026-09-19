// developer_workflow_migrations_test.go
// Verifies the public developer-ticket and workline migrations in PostgreSQL.
// Bridges the reviewed public base schema with the commands' database contract.
// Exists so an empty standalone installation cannot silently depend on private migrations.
package backend

import (
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	_ "github.com/lib/pq"
)

var developerWorkflowBaseSchemaFiles = []string{
	"base.schema.sql",
	"runtime.schema.sql",
	"db_9_7_0.schema.sql",
	"app_tables.schema.sql",
	"column_supported_views.schema.sql",
	"media_assets.schema.sql",
}

var developerWorkflowMigrationFiles = []string{
	"20260919000007_create_developer_ticket_schema.sql",
	"20260919000008_create_developer_workline_schema.sql",
	"20260919000009_seed_developer_workflow_metadata.sql",
	"20260919000010_record_developer_workflow_schema_release.sql",
}

var developerWorkflowTables = []string{
	"dev_agent_handover_report_items",
	"dev_agent_handover_reports",
	"dev_agent_release_goal_contracts",
	"dev_agent_release_goals",
	"dev_agent_task_group_relations",
	"dev_agent_task_groups",
	"dev_agent_task_queues",
	"dev_agent_task_runs",
	"dev_agent_task_statuses",
	"dev_agent_task_todo_statuses",
	"dev_agent_task_todos",
	"dev_agent_tasks",
	"dev_agent_tasks_assets",
	"dev_agent_workline_reports",
	"dev_agent_workline_tasks",
	"dev_agent_worklines",
}

var dbTaskSelectedColumns = []string{
	"assigned_to",
	"content",
	"created",
	"id",
	"issue_type",
	"parent_id",
	"priority",
	"queue_id",
	"status",
	"tags",
	"title",
	"updated",
}

func developerWorkflowDisposableDB(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 to run isolated PostgreSQL verification")
	}
	postgresBin := os.Getenv("PG_TEST_BIN")
	if postgresBin == "" {
		postgresBin = "/usr/lib/postgresql/16/bin"
	}
	if _, err := os.Stat(filepath.Join(postgresBin, "initdb")); err != nil {
		t.Skipf("PostgreSQL test binaries unavailable: %v", err)
	}

	root := t.TempDir()
	socket := filepath.Join(root, "socket")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "db")
	run := func(name string, args ...string) {
		t.Helper()
		command := exec.Command(filepath.Join(postgresBin, name), args...)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, output)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		_, _ = exec.Command(filepath.Join(postgresBin, "pg_ctl"), "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"),
		"-o", "-h '' -k '"+socket+"' -p 15469", "-w", "start")

	database, err := sql.Open("postgres",
		fmt.Sprintf("host=%s port=15469 user=test_owner dbname=postgres sslmode=disable", socket))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func applyDeveloperWorkflowSQLFile(t *testing.T, database *sql.DB, path string) {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(string(contents)); err != nil {
		t.Fatalf("apply %s: %v", filepath.Base(path), err)
	}
}

func TestPublicDeveloperWorkflowMigrationsCreateCommandSchemaPostgres(t *testing.T) {
	database := developerWorkflowDisposableDB(t)
	publicBootstrapSource := filepath.Join("..", "..", "server_tools", "public_bootstrap", "source")
	publicMigrations := filepath.Join("..", "..", "server_tools", "migrations")

	for _, filename := range developerWorkflowBaseSchemaFiles {
		applyDeveloperWorkflowSQLFile(t, database, filepath.Join(publicBootstrapSource, filename))
	}
	for _, filename := range developerWorkflowMigrationFiles {
		applyDeveloperWorkflowSQLFile(t, database, filepath.Join(publicMigrations, filename))
	}

	var freshInstallationRows int
	if err := database.QueryRow(`SELECT
		(SELECT count(*) FROM dev_agent_tasks)
		+ (SELECT count(*) FROM dev_agent_task_queues)
		+ (SELECT count(*) FROM dev_agent_worklines)
		+ (SELECT count(*) FROM dev_agent_workline_reports)
		+ (SELECT count(*) FROM dev_agent_handover_reports)`).Scan(&freshInstallationRows); err != nil {
		t.Fatal(err)
	}
	if freshInstallationRows != 0 {
		t.Fatalf("public migration imported %d installation-owned workflow rows", freshInstallationRows)
	}

	// Synthetic installation rows placed between migration passes prove that an
	// existing checkout keeps its ticket and workline history on upgrade.
	if _, err := database.Exec(`
		INSERT INTO dev_agent_tasks (title, status, content)
		VALUES ('Synthetic preservation proof', 'new', 'Not installation data');
		INSERT INTO dev_agent_worklines (title)
		VALUES ('Synthetic preservation proof');`); err != nil {
		t.Fatal(err)
	}
	for _, filename := range developerWorkflowMigrationFiles {
		applyDeveloperWorkflowSQLFile(t, database, filepath.Join(publicMigrations, filename))
	}
	var preservedRows int
	if err := database.QueryRow(`SELECT
		(SELECT count(*) FROM dev_agent_tasks WHERE title = 'Synthetic preservation proof')
		+ (SELECT count(*) FROM dev_agent_worklines WHERE title = 'Synthetic preservation proof')`).Scan(&preservedRows); err != nil {
		t.Fatal(err)
	}
	if preservedRows != 2 {
		t.Fatalf("migration replay preserved %d synthetic installation rows, want 2", preservedRows)
	}
	if _, err := database.Exec(`
		DELETE FROM dev_agent_tasks WHERE title = 'Synthetic preservation proof';
		DELETE FROM dev_agent_worklines WHERE title = 'Synthetic preservation proof';`); err != nil {
		t.Fatal(err)
	}

	rows, err := database.Query(`
		SELECT tables.relname
		FROM pg_catalog.pg_class AS tables
		JOIN pg_catalog.pg_namespace AS schemas ON schemas.oid = tables.relnamespace
		WHERE schemas.nspname = 'public'
		  AND tables.relkind = 'r'
		  AND tables.relname LIKE 'dev_agent_%'
		ORDER BY tables.relname`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var tableNames []string
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err != nil {
			t.Fatal(err)
		}
		tableNames = append(tableNames, tableName)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if strings.Join(tableNames, "\n") != strings.Join(developerWorkflowTables, "\n") {
		t.Fatalf("developer workflow tables = %v, want %v", tableNames, developerWorkflowTables)
	}

	columnRows, err := database.Query(`
		SELECT attributes.attname
		FROM pg_catalog.pg_attribute AS attributes
		WHERE attributes.attrelid = 'public.dev_agent_tasks'::regclass
		  AND attributes.attnum > 0
		  AND NOT attributes.attisdropped`)
	if err != nil {
		t.Fatal(err)
	}
	defer columnRows.Close()
	var taskColumns []string
	for columnRows.Next() {
		var columnName string
		if err := columnRows.Scan(&columnName); err != nil {
			t.Fatal(err)
		}
		taskColumns = append(taskColumns, columnName)
	}
	if err := columnRows.Err(); err != nil {
		t.Fatal(err)
	}
	sort.Strings(taskColumns)
	for _, requiredColumn := range dbTaskSelectedColumns {
		index := sort.SearchStrings(taskColumns, requiredColumn)
		if index == len(taskColumns) || taskColumns[index] != requiredColumn {
			t.Errorf("dev_agent_tasks is missing db_task column %q", requiredColumn)
		}
	}
	dbTaskRows, err := database.Query(`
		SELECT t.id, t.title, t.issue_type, t.status,
		       t.created AS created_at, t.updated AS updated_at,
		       t.content, t.priority, t.tags, t.parent_id, t.assigned_to,
		       t.queue_id, q.slug AS queue_slug, q.title AS queue_title
		FROM dev_agent_tasks AS t
		LEFT JOIN dev_agent_task_queues AS q ON q.id = t.queue_id
		WHERE FALSE`)
	if err != nil {
		t.Fatalf("db_task list query does not match the public schema: %v", err)
	}
	dbTaskRows.Close()

	var statusCount, todoStatusCount, groupCount int
	if err := database.QueryRow(`SELECT
		(SELECT count(*) FROM dev_agent_task_statuses),
		(SELECT count(*) FROM dev_agent_task_todo_statuses),
		(SELECT count(*) FROM dev_agent_task_groups)`).Scan(
		&statusCount, &todoStatusCount, &groupCount,
	); err != nil {
		t.Fatal(err)
	}
	if statusCount != 12 || todoStatusCount != 5 || groupCount != 7 {
		t.Fatalf("product vocabularies = statuses %d, todo statuses %d, groups %d", statusCount, todoStatusCount, groupCount)
	}

	var installationRows, metadataTables, releaseRows int
	if err := database.QueryRow(`SELECT
		(SELECT count(*) FROM dev_agent_tasks)
		+ (SELECT count(*) FROM dev_agent_task_queues)
		+ (SELECT count(*) FROM dev_agent_worklines)
		+ (SELECT count(*) FROM dev_agent_workline_reports)
		+ (SELECT count(*) FROM dev_agent_handover_reports),
		(SELECT count(*) FROM system_db_tables WHERE table_name LIKE 'dev_agent_%'),
		(SELECT count(*) FROM system_db_version WHERE version = '9.8.0')`).Scan(
		&installationRows, &metadataTables, &releaseRows,
	); err != nil {
		t.Fatal(err)
	}
	if installationRows != 0 {
		t.Fatalf("public migration imported %d installation-owned workflow rows", installationRows)
	}
	if metadataTables != len(developerWorkflowTables) {
		t.Fatalf("registered developer workflow tables = %d, want %d", metadataTables, len(developerWorkflowTables))
	}
	if releaseRows != 1 {
		t.Fatalf("DB 9.8.0 history rows = %d, want 1", releaseRows)
	}
}
