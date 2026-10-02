// missing_media_check_postgres_test.go
// Runs the missing-media check, its settings reader and its administration handler on real PostgreSQL.
// Between the check's own statements and a disposable, socket-only cluster holding a few datasets.
// Exists so the bounded count, the page-by-page and sampled reads, the estimate, the unreached datasets
// and the stored failed runs are proven on the database they run on, never on a live one.
package missing_media_check

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	media_utils "easelect/backend/core_components/media_utils"

	_ "github.com/lib/pq"
)

const mediaCheckFixtureSchema = `
CREATE TABLE system_db_tables(table_uid bigint PRIMARY KEY, table_name text, schema_name text);
CREATE TABLE system_column_details(table_uid bigint, column_name text, card_element text);
CREATE TABLE system_foreign_key_relations_1_m(
    id bigint PRIMARY KEY, source_table_uid bigint, target_table_uid bigint,
    source_column_name text, target_insert_specs jsonb);
CREATE TABLE system_config(
    id bigserial PRIMARY KEY, key varchar NOT NULL UNIQUE, json_value jsonb, text_value text,
    value_type integer, creation_spec text,
    created timestamp NOT NULL DEFAULT now(), updated timestamp NOT NULL DEFAULT now());
`

// mediaCheckDisposableDB starts an isolated PostgreSQL 16 cluster on a private socket.
func mediaCheckDisposableDB(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL verification")
	}
	root, err := os.MkdirTemp("", "fmmc-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	socket, data := filepath.Join(root, "s"), filepath.Join(root, "db")
	if err := os.Mkdir(socket, 0o700); err != nil {
		t.Fatal(err)
	}
	bin := "/usr/lib/postgresql/16/bin/"
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(bin+name, args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, output)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "pg.log"), "-o", "-h '' -k '"+socket+"' -p 15483", "-w", "start")
	t.Cleanup(func() {
		_, _ = exec.Command(bin+"pg_ctl", "-D", data, "-m", "fast", "-w", "stop").CombinedOutput()
	})
	db, err := sql.Open("postgres", "host="+socket+" port=15483 user=test_owner dbname=postgres sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mediaCheckExec(t, db, mediaCheckFixtureSchema)
	return db
}

func mediaCheckExec(t *testing.T, db *sql.DB, statement string, args ...interface{}) {
	t.Helper()
	if _, err := db.Exec(statement, args...); err != nil {
		t.Fatalf("exec %q: %v", strings.TrimSpace(statement)[:min(60, len(strings.TrimSpace(statement)))], err)
	}
}

// addMediaDataset registers a parent dataset whose <parent>_assets child holds rows 1..rows,
// each naming the file <uid>_<row>_<row>.jpg of parent row <row>.
func addMediaDataset(t *testing.T, db *sql.DB, uid int, parent string, rows int, parentSchema string, filenameColumn string) {
	t.Helper()
	child := parent + "_assets"
	mediaCheckExec(t, db, fmt.Sprintf(`CREATE TABLE %s(id bigint PRIMARY KEY)`, parent))
	mediaCheckExec(t, db, fmt.Sprintf(`CREATE TABLE %s(id serial PRIMARY KEY, %s_id bigint, filename text)`, child, parent))
	mediaCheckExec(t, db, fmt.Sprintf(
		`INSERT INTO %s(id, %s_id, filename) SELECT g, g, '%d_' || g || '_' || g || '.jpg' FROM generate_series(1, %d) AS g`,
		child, parent, uid, rows,
	))
	mediaCheckExec(t, db, `INSERT INTO system_db_tables VALUES ($1, $2, $3), ($4, $5, 'public')`, uid, parent, parentSchema, uid+1, child)
	specs := fmt.Sprintf(`{"file_upload": {"enabled": true, "filename_column": %q}}`, filenameColumn)
	mediaCheckExec(t, db, `INSERT INTO system_foreign_key_relations_1_m VALUES ($1, $2, $3, $4, $5::jsonb)`, uid, uid+1, uid, parent+"_id", specs)
}

