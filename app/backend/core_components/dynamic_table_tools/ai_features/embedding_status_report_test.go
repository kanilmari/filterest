// embedding_status_report_test.go
// Verifies the per-dataset embedding status against a real PostgreSQL with pgvector.
// Bridges the status report with stored vectors, language embeddings, the refresh queue and field consent.
// Exists because the admin page gave no way to see which datasets were embedded, how fully, or by which model.
package ai_features

import (
	"database/sql"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	_ "github.com/lib/pq"
)

// embeddingStatusDB starts a disposable PostgreSQL holding the metadata the
// report reads and four datasets:
//   - catalog: general and language embeddings, sending enabled, one approved field;
//   - notes: a general embedding only, sending disabled;
//   - plain: in the current project, never embedded;
//   - elsewhere: outside the current project, never embedded.
func embeddingStatusDB(t *testing.T) *sql.DB {
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

	db, err := sql.Open("postgres",
		fmt.Sprintf("host=%s port=%d user=test_owner dbname=postgres sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if _, err := db.Exec(`
        CREATE EXTENSION vector;
        CREATE TABLE system_table_folders (id integer PRIMARY KEY, parent_id integer, is_current_project boolean);
        INSERT INTO system_table_folders VALUES (1, NULL, true), (2, 1, false), (3, NULL, false);
        CREATE TABLE system_db_tables (
            table_uid integer PRIMARY KEY, table_name text, schema_name text, folder_id integer,
            multi_lang_embeddings boolean, external_embedding_enabled boolean,
            external_embedding_policy_configured boolean);
        INSERT INTO system_db_tables VALUES
            (10, 'catalog',   'public', 2, true,  true,  true),
            (11, 'notes',     'public', 3, false, false, false),
            (12, 'plain',     'public', 1, false, false, false),
            (13, 'elsewhere', 'public', 3, false, false, false);
        CREATE TABLE system_column_details (
            column_uid integer PRIMARY KEY, table_uid integer, column_name text,
            is_multilingual boolean, external_embedding_allowed boolean);
        INSERT INTO system_column_details VALUES
            (100, 10, 'header', false, true), (101, 10, 'secret', false, false);
        CREATE TABLE system_embedding_refresh_jobs (
            table_uid integer, row_id bigint, last_error_code text NOT NULL DEFAULT '');
        INSERT INTO system_embedding_refresh_jobs VALUES (10, 1, ''), (10, 2, 'provider_error');

        CREATE TABLE catalog (id integer PRIMARY KEY, header text, secret text,
            updated timestamptz NOT NULL DEFAULT now(), embedding_vector vector);
        -- Without a foreign key, like the older language tables that kept
        -- embeddings of deleted rows.
        CREATE TABLE catalog_lang_embeddings (host_row_id integer, language_code text,
            embedding vector, updated timestamp NOT NULL DEFAULT now(), content_md5 text);
        INSERT INTO catalog (id, header, embedding_vector) VALUES
            (1, 'embedded long ago', '[1, 0]'),
            (2, 'made by another model', '[0.6, 0]'),
            (3, 'never embedded', NULL),
            (4, 'embedded after its last edit', NULL);
        INSERT INTO catalog_lang_embeddings (host_row_id, language_code, embedding, updated) VALUES
            (1, 'en', '[0, 1]', '2020-01-01'),
            (1, 'fi', '[1, 0]', '2020-01-01'),
            (4, 'en', '[0, 1]', '2999-01-01'),
            (99, 'en', '[0, 1]', '2020-01-01');

        CREATE TABLE notes (id integer PRIMARY KEY, body text, embedding_vector vector);
        INSERT INTO notes VALUES (1, 'a', '[1, 0]'), (2, 'b', NULL);
        CREATE TABLE plain (id integer PRIMARY KEY, body text);
        CREATE TABLE elsewhere (id integer PRIMARY KEY, body text);
    `); err != nil {
		t.Fatal(err)
	}
	return db
}

func buildTestEmbeddingStatusReport(t *testing.T, db *sql.DB) EmbeddingStatusReport {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	report, err := BuildEmbeddingStatusReport(tx)
	if err != nil {
		t.Fatalf("status report failed: %v", err)
	}
	return report
}

func statusByDataset(report EmbeddingStatusReport) map[string]EmbeddingDatasetStatus {
	byName := map[string]EmbeddingDatasetStatus{}
	for _, status := range report.Datasets {
		byName[status.Dataset] = status
	}
	return byName
}

func TestTheStatusTellsHowFullyADatasetIsEmbeddedPostgres(t *testing.T) {
	t.Setenv("EMBEDDING_PROVIDER", "openai")
	t.Setenv("OPENAI_EMBEDDING_MODEL", "test-embedding-model")
	t.Setenv("OPENAI_API_KEY", "")
	db := embeddingStatusDB(t)

	report := buildTestEmbeddingStatusReport(t, db)
	if report.Provider.Provider != "openai" || report.Provider.Model != "test-embedding-model" ||
		!report.Provider.UnitLength || report.Provider.KeyConfigured || !report.Provider.RefreshQueueAvailable {
		t.Fatalf("provider = %+v", report.Provider)
	}

	catalog, ok := statusByDataset(report)["catalog"]
	if !ok {
		t.Fatalf("catalog missing from %+v", report.Datasets)
	}
	if catalog.Unavailable || catalog.TotalRows == nil || *catalog.TotalRows != 4 {
		t.Fatalf("catalog totals = %+v", catalog)
	}
	if catalog.EmbeddedRows != 3 || catalog.GeneralEmbeddedRows != 2 {
		t.Fatalf("embedded rows = %d (general %d), want 3 (general 2)", catalog.EmbeddedRows, catalog.GeneralEmbeddedRows)
	}
	if catalog.ChangedSinceEmbedding == nil || *catalog.ChangedSinceEmbedding != 1 {
		t.Fatalf("changed since embedding = %v, want 1 (row 1)", catalog.ChangedSinceEmbedding)
	}
	if fmt.Sprint(catalog.Languages) != "[{en 2} {fi 1}]" {
		t.Fatalf("languages = %v, want en for two live rows and fi for one", catalog.Languages)
	}
	if catalog.OrphanLanguageEmbeddings != 1 {
		t.Fatalf("orphaned language embeddings = %d, want 1", catalog.OrphanLanguageEmbeddings)
	}
	if fmt.Sprint(catalog.VectorDimensions) != "[2]" || catalog.OtherModelEmbeddings != 1 {
		t.Fatalf("dimensions %v, other-model vectors %d; want [2] and 1", catalog.VectorDimensions, catalog.OtherModelEmbeddings)
	}
	if catalog.LastRefreshed == nil || catalog.LastRefreshed.Year() != 2999 {
		t.Fatalf("last refreshed = %v, want the newest language embedding", catalog.LastRefreshed)
	}
	if catalog.PendingRefreshes != 2 || catalog.FailingRefreshes != 1 {
		t.Fatalf("queue = %d pending, %d failing; want 2 and 1", catalog.PendingRefreshes, catalog.FailingRefreshes)
	}
	if catalog.ApprovedFields != 1 || !catalog.AutomaticRefresh || catalog.AutomaticRefreshBlocker != "" {
		t.Fatalf("automatic refresh = %+v", catalog)
	}
}

func TestTheStatusSaysWhyRowsAreNotReembeddedPostgres(t *testing.T) {
	t.Setenv("EMBEDDING_PROVIDER", "google")
	t.Setenv("GOOGLE_EMBEDDING_MODEL", "")
	db := embeddingStatusDB(t)

	report := buildTestEmbeddingStatusReport(t, db)
	if report.Provider.Model != defaultGoogleEmbeddingModel || report.Provider.Dimensions != googleEmbeddingDimensions || report.Provider.UnitLength {
		t.Fatalf("provider = %+v", report.Provider)
	}
	byName := statusByDataset(report)

	notes := byName["notes"]
	if notes.AutomaticRefresh || notes.AutomaticRefreshBlocker != "provider_sending_disabled" {
		t.Fatalf("notes = %+v, want automatic refresh off because sending is disabled", notes)
	}
	// The general embedding keeps no time: its age and staleness are unknown.
	if notes.ChangedSinceEmbedding != nil || notes.LastRefreshed != nil {
		t.Fatalf("notes reported what is not recorded: %+v", notes)
	}
	if notes.TotalRows == nil || *notes.TotalRows != 2 || notes.EmbeddedRows != 1 {
		t.Fatalf("notes counts = %+v", notes)
	}
	// Two-dimensional vectors cannot come from a model that makes 1536.
	if notes.OtherModelEmbeddings != 1 {
		t.Fatalf("notes other-model vectors = %d, want 1", notes.OtherModelEmbeddings)
	}

	plain, listed := byName["plain"]
	if !listed || plain.TotalRows != nil || plain.AutomaticRefreshBlocker != "no_embedding_storage" {
		t.Fatalf("the current project's unembedded dataset = %+v (listed %v)", plain, listed)
	}
	if _, listed := byName["elsewhere"]; listed {
		t.Fatal("an unembedded dataset outside the current project must not be listed")
	}
}

func TestOneUnreadableDatasetDoesNotHideTheOthersPostgres(t *testing.T) {
	db := embeddingStatusDB(t)
	if _, err := db.Exec(`
        INSERT INTO system_db_tables VALUES (14, 'broken', 'public', 1, true, false, false);
        CREATE TABLE broken (id integer PRIMARY KEY);
        CREATE TABLE broken_lang_embeddings (host_row_id integer);
    `); err != nil {
		t.Fatal(err)
	}

	byName := statusByDataset(buildTestEmbeddingStatusReport(t, db))
	if !byName["broken"].Unavailable {
		t.Fatalf("broken = %+v, want unavailable", byName["broken"])
	}
	if byName["catalog"].Unavailable || byName["catalog"].EmbeddedRows != 3 {
		t.Fatalf("catalog after a failed dataset = %+v", byName["catalog"])
	}
}

func TestVectorShapeMatchesProvider(t *testing.T) {
	google := EmbeddingProviderStatus{Provider: "google", Dimensions: 1536}
	openAI := EmbeddingProviderStatus{Provider: "openai", Dimensions: 1536, UnitLength: true}
	cases := []struct {
		provider   EmbeddingProviderStatus
		dims       int
		unitLength bool
		want       bool
	}{
		{google, 1536, false, true},
		{google, 1536, true, false}, // an OpenAI vector left from before a switch to Google
		{google, 3072, false, false},
		{openAI, 1536, true, true},
		{openAI, 1536, false, false}, // a Google vector left from before a switch to OpenAI
		{EmbeddingProviderStatus{UnitLength: true}, 768, true, true},
	}
	for _, c := range cases {
		if got := vectorShapeMatchesProvider(c.provider, c.dims, c.unitLength); got != c.want {
			t.Fatalf("%+v dims=%d unit=%v: got %v, want %v", c.provider, c.dims, c.unitLength, got, c.want)
		}
	}
}
