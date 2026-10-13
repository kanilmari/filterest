// publication_postgres_test.go
// Proves forward migration, replay, ledger evidence and publication handlers in PostgreSQL.
// Connects the real pre-publication release schema with the dedicated administrator API.
// Uses only an opt-in disposable cluster; never connects to installation data.
package workline_observatory

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/migrations"
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

const publicationMigration = "20261009000070_add_publication_fields_to_release_goals.sql"
const publicationLanguageMigration = "20261009000071_seed_publication_language_keys.sql"
const publicationRepairMigration = "20261009000073_repair_publication_translations.sql"
const publicationMetadataMigration = "20261009000072_register_publication_columns.sql"

func publicationSource(t *testing.T, filename string) []byte {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", filename))
	if err != nil {
		t.Fatal(err)
	}
	return content
}

func publicationPostgresDB(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated publication PostgreSQL proof")
	}
	t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", "")
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	root := t.TempDir()
	socket, data := filepath.Join(root, "socket"), filepath.Join(root, "db")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(filepath.Join(bin, name), args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, output)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		_, _ = exec.Command(filepath.Join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
	})
	// Separate Unix socket directories isolate parallel tests without network access.
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", "-h '' -k '"+socket+"' -p 15564", "-w", "start")
	db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=15564 user=test_owner dbname=postgres sslmode=disable connect_timeout=5", socket))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	publicationSQL(t, db, `
        CREATE TABLE system_users(id integer PRIMARY KEY, username text);
        INSERT INTO system_users VALUES (2,'fixture_admin');
        CREATE TABLE dev_agent_tasks(id integer PRIMARY KEY);
        CREATE TABLE system_data_repair_records(migration text, action text);
        CREATE TABLE system_db_version(version text,description text);
        CREATE TABLE system_schema_migrations(filename text PRIMARY KEY,applied_at timestamptz DEFAULT now());
        INSERT INTO system_schema_migrations(filename) VALUES ('earlier.sql');
        CREATE TABLE system_db_tables(table_uid integer PRIMARY KEY,table_name text,schema_name text);
        INSERT INTO system_db_tables VALUES (1,'dev_agent_release_goals','public');
        CREATE TABLE system_column_details(table_uid integer,column_name text,data_type text,co_number integer,created timestamptz,updated timestamptz);
        CREATE TABLE system_lang_keys(id serial PRIMARY KEY,lang_key text UNIQUE,fi text,en text,ch text,yue text,creation_spec text);

    `)
	publicationLanguageFixture(t, db)
	publicationSQL(t, db, string(publicationSource(t, "20260919000008_create_developer_workline_schema.sql")))
	// The installation's row-actor migration supplies these to the API. This
	// minimal fixture supplies only their shape, without unrelated actor policy.
	publicationSQL(t, db, `ALTER TABLE dev_agent_release_goals ADD COLUMN owner_id integer;
        ALTER TABLE dev_agent_release_goal_contracts ADD COLUMN owner_id integer;
        INSERT INTO dev_agent_worklines(id,title) VALUES (1,'Required feature');
        INSERT INTO dev_agent_release_goals(identity_key,version,title,outcome,decision_state,locked_at,is_selected)
        VALUES ('earlier',2,'Earlier locked goal','Accepted scope','locked',now(),true);
        INSERT INTO dev_agent_release_goals(identity_key,version,title,outcome)
        VALUES ('draft-before-upgrade',1,'Earlier draft','Draft scope');`)
	return db
}

func publicationSQL(t *testing.T, db *sql.DB, text string) {
	t.Helper()
	if _, err := db.Exec(text); err != nil {
		t.Fatal(err)
	}
}

func applyPublicationMigrations(t *testing.T, db *sql.DB) {
	t.Helper()
	dir := t.TempDir()
	for _, name := range []string{"20261009000020_add_migration_execution_evidence.sql", publicationMigration, publicationLanguageMigration, publicationMetadataMigration, publicationRepairMigration, "20261009000099_record_database_release_9_11_0.sql"} {
		if err := os.WriteFile(filepath.Join(dir, name), publicationSource(t, name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := migrations.RunMigrations(db, dir); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPublicationMigrationAndReplayPostgres(t *testing.T) {
	db := publicationPostgresDB(t)
	applyPublicationMigrations(t, db)
	var state string
	var version int
	var published bool
	var at sql.NullTime
	var revision int64
	if err := db.QueryRow(`SELECT decision_state,version,published,published_at,publication_revision FROM dev_agent_release_goals WHERE identity_key='earlier'`).Scan(&state, &version, &published, &at, &revision); err != nil {
		t.Fatal(err)
	}
	if state != "locked" || version != 2 || published || at.Valid || revision != 0 {
		t.Fatalf("legacy goal changed: %s/%d/%v/%v/%d", state, version, published, at, revision)
	}
	publicationSQL(t, db, `UPDATE dev_agent_release_goals SET publication_version='9.4.0',reader_description='Desktop ja mobiili',target_date='2026-12-01' WHERE identity_key='earlier'`)
	for _, name := range []string{publicationMigration, publicationLanguageMigration, publicationMetadataMigration, publicationRepairMigration} {
		publicationSQL(t, db, string(publicationSource(t, name)))
	}
	var findings, count int
	if err := db.QueryRow(`SELECT count(*) FROM app_check_publications()`).Scan(&findings); err != nil || findings != 0 {
		t.Fatalf("final checks = %d, %v", findings, err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_data_repair_records WHERE migration='wl164_publication_fields' AND action='completed'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("completion markers=%d, %v", count, err)
	}
	if err := db.QueryRow(`SELECT publication_revision FROM dev_agent_release_goals WHERE identity_key='earlier'`).Scan(&revision); err != nil || revision != 1 {
		t.Fatalf("replay changed revision: %d, %v", revision, err)
	}
	for _, name := range []string{publicationMigration, publicationLanguageMigration, publicationMetadataMigration, publicationRepairMigration} {
		var digest, outcome, provenance string
		if err := db.QueryRow(`SELECT content_sha256,outcome,provenance FROM system_schema_migrations WHERE filename=$1`, name).Scan(&digest, &outcome, &provenance); err != nil {
			t.Fatal(err)
		}
		if digest != fmt.Sprintf("%x", sha256.Sum256(publicationSource(t, name))) || outcome != "applied" || provenance != "runner" {
			t.Fatalf("untruthful ledger: %s/%s/%s", digest, outcome, provenance)
		}
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_schema_migrations WHERE filename='earlier.sql' AND content_sha256 IS NULL AND outcome IS NULL AND provenance IS NULL`).Scan(&count); err != nil || count != 1 {
		t.Fatal("historical ledger was rewritten", err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_column_details WHERE table_uid=1`).Scan(&count); err != nil || count != 6 {
		t.Fatalf("metadata columns=%d, %v", count, err)
	}
	var translation string
	if err := db.QueryRow(`SELECT translation FROM system_lang_key_translations WHERE lang_key_id=1 AND language_code='fi'`).Scan(&translation); err != nil || translation != "Omat julkaisut" {
		t.Fatalf("authored translation replaced: %s, %v", translation, err)
	}
	for _, query := range []string{
		`UPDATE dev_agent_release_goals SET title='Rewrite locked scope' WHERE identity_key='earlier'`,
		`UPDATE dev_agent_release_goals SET published=true WHERE identity_key='earlier'`,
		`UPDATE dev_agent_release_goals SET published_at=now() WHERE identity_key='earlier'`,
		`UPDATE dev_agent_release_goals SET target_date='infinity' WHERE identity_key='earlier'`,
		`INSERT INTO dev_agent_release_goal_contracts(release_goal_id,workline_id,completion_rule) SELECT id,1,'must_complete' FROM dev_agent_release_goals WHERE identity_key='earlier'`,
	} {
		if _, err := db.Exec(query); err == nil {
			t.Fatalf("invalid write accepted: %s", query)
		}
	}
}

func TestPublicationMigrationFailureLeavesNoLedgerPostgres(t *testing.T) {
	db := publicationPostgresDB(t)
	publicationSQL(t, db, `ALTER TABLE dev_agent_release_goals ADD COLUMN published boolean`)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, publicationMigration), publicationSource(t, publicationMigration), 0600); err != nil {
		t.Fatal(err)
	}
	if err := migrations.RunMigrations(db, dir); err == nil {
		t.Fatal("incompatible pre-existing nullable column was accepted")
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM system_schema_migrations WHERE filename=$1`, publicationMigration).Scan(&count); err != nil || count != 0 {
		t.Fatalf("failed migration recorded as successful: %d, %v", count, err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_data_repair_records WHERE migration='wl164_publication_fields'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("failure left completion marker", err)
	}
}

func publicationAPICall(t *testing.T, db *sql.DB, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "/api/app/workline-observatory/release-goals", strings.NewReader(body))
	session, err := e_sessions.Load(req)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"] = 2
	lazy := dbutils.NewLazyTx(db)
	req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
	w := httptest.NewRecorder()
	ReleaseGoalsHandler(w, req)
	if w.Code >= 400 {
		_ = lazy.Rollback()
	} else if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	return w
}

