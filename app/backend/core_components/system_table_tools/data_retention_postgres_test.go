// data_retention_postgres_test.go
// Proves public defaults, first-upgrade preservation and bounded exact deletion.
// Uses the existing opt-in disposable PostgreSQL fixture and public bootstrap.
// Never reads credentials or connects to an operator's database.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"github.com/lib/pq"
)

const logRetentionMigrationFile = "20261009000083_add_automatic_log_retention.sql"

func TestAutomaticLogRetentionPostgresFreshUpgrade90DaysBoundedAndReplay(t *testing.T) {
	for _, upgrade := range []bool{false, true} {
		name := "fresh"
		if upgrade {
			name = "upgraded-private-settings"
		}
		t.Run(name, func(t *testing.T) {
			db := frontPageDisposableDB(t)
			oldLifecycle := backend.DbLifecycle
			backend.DbLifecycle = db
			t.Cleanup(func() { backend.DbLifecycle = oldLifecycle })
			if upgrade {
				// The first two names force the generated transaction policy to
				// choose -3. Non-canonical metadata has a separate untouched proof.
				legacy := `[
				 {"name":"log-retention-system_transaction_log","table_name":"regfetch_conversations","timestamp_column":"updated_at","mode":"rolling_years","keep_years":2},
				 {"name":"\tLOG-RETENTION-SYSTEM_TRANSACTION_LOG-2\t","table_name":"ai_chat_conversations","timestamp_column":"updated_at","mode":"rolling_days","keep_days":30,"enabled":false},
				 {"name":"private-audit","table_name":"\tSYSTEM_AUDIT_LOG\r\n","timestamp_column":"created_at","mode":"rolling_days","keep_days":180,"enabled":false},
				 {"name":"long-system-log","table_name":"\u00a0SYSTEM_LOG\u202f","timestamp_column":"created","mode":"rolling_years","keep_years":2},
				 {"name":"short-usage","table_name":"\u0085AI_USAGE_LOGS\u3000","timestamp_column":"created_at","mode":"rolling_days","keep_days":30}
				]`
				frontPageExec(t, db, `DELETE FROM system_config WHERE key IN ('automatic_data_retention_enabled','data_retention_policies');
				 DELETE FROM system_data_repair_records WHERE migration='t750_automatic_log_retention';
				 DELETE FROM system_schema_migrations WHERE filename='20261009000083_add_automatic_log_retention.sql';
				 DROP INDEX IF EXISTS idx_retention_system_audit_log;
				 DROP INDEX IF EXISTS idx_retention_system_transaction_log;
				 DROP INDEX IF EXISTS idx_retention_dev_agent_task_runs;
				 INSERT INTO system_config(key,boolean_value,value_type) VALUES('automatic_data_retention_enabled',false,2);`)
				if _, err := db.Exec(`INSERT INTO system_config(key,json_value,value_type) VALUES('data_retention_policies',$1,5)`, legacy); err != nil {
					t.Fatal(err)
				}
				frontPageExec(t, db, `CREATE TABLE public.regfetch_conversations(id bigint PRIMARY KEY,updated_at timestamptz);
				 INSERT INTO public.regfetch_conversations VALUES(1,now()),(2,now()-interval '3 years');`)
			}
			// Capture the real JSON BEFORE the FIRST migration, not after it.
			originalJSON := readLogRetentionPolicyJSON(t, db)
			originalPolicies, err := parseDataRetentionPolicies(originalJSON)
			if err != nil {
				t.Fatal("pre-upgrade configuration must be valid", err)
			}
			if !upgrade {
				assertLogRetentionDefaults(t, db, nil)
			}
			frontPageExec(t, db, logRetentionMigration(t))
			firstJSON := readLogRetentionPolicyJSON(t, db)
			assertOriginalRetentionEntriesPreserved(t, originalJSON, firstJSON)
			assertLogRetentionDefaults(t, db, originalPolicies)
			for i := 0; i < 2; i++ {
				frontPageExec(t, db, logRetentionMigration(t))
				if string(firstJSON) != string(readLogRetentionPolicyJSON(t, db)) {
					t.Fatal("migration replay changed JSON")
				}
			}
			enabled, err := isAutomaticDataRetentionEnabled(db)
			if err != nil || enabled == upgrade {
				t.Fatal("automatic setting/default or explicit opt-out changed", enabled, err)
			}
			if upgrade {
				policies, err := loadDataRetentionPolicies(db)
				if err != nil {
					t.Fatal("valid configuration became invalid", err)
				}
				for _, policy := range policies {
					if policy.TableName == "system_transaction_log" && policy.Name != "log-retention-system_transaction_log-3" {
						t.Fatal("generated policy name did not avoid all collisions", policy)
					}
				}
			}
			testAutomaticLogRetentionCutoffAndLocks(t, db, upgrade)
		})
	}
	t.Run("every-reader-whitespace-and-case", testLogRetentionUpgradeWhitespaceParity)
	t.Run("reader-compatible-configurations", testLogRetentionMigrationReaderCompatibilityPostgres)
}