func storeMediaFile(t *testing.T, storageRoot string, uid int, row int) {
	t.Helper()
	writeStorageFile(t, storageRoot, fmt.Sprintf("%d/%d/original/%d_%d_%d.jpg", uid, row, uid, row, row))
}

func checkSettings(adjust func(*Settings)) Settings {
	settings := DefaultSettings()
	adjust(&settings)
	return settings
}

func runCheckOn(t *testing.T, db *sql.DB, storageRoot string, settings Settings, seed int64) Result {
	t.Helper()
	result, err := Run(context.Background(), CheckInput{
		Database: db, StorageRoot: storageRoot, Settings: settings, Trigger: TriggerManual,
		Identity: RunIdentity{AppVersion: "9.3.19", DBVersion: "9.9.2", BuildID: "test"}, Seed: seed,
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	return result
}

// visitedRowIDs reads one dataset as the run would and lists the rows it visited.
func visitedRowIDs(t *testing.T, db *sql.DB, parent string, budget DatasetBudget, sample rowSample) []int64 {
	t.Helper()
	target := relationTarget{Dataset: parent, AssetTable: parent + "_assets", ForeignKey: parent + "_id", FilenameColumn: "filename"}
	ids := []int64{}
	if _, err := readSampledRows(readOnlyQuerier{ctx: context.Background(), database: db}, target, budget, sample, func(row sampledAssetRow) bool {
		ids = append(ids, row.AssetRowID)
		return true
	}); err != nil {
		t.Fatalf("read %s: %v", parent, err)
	}
	return ids
}

func TestDisposableEvenSampleReachesTheNewestRowAndCountsWhatItChecked(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	storageRoot := t.TempDir()
	addMediaDataset(t, db, 101, "photos", 40, "public", "filename")
	// A gap of deleted rows: two sample points land on the same next row.
	mediaCheckExec(t, db, `DELETE FROM photos_assets WHERE id BETWEEN 2 AND 10`)
	for row := 1; row < 40; row++ {
		storeMediaFile(t, storageRoot, 101, row)
	}

	// The gallery pass plans with the limit less the fifth kept for the card pass, so a
	// limit of 12 gives it 10 rows; the two passes together stay within 12.
	result := runCheckOn(t, db, storageRoot, checkSettings(func(s *Settings) { s.MaxTotalRowsChecked = 12 }), 0)

	if result.RowsTotal != 31 || result.RowsPlanned != 10 || !result.RowBudgetReached {
		t.Fatalf("plan = %d of %d rows, budget reached %v; want 10 of 31", result.RowsPlanned, result.RowsTotal, result.RowBudgetReached)
	}
	if result.RowsChecked != 9 || result.Datasets[0].CheckedRows != 9 {
		t.Fatalf("checked %d rows, want the 9 distinct rows the 10 points reach", result.RowsChecked)
	}
	if result.MissingCount != 1 || result.MissingRows[0].AssetRowID != 40 {
		t.Fatalf("missing = %+v, want the newest row 40, which a stride sample never reached", result.MissingRows)
	}
	if result.Datasets[0].Complete || result.Sampling != SamplingEven || result.SamplingSeed != 0 {
		t.Fatalf("summary = %+v, sampling %q seed %d; want an even, incomplete sample", result.Datasets[0], result.Sampling, result.SamplingSeed)
	}
	if result.AppVersion != "9.3.19" || result.DBVersion != "9.9.2" || result.BuildID != "test" {
		t.Fatalf("identity = %s/%s/%s, want the installation the run checked", result.AppVersion, result.DBVersion, result.BuildID)
	}
}

// A dataset counted for a full read that grows before it is read keeps to its planned
// rows: the run's limit, the card pass's share included, holds, and the dataset is not
// called complete, so no file can be called unused on a partial read.
func TestDisposableADatasetThatGrewAfterItsCountKeepsTheRowLimit(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	storageRoot := t.TempDir()
	addMediaDataset(t, db, 101, "photos", 12, "public", "filename")
	result := Result{}
	run := &checkRun{
		result:            &result,
		settings:          DefaultSettings(),
		reader:            readOnlyQuerier{ctx: context.Background(), database: db},
		fileState:         media_utils.StoredFileState(storageRoot),
		now:               time.Now,
		deadline:          time.Now().Add(time.Minute),
		referencedByOwner: map[string]map[string]bool{},
	}
	target := relationTarget{Dataset: "photos", AssetTable: "photos_assets", ForeignKey: "photos_id", FilenameColumn: "filename", ParentTableUID: "101"}
	// Counted at 10 rows and planned in full; two more rows arrived before the read.
	summary := run.checkDataset(target, DatasetBudget{Dataset: "photos", AssetTable: "photos_assets", RowCount: 10, PlannedRows: 10, Complete: true})
	if summary.CheckedRows != 10 || result.RowsChecked != 10 || summary.Complete || !result.RowBudgetReached {
		t.Fatalf("checked %d (run %d), complete %v, budget reached %v; want 10, not complete, budget reached",
			summary.CheckedRows, result.RowsChecked, summary.Complete, result.RowBudgetReached)
	}
}

// A gallery row whose file could not be looked at, for example on an unreadable disk,
// is counted as unchecked and never called missing, as the card pass does.
func TestDisposableAGalleryFileThatCouldNotBeCheckedIsNotCalledMissing(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	addMediaDataset(t, db, 101, "photos", 3, "public", "filename")
	result := Result{}
	run := &checkRun{
		result:            &result,
		settings:          DefaultSettings(),
		reader:            readOnlyQuerier{ctx: context.Background(), database: db},
		fileState:         func(string) media_utils.StoredFileStatus { return media_utils.StoredFileUnknown },
		now:               time.Now,
		deadline:          time.Now().Add(time.Minute),
		referencedByOwner: map[string]map[string]bool{},
	}
	target := relationTarget{Dataset: "photos", AssetTable: "photos_assets", ForeignKey: "photos_id", FilenameColumn: "filename", ParentTableUID: "101"}
	summary := run.checkDataset(target, DatasetBudget{Dataset: "photos", AssetTable: "photos_assets", RowCount: 3, PlannedRows: 3, Complete: true})
	if summary.CheckedRows != 3 || result.MissingCount != 0 || result.UncheckedFilesCount != 3 {
		t.Fatalf("checked %d, missing %d, unchecked %d; want 3 checked, none missing, 3 unchecked",
			summary.CheckedRows, result.MissingCount, result.UncheckedFilesCount)
	}
}

func TestDisposableRandomSampleRepeatsFromTheStoredSeed(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	addMediaDataset(t, db, 101, "photos", 400, "public", "filename")
	budget := DatasetBudget{Dataset: "photos", AssetTable: "photos_assets", RowCount: 400, PlannedRows: 25}

	first := visitedRowIDs(t, db, "photos", budget, rowSample{Method: SamplingRandom, Seed: 12345})
	again := visitedRowIDs(t, db, "photos", budget, rowSample{Method: SamplingRandom, Seed: 12345})
	if fmt.Sprint(first) != fmt.Sprint(again) || len(first) == 0 || len(first) > 25 {
		t.Fatalf("samples %v and %v, want one repeatable sample of at most 25 rows", first, again)
	}
	for index := 1; index < len(first); index++ {
		if first[index] <= first[index-1] {
			t.Fatalf("sample %v visits a row twice or out of order", first)
		}
	}

	result := runCheckOn(t, db, t.TempDir(), checkSettings(func(s *Settings) {
		s.MaxTotalRowsChecked = 25
		s.Sampling = SamplingRandom
	}), 777)
	if result.Sampling != SamplingRandom || result.SamplingSeed != 777 {
		t.Fatalf("result sampling %q seed %d, want the random seed stored", result.Sampling, result.SamplingSeed)
	}
}

func TestDisposableSmallDatasetIsReadCompletelyPageByPage(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	addMediaDataset(t, db, 201, "archive", 2500, "public", "filename")
	mediaCheckExec(t, db, `UPDATE archive_assets SET filename = '  ' WHERE id = 2500`)

	result := runCheckOn(t, db, t.TempDir(), DefaultSettings(), 0)

	summary := result.Datasets[0]
	if summary.CheckedRows != 2499 || !summary.Complete || result.RowBudgetReached {
		t.Fatalf("summary = %+v, want all 2499 media rows read across three pages", summary)
	}
	if result.MissingCount != 2499 || len(result.MissingRows) != 200 || !result.MissingTruncated {
		t.Fatalf("missing %d, listed %d, truncated %v; want 2499 found and the list cut at 200",
			result.MissingCount, len(result.MissingRows), result.MissingTruncated)
	}
}

func TestDisposableHugeDatasetIsEstimatedAndNeverComplete(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	addMediaDataset(t, db, 301, "huge", 1500, "public", "filename")
	mediaCheckExec(t, db, `ANALYZE huge_assets`)

	result := runCheckOn(t, db, t.TempDir(), checkSettings(func(s *Settings) { s.ExactCountMaxRows = 1000 }), 0)

	summary := result.Datasets[0]
	if !summary.RowCountEstimated || !result.RowCountEstimated || summary.RowCount != 1500 {
		t.Fatalf("summary = %+v, want the count estimated from the table statistics", summary)
	}
	if summary.CheckedRows != 1500 || summary.Complete {
		t.Fatalf("summary = %+v, want every row reached and still not reported complete", summary)
	}
}

func TestDisposableUnreachableDatasetsAreListedWithTheirReason(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	addMediaDataset(t, db, 101, "photos", 3, "public", "filename")
	addMediaDataset(t, db, 401, "ghost", 3, "archive", "filename")
	addMediaDataset(t, db, 501, "broken", 3, "public", "no_such_column")

	result := runCheckOn(t, db, t.TempDir(), DefaultSettings(), 0)

	reasons := map[string]string{}
	for _, dataset := range result.UnreachedDatasets {
		reasons[dataset.Dataset] = dataset.Reason
		if dataset.Detail == "" {
			t.Fatalf("unreached %s carries no detail", dataset.Dataset)
		}
	}
	if reasons["ghost"] != UnreachedLookupFailed || reasons["broken"] != UnreachedCountFailed || len(reasons) != 2 {
		t.Fatalf("unreached = %v, want ghost lookup_failed and broken count_failed", reasons)
	}
	if result.DatasetsTotal != 3 || result.DatasetsChecked != 1 || result.RowsChecked != 3 {
		t.Fatalf("datasets %d/%d, rows %d; want the reachable dataset checked and all three counted",
			result.DatasetsChecked, result.DatasetsTotal, result.RowsChecked)
	}
}

func TestDisposableAnExpiredClockLeavesDatasetsUnreachedByTime(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	addMediaDataset(t, db, 101, "photos", 3, "public", "filename")
	startedAt := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	calls := 0
	result, err := Run(context.Background(), CheckInput{
		Database: db, StorageRoot: t.TempDir(), Settings: DefaultSettings(),
		Now: func() time.Time {
			calls++
			if calls == 1 {
				return startedAt
			}
			return startedAt.Add(time.Hour)
		},
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if !result.TimeBudgetReached || result.RowsChecked != 0 || len(result.UnreachedDatasets) != 1 ||
		result.UnreachedDatasets[0].Reason != UnreachedTimeLimit {
		t.Fatalf("result = %+v, want the dataset listed as reached by nothing but the time limit", result)
	}
}

func useBackendDB(t *testing.T, db *sql.DB) {
	t.Helper()
	previous := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previous })
}

func TestDisposableSettingsRowIsCreatedReadAndItsProblemReported(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	useBackendDB(t, db)
	ctx := context.Background()

	if _, err := LoadSettings(ctx, db); err != nil {
		t.Fatalf("load without a row: %v", err)
	}
	var valueType int
	var description string
	if err := db.QueryRow(`SELECT value_type, creation_spec FROM system_config WHERE key = $1`, SettingsConfigKey).Scan(&valueType, &description); err != nil {
		t.Fatalf("read the created row: %v", err)
	}
	if valueType != settingsValueType || description != settingsCreationSpec {
		t.Fatalf("created row type %d, description %q; want the JSON editor and the shared description", valueType, description)
	}

	mediaCheckExec(t, db, `UPDATE system_config SET json_value = '[1, 2]'::jsonb WHERE key = $1`, SettingsConfigKey)
	if _, err := LoadSettings(ctx, db); !errors.Is(err, ErrSettingsProblem) {
		t.Fatalf("load of an array = %v, want ErrSettingsProblem", err)
	}
	recorder := httptest.NewRecorder()
	AdminMissingMediaCheckHandler(recorder, httptest.NewRequest(http.MethodGet, "/api/admin/missing-media-check", nil))
	var status statusResponse
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &status) != nil {
		t.Fatalf("GET = %d %s, want 200 with the defaults", recorder.Code, recorder.Body.String())
	}
	if status.SettingsProblem == "" || status.Settings != DefaultSettings() || len(status.Limits) != len(settingLimits) || len(status.SamplingMethods) != 2 {
		t.Fatalf("status = %+v, want the defaults, the problem, the limits and the sampling methods", status)
	}

	recorder = httptest.NewRecorder()
	AdminMissingMediaCheckHandler(recorder, httptest.NewRequest(http.MethodPost, "/api/admin/missing-media-check", strings.NewReader(`{"action":"run"}`)))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"reason":"settings_problem"`) {
		t.Fatalf("POST run = %d %s, want 200 refusing to run on unreadable settings", recorder.Code, recorder.Body.String())
	}

	saved, err := SaveSettings(ctx, db, checkSettings(func(s *Settings) { s.RunOnStartup = true }))
	if err != nil || !saved.RunOnStartup {
		t.Fatalf("save = %+v, %v; want the stored value replaced", saved, err)
	}
	if reloaded, err := LoadSettings(ctx, db); err != nil || !reloaded.RunOnStartup {
		t.Fatalf("reload = %+v, %v; want the saved value", reloaded, err)
	}
}

func TestDisposableFailedAndCrashedRunsAreStored(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	useBackendDB(t, db)
	previous := runCheck
	t.Cleanup(func() { runCheck = previous })
	identity := RunIdentity{AppVersion: "9.3.19", DBVersion: "9.9.2", BuildID: "test"}

	runCheck = func(ctx context.Context, input CheckInput) (Result, error) {
		return newResult(input.Settings, input, time.Now().UTC()), errors.New("list file upload relations: gone")
	}
	runAndStore(DefaultSettings(), TriggerUpdate, identity)
	stored, found, err := LoadLastResult(context.Background(), db)
	if err != nil || !found || !stored.Failed || stored.Trigger != TriggerUpdate || stored.DBVersion != "9.9.2" ||
		fmt.Sprint(stored.Errors) != "[list file upload relations: gone]" {
		t.Fatalf("stored = %+v (%v, %v), want the failed update run with its reason and versions", stored, found, err)
	}

	runCheck = func(ctx context.Context, input CheckInput) (Result, error) {
		panic("storage vanished")
	}
	runAndStore(DefaultSettings(), TriggerManual, identity)
	stored, _, err = LoadLastResult(context.Background(), db)
	if err != nil || !stored.Failed || stored.Trigger != TriggerManual || !strings.Contains(fmt.Sprint(stored.Errors), "storage vanished") {
		t.Fatalf("stored = %+v (%v), want the crashed run stored as failed", stored, err)
	}
}
