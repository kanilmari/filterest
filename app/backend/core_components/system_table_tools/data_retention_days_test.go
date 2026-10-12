// data_retention_days_test.go
// Checks day durations, legacy years and the log deletion safety boundary.
// Connects retention JSON and the shared duration rule to generated queries.
// Refuses ambiguous durations and unconfigured targets without a live database.
package system_table_tools

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestDataRetentionDaysAndLegacyYears(t *testing.T) {
	location, err := time.LoadLocation("Europe/Helsinki")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 4, 28, 12, 30, 0, 123456000, location)
	for _, duration := range []string{
		`"mode":"rolling_days","keep_days":90`,
		`"mode":"rolling_years","keep_years":3`,
		`"mode":"calendar_years_plus_current","keep_years":3`,
	} {
		policies, err := parseDataRetentionPolicies([]byte(`[{"name":"audit","table_name":"system_audit_log","timestamp_column":"created_at",` + duration + `}]`))
		if err != nil {
			t.Fatal(duration, err)
		}
		cutoff := resolveDataRetentionPolicyCutoff(policies[0], now)
		if policies[0].Mode == dataRetentionModeRollingDays && !cutoff.Equal(now.Add(-90*24*time.Hour)) {
			t.Fatal("days must measure elapsed time across DST", cutoff)
		}
		if policies[0].Mode == dataRetentionModeRollingYears && !cutoff.Equal(now.In(time.Local).AddDate(-3, 0, 0)) {
			t.Fatal("legacy rolling years changed", cutoff)
		}
	}
	for _, duration := range []string{
		`"mode":"rolling_days"`, `"mode":"rolling_days","keep_days":0`,
		`"mode":"rolling_days","keep_days":-1`, `"mode":"rolling_days","keep_days":1.5`,
		`"mode":"rolling_days","keep_days":106752`,
		`"mode":"rolling_days","keep_days":90,"keep_years":1`,
		`"mode":"rolling_years","keep_years":1,"keep_days":90`,
		`"mode":"calendar_years_plus_current","keep_days":90`,
		`"mode":"rolling_days","keep_days":"90"`,
	} {
		_, err := parseDataRetentionPolicies([]byte(`[{"name":"audit","table_name":"system_audit_log","timestamp_column":"created_at",` + duration + `}]`))
		if err == nil {
			t.Fatal("invalid duration accepted", duration)
		}
	}
}

func TestDataRetentionLogAllowlistAndActiveRunSafety(t *testing.T) {
	for _, table := range defaultLogRetentionTableOrder {
		_, allowed := dataRetentionTableSpecs[table]
		if allowed != (table != "deletion_log") {
			t.Fatal("unexpected automatic history target", table)
		}
	}
	where, args := buildGenericDataRetentionWhereClause(dataRetentionPolicy{TableName: "dev_agent_task_runs", TimestampColumn: "started_at"}, time.Now())
	if !strings.Contains(where, `"started_at" < $1`) || !strings.Contains(where, "status IN ('succeeded', 'failed', 'canceled') AND finished_at < $1") || len(args) != 1 {
		t.Fatal("active work or recent completion can expire", where, args)
	}
	for _, table := range []string{"system_users", "deletion_log", `system_audit_log"; DROP TABLE system_users; --`} {
		_, err := normalizeDataRetentionPolicy(dataRetentionPolicyConfig{Name: "bad", TableName: table, TimestampColumn: "created_at", Mode: dataRetentionModeRollingDays, KeepDays: 90})
		if err == nil {
			t.Fatal("unapproved table accepted", table)
		}
	}
	db, state := openDataRetentionMockDB(t, nil)
	_, err := runDataRetentionAt(db, []dataRetentionPolicy{{Name: "bad", Enabled: true, TableName: "system_users", TimestampColumn: "created_at", Mode: dataRetentionModeRollingDays, KeepDays: 90}}, false, time.Now())
	if err == nil || len(state.calls) != 0 || len(state.execs) != 0 {
		t.Fatal("internal execution bypassed allowlist", fmt.Sprint(err))
	}
	_, err = runDataRetentionAt(db, []dataRetentionPolicy{{Name: "bad-mode", Enabled: true, TableName: "system_audit_log", TimestampColumn: "created_at", Mode: "ROLLING_DAYS", KeepDays: 90}}, false, time.Now())
	if err == nil || len(state.calls) != 0 || len(state.execs) != 0 {
		t.Fatal("unnormalized mode bypassed the cutoff rule", err)
	}
}

func TestRunLogDataRetentionPreviewAndBoundedPrune(t *testing.T) {
	db, state := openDataRetentionMockDB(t, map[string]int64{"system_audit_log": 1011})
	policy := dataRetentionPolicy{Name: "audit", Enabled: true, TableName: "system_audit_log", TimestampColumn: "created_at", Mode: dataRetentionModeRollingDays, KeepDays: 90}
	now := time.Date(2026, 10, 12, 12, 30, 0, 123456000, time.UTC)
	preview, err := runDataRetentionAt(db, []dataRetentionPolicy{policy}, true, now)
	if err != nil || preview.TotalMatched != 1011 || preview.TotalDeleted != 0 || len(state.execs) != 0 {
		t.Fatal("log preview deleted rows or failed to count", preview, err)
	}
	for _, want := range []int64{1000, 11} {
		response, err := runDataRetentionAt(db, []dataRetentionPolicy{policy}, false, now)
		if err != nil || response.TotalDeleted != want || response.Results[0].KeepDays != 90 {
			t.Fatal("log batch bound or day response changed", response, err)
		}
	}
	for _, call := range state.execs {
		if !strings.Contains(call.query, `"created_at" < $1 LIMIT $2 FOR UPDATE SKIP LOCKED`) || len(call.args) != 2 || call.args[1].Value != int64(1000) {
			t.Fatal("batch lost exact cutoff, row cap or nonblocking locks", call)
		}
		if !call.args[0].Value.(time.Time).Equal(now.Add(-90 * 24 * time.Hour)) {
			t.Fatal("batch cutoff changed", call.args[0])
		}
	}
}