func readLogRetentionPolicyJSON(t *testing.T, db *sql.DB) []byte {
	t.Helper()
	var raw []byte
	if err := db.QueryRow(`SELECT json_value::text FROM system_config WHERE key='data_retention_policies'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

func assertOriginalRetentionEntriesPreserved(t *testing.T, before, after []byte) {
	t.Helper()
	var original, migrated []json.RawMessage
	if err := json.Unmarshal(before, &original); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(after, &migrated); err != nil {
		t.Fatal(err)
	}
	if len(migrated) < len(original) || !reflect.DeepEqual(original, migrated[:len(original)]) {
		t.Fatalf("first migration changed original JSON entries:\nbefore: %s\nafter: %s", before, after)
	}
}

func assertLogRetentionDefaults(t *testing.T, db *sql.DB, original []dataRetentionPolicy) {
	t.Helper()
	for _, key := range []string{automaticDataRetentionEnabledConfigKey, dataRetentionPoliciesConfigKey} {
		if count := frontPageCount(t, db, `SELECT count(*) FROM system_config WHERE key='`+key+`'`); count != 1 {
			t.Fatal("duplicate/missing configuration", key, count)
		}
	}
	policies, err := loadDataRetentionPolicies(db)
	if err != nil {
		t.Fatal("post-upgrade configuration must be valid", err)
	}
	existing := map[string]dataRetentionPolicy{}
	for _, policy := range original {
		existing[policy.TableName] = policy
	}
	counts := map[string]int{}
	for _, policy := range policies {
		if old, found := existing[policy.TableName]; found {
			if !reflect.DeepEqual(policy, old) {
				t.Fatal("operator policy changed", policy, old)
			}
		} else if !policy.Enabled || policy.Mode != dataRetentionModeRollingDays || policy.KeepDays != 90 {
			t.Fatal("wrong public log default", policy)
		}
		counts[policy.TableName]++
	}
	for _, table := range defaultLogRetentionTableOrder {
		want := 1
		if table == "deletion_log" {
			want = 0
		}
		if counts[table] != want {
			t.Fatal("unexpected log policies", table, counts[table])
		}
	}
}

func testLogRetentionUpgradeWhitespaceParity(t *testing.T) {
	db := frontPageDisposableDB(t)
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	for _, whitespace := range readerTrimmedWhitespace() {
		// Exercise disabled, two-year and thirty-day policies, plus a generated
		// name collision for a missing table, with each of Go's whitespace runes.
		disabled := false
		cfg := []dataRetentionPolicyConfig{
			{Name: "disabled", Enabled: &disabled, TableName: string(whitespace) + "SYSTEM_AUDIT_LOG" + string(whitespace), TimestampColumn: "created_at", Mode: dataRetentionModeRollingYears, KeepYears: 2},
			{Name: "long", TableName: string(whitespace) + "SYSTEM_TRANSACTION_LOG" + string(whitespace), TimestampColumn: "created_at", Mode: dataRetentionModeRollingYears, KeepYears: 2},
			{Name: "short", TableName: string(whitespace) + "AI_USAGE_LOGS" + string(whitespace), TimestampColumn: "created_at", Mode: dataRetentionModeRollingDays, KeepDays: 30},
			{Name: string(whitespace) + "LOG-RETENTION-SYSTEM_LOG" + string(whitespace), TableName: "regfetch_conversations", TimestampColumn: "updated_at", Mode: dataRetentionModeRollingYears, KeepYears: 2},
		}
		raw, err := json.Marshal(cfg)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`UPDATE system_config SET json_value=$1 WHERE key='data_retention_policies'`, raw); err != nil {
			t.Fatal(err)
		}
		before := readLogRetentionPolicyJSON(t, db)
		original, err := parseDataRetentionPolicies(before)
		if err != nil {
			t.Fatal("valid original required", err)
		}
		if _, err := conn.ExecContext(context.Background(), logRetentionMigration(t)); err != nil {
			t.Fatal(err)
		}
		after := readLogRetentionPolicyJSON(t, db)
		assertOriginalRetentionEntriesPreserved(t, before, after)
		assertLogRetentionDefaults(t, db, original)
		// Use the very SQL function the migration invokes, on its own session.
		for _, identity := range []string{"SYSTEM_AUDIT_LOG", "SYSTEM_AUDİT_LOG", "DEV_AGENT_TASK_RUNS", "LOG-RETENTION-SYSTEM_LOG"} {
			value := string(whitespace) + identity + string(whitespace)
			var normalized string
			if err := conn.QueryRowContext(context.Background(), `SELECT pg_temp.normalize_data_retention_identity($1)`, value).Scan(&normalized); err != nil || normalized != normalizeDataRetentionIdentity(value) {
				t.Fatalf("SQL/reader normalization differs at U+%04X for %q: %q, %v", whitespace, identity, normalized, err)
			}
		}
		if _, err := conn.ExecContext(context.Background(), logRetentionMigration(t)); err != nil {
			t.Fatal(err)
		}
		if string(after) != string(readLogRetentionPolicyJSON(t, db)) {
			t.Fatal("whitespace upgrade replay changed JSON")
		}
	}
}

func testLogRetentionMigrationReaderCompatibilityPostgres(t *testing.T) {
	db := frontPageDisposableDB(t)
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	var notices []string
	if err := conn.Raw(func(connection any) error {
		pq.SetNoticeHandler(connection.(driver.Conn), func(notice *pq.Error) {
			notices = append(notices, notice.Message)
		})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range retentionMigrationCompatibilityFixtures() {
		t.Run(fixture.name, func(t *testing.T) {
			// Install each fixture before its FIRST upgrade. The bootstrap's
			// completed marker must not stand in for proof of this upgrade.
			frontPageExec(t, db, `DELETE FROM system_data_repair_records WHERE migration='t750_automatic_log_retention';
			 DELETE FROM system_schema_migrations WHERE filename='20261009000083_add_automatic_log_retention.sql';`)
			var value any = fixture.raw
			if fixture.sqlNull {
				value = nil
			}
			if _, err := db.Exec(`UPDATE system_config SET json_value=$1 WHERE key='data_retention_policies'`, value); err != nil {
				t.Fatal(err)
			}
			before := readLogRetentionPolicyJSON(t, db)
			original, beforeErr := parseDataRetentionPolicies(before)
			if (beforeErr == nil) != fixture.accepted {
				t.Fatal("unexpected pre-upgrade reader acceptance", beforeErr)
			}
			for replay := 0; replay < 3; replay++ {
				notices = nil
				if _, err := conn.ExecContext(context.Background(), logRetentionMigration(t)); err != nil {
					t.Fatal("migration must tolerate non-canonical settings", err)
				}
				var canonical bool
				if err := conn.QueryRowContext(context.Background(), `SELECT pg_temp.data_retention_policies_are_canonical($1::jsonb)`, value).Scan(&canonical); err != nil || canonical != fixture.canonical {
					t.Fatal("SQL canonical predicate disagrees with reader fixture", canonical, err)
				}
				after := readLogRetentionPolicyJSON(t, db)
				if !fixture.canonical {
					if !reflect.DeepEqual(before, after) {
						t.Fatalf("non-canonical setting changed bytes on pass %d:\nbefore: %s\nafter: %s", replay, before, after)
					}
					if !strings.Contains(strings.Join(notices, "\n"), "default log policies were not added") {
						t.Fatal("operator notice missing", notices)
					}
					parsed, afterErr := parseDataRetentionPolicies(after)
					if (afterErr == nil) != (beforeErr == nil) || !reflect.DeepEqual(parsed, original) {
						t.Fatal("migration changed reader acceptance or policies", parsed, afterErr)
					}
				} else if replay == 0 {
					assertOriginalRetentionEntriesPreserved(t, before, after)
					assertLogRetentionDefaults(t, db, original)
					before = after
				} else if !reflect.DeepEqual(before, after) {
					t.Fatal("canonical replay changed bytes")
				}
				if count := frontPageCount(t, db, `SELECT count(*) FROM system_data_repair_records WHERE migration='t750_automatic_log_retention' AND action='completed'`); count != 1 {
					t.Fatal("upgrade/replay lost completion marker", count)
				}
			}
		})
	}
}

func retentionTableSnapshot(t *testing.T, db *sql.DB, table string) string {
	t.Helper()
	var rows string
	query := `SELECT COALESCE(jsonb_agg(to_jsonb(retained) ORDER BY to_jsonb(retained)::text),'[]')::text FROM public.` + table + ` AS retained`
	if err := db.QueryRow(query).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	return rows
}

func testAutomaticLogRetentionCutoffAndLocks(t *testing.T, db *sql.DB, globallyDisabled bool) {
	t.Helper()
	now := time.Date(2026, 10, 12, 12, 30, 0, 123456000, time.UTC)
	cutoff := now.Add(-90 * 24 * time.Hour)
	policies, err := loadDataRetentionPolicies(db)
	if err != nil {
		t.Fatal(err)
	}
	byTable := map[string]dataRetentionPolicy{}
	for _, policy := range policies {
		byTable[policy.TableName] = policy
	}
	for table, column := range map[string]string{"system_log": "created", "ai_usage_logs": "created_at", "mcp_query_log": "created_at"} {
		frontPageExec(t, db, `CREATE TABLE public.`+table+`(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,`+column+` timestamptz)`)
		policyCutoff := resolveDataRetentionPolicyCutoff(byTable[table], now)
		if _, err := db.Exec(`INSERT INTO public.`+table+`(`+column+`) VALUES($1),($2),($3),(NULL)`, policyCutoff.Add(-time.Microsecond), policyCutoff, policyCutoff.Add(time.Microsecond)); err != nil {
			t.Fatal(err)
		}
	}
	var taskID int
	if err := db.QueryRow(`INSERT INTO dev_agent_tasks(title,status,content) VALUES('retention fixture','new','fixture') RETURNING id`).Scan(&taskID); err != nil {
		t.Fatal(err)
	}
	var wantRunIDs []string
	insertRun := func(id, status string, started time.Time, finished any, survives bool) {
		t.Helper()
		if _, err := db.Exec(`INSERT INTO dev_agent_task_runs(run_id,task_id,triggered_by,status,started_at,finished_at) VALUES($1,$2,'manual',$3,$4,$5)`, id, taskID, status, started, finished); err != nil {
			t.Fatal(err)
		}
		if survives {
			wantRunIDs = append(wantRunIDs, id)
		}
	}
	for _, status := range []string{"queued", "running", "awaiting_review", "succeeded", "failed", "canceled"} {
		terminal := status == "succeeded" || status == "failed" || status == "canceled"
		insertRun(status, status, cutoff.Add(-time.Microsecond), cutoff.Add(-time.Microsecond), !terminal)
		if terminal {
			insertRun(status+"-empty-finish", status, cutoff.Add(-time.Hour), nil, true)
			insertRun(status+"-start-at-cutoff", status, cutoff, cutoff.Add(-time.Hour), true)
			insertRun(status+"-finish-at-cutoff", status, cutoff.Add(-time.Hour), cutoff, true)
			insertRun(status+"-both-at-cutoff", status, cutoff, cutoff, true)
			insertRun(status+"-recent-finish", status, cutoff.Add(-time.Hour), cutoff.Add(time.Microsecond), true)
		}
	}
	for _, table := range []string{"system_audit_log", "system_transaction_log"} {
		query := `INSERT INTO system_audit_log(created_at,handler_name,http_method,url_path) SELECT $1,'fixture','GET','/fixture' FROM generate_series(1,1002)`
		if table == "system_transaction_log" {
			query = `INSERT INTO system_transaction_log(created_at,method,success) SELECT $1,'GET',true FROM generate_series(1,1002)`
		}
		policyCutoff := resolveDataRetentionPolicyCutoff(byTable[table], now)
		for _, instant := range []time.Time{policyCutoff.Add(-time.Microsecond), policyCutoff, policyCutoff.Add(time.Microsecond)} {
			if _, err := db.Exec(query, instant); err != nil {
				t.Fatal(err)
			}
		}
	}
	frontPageExec(t, db, `CREATE TABLE public.retention_unconfigured(id int,created_at timestamptz);
	 INSERT INTO public.retention_unconfigured VALUES(1,now()-interval '10 years');
	 INSERT INTO public.deletion_log(table_name,record_id,deleted_at) VALUES('fixture','1',now()-interval '10 years');`)
	if globallyDisabled {
		tables := append([]string{"retention_unconfigured", "regfetch_conversations"}, defaultLogRetentionTableOrder...)
		before := map[string]string{}
		for _, table := range tables {
			before[table] = retentionTableSnapshot(t, db, table)
		}
		if err := runDrainedDataRetentionPassAt(context.Background(), db, now); err != nil {
			t.Fatal(err)
		}
		for _, table := range tables {
			if retentionTableSnapshot(t, db, table) != before[table] {
				t.Fatal("globally disabled round changed rows", table)
			}
		}
		frontPageExec(t, db, `UPDATE system_config SET boolean_value=true WHERE key='automatic_data_retention_enabled'`)
	}
	batchPolicy := byTable["system_transaction_log"]
	preview, err := runDataRetentionAt(db, []dataRetentionPolicy{batchPolicy}, true, now)
	if err != nil || preview.TotalMatched != 1002 || preview.TotalDeleted != 0 {
		t.Fatal("preview mutated history or missed exact cutoff", preview, err)
	}
	locked, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer locked.Rollback()
	var lockedID int
	if err := locked.QueryRow(`SELECT id FROM system_transaction_log WHERE created_at < $1 LIMIT 1 FOR UPDATE`, cutoff).Scan(&lockedID); err != nil {
		t.Fatal(err)
	}
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	deleted, err := runAutomaticDataRetentionBatch(context.Background(), conn, batchPolicy, now)
	if err != nil || deleted != dataRetentionLogBatchSize {
		t.Fatal("batch did not respect row bound/skip locks", deleted, err)
	}
	deleted, err = runAutomaticDataRetentionBatch(context.Background(), conn, batchPolicy, now)
	if err != nil || deleted != 1 {
		t.Fatal("locked old row was deleted or new row crossed cutoff", deleted, err)
	}
	if err := locked.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := runDrainedDataRetentionPassAt(context.Background(), db, now); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"system_log", "ai_usage_logs", "mcp_query_log"} {
		if got := frontPageCount(t, db, `SELECT count(*) FROM public.`+table+` WHERE id IN (2,3,4)`); got != 3 || frontPageCount(t, db, `SELECT count(*) FROM public.`+table) != 3 {
			t.Fatal("optional log cutoff/null identities lost", table, got)
		}
	}
	var survivingRuns string
	if err := db.QueryRow(`SELECT COALESCE(string_agg(run_id,',' ORDER BY run_id),'') FROM dev_agent_task_runs`).Scan(&survivingRuns); err != nil {
		t.Fatal(err)
	}
	actual := strings.Split(survivingRuns, ",")
	// compare sets via a map so the fixture's insertion order is irrelevant.
	want := map[string]bool{}
	for _, id := range wantRunIDs {
		want[id] = true
	}
	if len(actual) != len(want) {
		t.Fatal("wrong surviving run identities", actual, want)
	}
	for _, id := range actual {
		if !want[id] {
			t.Fatal("wrong surviving run identity", id, want)
		}
	}
	for _, table := range []string{"system_audit_log", "system_transaction_log"} {
		wantCount := 2004
		if !byTable[table].Enabled {
			wantCount = 3006
		}
		if got := frontPageCount(t, db, `SELECT count(*) FROM public.`+table); got != wantCount {
			t.Fatal("disabled history or cutoff boundary changed", table, got, wantCount)
		}
	}
	for _, table := range []string{"retention_unconfigured", "deletion_log"} {
		if count := frontPageCount(t, db, `SELECT count(*) FROM public.`+table); count != 1 {
			t.Fatal("unconfigured content/tombstones changed", table, count)
		}
	}
}