func TestPublicationAPIAndCurrentPlanPostgres(t *testing.T) {
	db := publicationPostgresDB(t)
	applyPublicationMigrations(t, db)
	oldStore := e_sessions.Store
	e_sessions.Store = sessions.NewCookieStore([]byte("publication-fixture-only-key"))
	t.Cleanup(func() { e_sessions.Store = oldStore })
	create := `{"identity_key":"public-desktop-mobile","version":1,"title":"Filterestin yhdistetty julkinen desktop- ja mobiilisivusto","outcome":"Build the required desktop and mobile features.","publication_version":"9.4.0","target_date":"2026-12-01","reader_description":"Yksi sivusto tietokoneelle ja puhelimelle.","published":false,"selected":true}`
	w := publicationAPICall(t, db, http.MethodPost, create)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if w := publicationAPICall(t, db, http.MethodPatch, `{"id":1,"action":"select"}`); w.Code != 200 {
		t.Fatalf("legacy selection = %d %s", w.Code, w.Body.String())
	}
	snapshot, err := loadBoardSnapshot(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	goal := snapshot.ReleaseGoal
	if goal == nil || goal.ID != created.ID || !goal.IsCurrentPublication || goal.Published || goal.PublicationVersion != "9.4.0" || goal.TargetDate == nil || *goal.TargetDate != "2026-12-01" || goal.PublishedAt != nil {
		t.Fatalf("current publication = %+v", goal)
	}
	// Contract completeness and locked identity remain enforced by the API.
	if w := publicationAPICall(t, db, http.MethodPatch, fmt.Sprintf(`{"id":%d,"action":"lock"}`, created.ID)); w.Code != 409 {
		t.Fatalf("incomplete lock = %d %s", w.Code, w.Body.String())
	}
	publicationSQL(t, db, fmt.Sprintf(`INSERT INTO dev_agent_release_goal_contracts(release_goal_id,workline_id,completion_rule) VALUES (%d,1,'must_complete')`, created.ID))
	if w := publicationAPICall(t, db, http.MethodPatch, fmt.Sprintf(`{"id":%d,"action":"lock"}`, created.ID)); w.Code != 200 {
		t.Fatalf("lock = %d %s", w.Code, w.Body.String())
	}
	update := fmt.Sprintf(`{"id":%d,"action":"update","expected_revision":0,"publication_version":"9.4.0","target_date":"2026-12-02","reader_description":"Desktop ja mobiili yhdessä.","published":true}`, created.ID)
	if w := publicationAPICall(t, db, http.MethodPatch, update); w.Code != 200 {
		t.Fatalf("publish = %d %s", w.Code, w.Body.String())
	}
	if w := publicationAPICall(t, db, http.MethodPatch, update); w.Code != 409 {
		t.Fatalf("stale publish = %d %s", w.Code, w.Body.String())
	}
	w = publicationAPICall(t, db, http.MethodGet, "")
	var response struct {
		Publications []BoardReleaseGoal `json:"publications"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil {
		t.Fatalf("list = %d %s", w.Code, w.Body.String())
	}
	if len(response.Publications) != 3 || response.Publications[0].ID == created.ID || !response.Publications[0].IsCurrentPublication {
		t.Fatalf("next unpublished focus = %+v", response.Publications)
	}
	published := response.Publications[len(response.Publications)-1]
	if published.ID != created.ID || !published.Published || published.PublishedAt == nil || published.PublicationRevision != 1 || published.Version != 1 {
		t.Fatalf("publication did not persist = %+v", published)
	}
	originalTime := *published.PublishedAt
	update = strings.Replace(update, `"expected_revision":0`, `"expected_revision":1`, 1)
	if w := publicationAPICall(t, db, http.MethodPatch, update); w.Code != 200 {
		t.Fatalf("idempotent save = %d %s", w.Code, w.Body.String())
	}
	goals, err := loadPublications(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	if !goals[len(goals)-1].PublishedAt.Equal(originalTime) || goals[len(goals)-1].PublicationRevision != 1 {
		t.Fatal("unchanged save rewrote time or revision")
	}
	missing := strings.Replace(update, fmt.Sprintf(`"id":%d`, created.ID), `"id":99999`, 1)
	if w := publicationAPICall(t, db, http.MethodPatch, missing); w.Code != 404 {
		t.Fatalf("missing goal = %d", w.Code)
	}
	resend := strings.TrimSuffix(update, "}") + fmt.Sprintf(`,"published_at":%q}`, originalTime.Format(time.RFC3339Nano))
	if w := publicationAPICall(t, db, http.MethodPatch, resend); w.Code != 200 {
		t.Fatalf("resend stored instant = %d %s", w.Code, w.Body.String())
	}
	correction := strings.TrimSuffix(update, "}") + `,"published_at":"2026-10-01T10:30:00.123456Z"}`
	if w := publicationAPICall(t, db, http.MethodPatch, correction); w.Code != 200 {
		t.Fatalf("explicit time correction = %d %s", w.Code, w.Body.String())
	}
	staleCorrection := strings.Replace(correction, "10:30:00.123456", "11:00:00.654321", 1)
	if w := publicationAPICall(t, db, http.MethodPatch, staleCorrection); w.Code != 409 {
		t.Fatalf("stale time correction = %d %s", w.Code, w.Body.String())
	}
	var corrected time.Time
	var correctedRevision int64
	if err := db.QueryRow(`SELECT published_at,publication_revision FROM dev_agent_release_goals WHERE id=$1`, created.ID).Scan(&corrected, &correctedRevision); err != nil {
		t.Fatal(err)
	}
	if corrected.UTC().Format(time.RFC3339Nano) != "2026-10-01T10:30:00.123456Z" || correctedRevision != 2 {
		t.Fatalf("correction lost or stale save changed it: %s/%d", corrected, correctedRevision)
	}
	update = strings.Replace(update, `"expected_revision":1`, `"expected_revision":2`, 1)
	unpublish := strings.Replace(update, `"published":true`, `"published":false`, 1)
	if w := publicationAPICall(t, db, http.MethodPatch, unpublish); w.Code != 200 {
		t.Fatalf("unpublish = %d %s", w.Code, w.Body.String())
	}
	goals, err = loadPublications(context.Background(), db)
	if err != nil || goals[0].ID != created.ID || goals[0].PublishedAt != nil || goals[0].PublicationRevision != 3 {
		t.Fatalf("unpublish focus = %+v, %v", goals, err)
	}
	publishedCreate := strings.Replace(create, "public-desktop-mobile", "earlier-published-version", 1)
	publishedCreate = strings.Replace(publishedCreate, `"published":false`, `"published":true,"published_at":"2026-09-01T13:00:00+03:00"`, 1)
	publishedCreate = strings.Replace(publishedCreate, `"selected":true`, `"selected":false`, 1)
	if w := publicationAPICall(t, db, http.MethodPost, publishedCreate); w.Code != 201 {
		t.Fatalf("create published = %d %s", w.Code, w.Body.String())
	}
	goals, err = loadPublications(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	historical := goals[len(goals)-1]
	if goals[0].ID != created.ID || historical.PublishedAt == nil || historical.PublishedAt.UTC().Format(time.RFC3339) != "2026-09-01T10:00:00Z" {
		t.Fatalf("explicit publication time or current plan changed: %+v", goals)
	}
}
