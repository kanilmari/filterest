// row_policy_owner_resolver_test.go
// Locks the fail-closed row-owner rule and the metadata that carries it to the browser.
// Uses the package's queued read-only SQL driver, so every expected query is named in order.
// Exists because an owner guessed from column names once let row id = user id grant access.
package dtt_1_row_read

import (
	"bytes"
	"database/sql/driver"
	"log"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
)

func ownerFlagColumns(columns ...string) storageAuthorizationQueuedQuery {
	rows := make([][]driver.Value, 0, len(columns))
	for _, column := range columns {
		rows = append(rows, []driver.Value{column})
	}
	return storageAuthorizationQueuedQuery{
		contains: "must_be_true_unless_own = true",
		columns:  []string{"column_name"},
		rows:     rows,
	}
}

func ownerSettingColumnExists(exists bool) storageAuthorizationQueuedQuery {
	return storageAuthorizationQueuedQuery{
		contains: "information_schema.columns",
		columns:  []string{"exists"},
		rows:     [][]driver.Value{{exists}},
	}
}

func ownerSetting(value driver.Value) storageAuthorizationQueuedQuery {
	return storageAuthorizationQueuedQuery{
		contains: "SELECT row_policy_owner_column",
		columns:  []string{"row_policy_owner_column"},
		rows:     [][]driver.Value{{value}},
	}
}

func ownerUserForeignKeys(columns ...string) storageAuthorizationQueuedQuery {
	rows := make([][]driver.Value, 0, len(columns))
	for _, column := range columns {
		rows = append(rows, []driver.Value{column})
	}
	return storageAuthorizationQueuedQuery{
		contains: "FROM pg_catalog.pg_constraint",
		columns:  []string{"attname"},
		rows:     rows,
	}
}

// captureOwnerWarnings redirects the standard logger for one test and forgets
// earlier reports, because each refusal is otherwise logged once per process.
func captureOwnerWarnings(t *testing.T) *bytes.Buffer {
	t.Helper()
	reportedRowPolicyOwnerRefusals.Range(func(reportKey, _ interface{}) bool {
		reportedRowPolicyOwnerRefusals.Delete(reportKey)
		return true
	})
	var buffer bytes.Buffer
	previousOutput := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&buffer)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousOutput)
		log.SetFlags(previousFlags)
	})
	return &buffer
}

func TestResolveRowPolicyOwnerColumnAcceptsNamedForeignKeyFromSystemCatalog(t *testing.T) {
	warnings := captureOwnerWarnings(t)
	db, state := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		ownerSettingColumnExists(true),
		ownerSetting("created_by"),
		ownerUserForeignKeys("created_by", "editor_id"),
	})

	owner, err := resolveRowPolicyOwnerColumn(db, "wl58_accepted_notes")
	if err != nil {
		t.Fatalf("resolveRowPolicyOwnerColumn returned error: %v", err)
	}
	if owner != "created_by" {
		t.Fatalf("owner = %q, want the named, validated created_by", owner)
	}
	assertStorageAuthorizationQueriesDrained(t, state)
	if warnings.Len() != 0 {
		t.Fatalf("an accepted owner logged a warning: %s", warnings.String())
	}
}

func TestResolveRowPolicyOwnerColumnRefusesNamedNonForeignKeyAndWarnsOnce(t *testing.T) {
	warnings := captureOwnerWarnings(t)
	for attempt := 0; attempt < 2; attempt++ {
		db, state := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
			ownerSettingColumnExists(true),
			ownerSetting("user_id"),
			ownerUserForeignKeys(),
		})
		owner, err := resolveRowPolicyOwnerColumn(db, "wl58_refused_notes")
		if err != nil {
			t.Fatalf("attempt %d: resolveRowPolicyOwnerColumn returned error: %v", attempt, err)
		}
		if owner != "" {
			t.Fatalf("attempt %d: owner = %q, want no own-row exception for a column without a user foreign key", attempt, owner)
		}
		assertStorageAuthorizationQueriesDrained(t, state)
	}

	logged := warnings.String()
	if strings.Count(logged, "dataset wl58_refused_notes has no proven row owner") != 1 {
		t.Fatalf("warnings = %q, want exactly one warning for a repeated configuration", logged)
	}
	if !strings.Contains(logged, `"user_id" is not a validated single-column foreign key to system_users(id)`) {
		t.Fatalf("warning = %q, want it to name the refused column and the reason", logged)
	}
}

func TestResolveRowPolicyOwnerColumnWithoutSettingSkipsForeignKeyLookup(t *testing.T) {
	warnings := captureOwnerWarnings(t)
	db, state := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		ownerSettingColumnExists(true),
		ownerSetting(nil),
	})

	owner, err := resolveRowPolicyOwnerColumn(db, "wl58_unnamed_notes")
	if err != nil {
		t.Fatalf("resolveRowPolicyOwnerColumn returned error: %v", err)
	}
	if owner != "" {
		t.Fatalf("owner = %q, want none when no owner is named", owner)
	}
	assertStorageAuthorizationQueriesDrained(t, state)
	if !strings.Contains(warnings.String(), "dataset wl58_unnamed_notes has no proven row owner: "+rowOwnerRefusalNoneNamed) {
		t.Fatalf("warnings = %q, want the administrator told that no owner is named", warnings.String())
	}
}

// A database that predates the setting names no owner; it no longer falls back.
func TestResolveRowPolicyOwnerColumnOnSchemaWithoutSettingNamesNoOwner(t *testing.T) {
	captureOwnerWarnings(t)
	db, state := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		ownerSettingColumnExists(false),
	})

	owner, err := resolveRowPolicyOwnerColumn(db, "wl58_old_schema_notes")
	if err != nil || owner != "" {
		t.Fatalf("resolveRowPolicyOwnerColumn() = (%q, %v), want no owner and no error", owner, err)
	}
	assertStorageAuthorizationQueriesDrained(t, state)
}

// A nil querier proves the built-in owners are fixed in code and read nothing.
func TestResolveRowPolicyOwnerColumnBuiltInOwnersReadNoMetadata(t *testing.T) {
	for tableName, want := range map[string]string{"system_users": "id", rlsPilotTableName: rlsPilotOwnerColumn} {
		owner, err := resolveRowPolicyOwnerColumn(nil, tableName)
		if err != nil || owner != want {
			t.Fatalf("resolveRowPolicyOwnerColumn(%s) = (%q, %v), want %q", tableName, owner, err, want)
		}
	}
}

func TestGetLegacyMustTrueReadPolicyKeepsOwnerOnlyWhenProven(t *testing.T) {
	captureOwnerWarnings(t)
	t.Run("validated foreign key", func(t *testing.T) {
		db, state := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
			ownerFlagColumns("published"),
			ownerSettingColumnExists(true),
			ownerSetting("user_id"),
			ownerUserForeignKeys("user_id"),
		})
		policy, err := getLegacyMustTrueReadPolicy(db, "wl58_policy_notes")
		if err != nil {
			t.Fatalf("getLegacyMustTrueReadPolicy returned error: %v", err)
		}
		assertStorageAuthorizationQueriesDrained(t, state)
		condition, args := buildReadRowPolicyCondition("wl58_policy_notes", "basic", 42, policy, 1)
		if !strings.Contains(condition, `("wl58_policy_notes"."published" = TRUE OR "wl58_policy_notes"."user_id" = $1)`) || args[0] != 42 {
			t.Fatalf("condition = %q args = %#v, want the flag-or-owner branch", condition, args)
		}
	})

	t.Run("no foreign key", func(t *testing.T) {
		db, state := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
			ownerFlagColumns("published"),
			ownerSettingColumnExists(true),
			ownerSetting("user_id"),
			ownerUserForeignKeys(),
		})
		policy, err := getLegacyMustTrueReadPolicy(db, "wl58_policy_unproven_notes")
		if err != nil {
			t.Fatalf("getLegacyMustTrueReadPolicy returned error: %v", err)
		}
		assertStorageAuthorizationQueriesDrained(t, state)
		if policy.OwnerColumn != "" || len(policy.FlagColumns) != 1 {
			t.Fatalf("policy = %#v, want the flag without an owner", policy)
		}
		condition, _ := buildReadRowPolicyCondition("wl58_policy_unproven_notes", "basic", 42, policy, 1)
		if strings.Contains(condition, "user_id") || strings.Contains(condition, " OR ") {
			t.Fatalf("condition = %q, want no own-row branch", condition)
		}
	})

	t.Run("system users own themselves", func(t *testing.T) {
		db, state := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
			ownerFlagColumns("enabled"),
		})
		policy, err := getLegacyMustTrueReadPolicy(db, "system_users")
		if err != nil {
			t.Fatalf("getLegacyMustTrueReadPolicy returned error: %v", err)
		}
		assertStorageAuthorizationQueriesDrained(t, state)
		if policy.OwnerColumn != "id" {
			t.Fatalf("system_users owner = %q, want id", policy.OwnerColumn)
		}
	})
}

// The guest and basic connections own no table, so information_schema would
// hide every foreign key from them and the check would silently refuse all.
func TestSystemUsersForeignKeyQueryReadsTheSystemCatalogOnly(t *testing.T) {
	if strings.Contains(systemUsersForeignKeyColumnsQuery, "information_schema") {
		t.Fatal("the foreign-key check must not read information_schema")
	}
	for _, required := range []string{
		"FROM pg_catalog.pg_constraint",
		"JOIN pg_catalog.pg_attribute AS source_column",
		"foreign_key.contype = 'f'",
		"foreign_key.convalidated",
		"cardinality(foreign_key.conkey) = 1",
	} {
		if !strings.Contains(systemUsersForeignKeyColumnsQuery, required) {
			t.Fatalf("foreign-key query is missing %q", required)
		}
	}
}

func TestResolveResultsRowOwnerColumnQueriesOnlyWhenAFieldNeedsIt(t *testing.T) {
	var noQueries dbutils.Querier
	plainTypes := map[string]interface{}{
		"title":   buildColumnDescription(nil),
		"user_id": buildColumnDescription(nil),
	}
	hideUnlessOwnTypes := map[string]interface{}{
		"secret":  buildColumnDescription(map[string]interface{}{"hide_on_bg_crd_if_not_own": true}),
		"user_id": buildColumnDescription(nil),
	}

	owner, err := resolveResultsRowOwnerColumn(noQueries, "system_users", legacyMustTrueReadPolicy([]string{"enabled"}, "id"), plainTypes)
	if err != nil || owner != "id" {
		t.Fatalf("policy with flags: owner = (%q, %v), want the owner the policy already resolved", owner, err)
	}
	owner, err = resolveResultsRowOwnerColumn(noQueries, "wl58_plain_notes", ReadRowPolicy{}, plainTypes)
	if err != nil || owner != "" {
		t.Fatalf("no flags and no hide-unless-own field: owner = (%q, %v), want none and no queries", owner, err)
	}
	owner, err = resolveResultsRowOwnerColumn(noQueries, rlsPilotTableName, ReadRowPolicy{}, hideUnlessOwnTypes)
	if err != nil || owner != rlsPilotOwnerColumn {
		t.Fatalf("pilot hide-unless-own: owner = (%q, %v), want %q", owner, err, rlsPilotOwnerColumn)
	}

	captureOwnerWarnings(t)
	db, state := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		ownerSettingColumnExists(true),
		ownerSetting("user_id"),
		ownerUserForeignKeys("user_id"),
	})
	owner, err = resolveResultsRowOwnerColumn(db, "wl58_hidden_notes", ReadRowPolicy{}, hideUnlessOwnTypes)
	if err != nil || owner != "user_id" {
		t.Fatalf("hide-unless-own field: owner = (%q, %v), want the proven user_id", owner, err)
	}
	assertStorageAuthorizationQueriesDrained(t, state)
}

func TestMarkRowOwnerColumnDescriptionMarksOnlyTheProvenOwner(t *testing.T) {
	if marked, declared := buildColumnDescription(nil)[rowOwnerColumnDescriptionField]; !declared || marked != false {
		t.Fatalf("column description contract must declare %s=false, got %#v (declared %t)", rowOwnerColumnDescriptionField, marked, declared)
	}

	original := map[string]interface{}{
		"title":   buildColumnDescription(nil),
		"user_id": buildColumnDescription(nil),
	}
	marked := markRowOwnerColumnDescription(original, "user_id")

	if marked["user_id"].(map[string]interface{})[rowOwnerColumnDescriptionField] != true {
		t.Fatalf("owner column description = %#v, want %s=true", marked["user_id"], rowOwnerColumnDescriptionField)
	}
	if marked["title"].(map[string]interface{})[rowOwnerColumnDescriptionField] != false {
		t.Fatalf("title description = %#v, want it left unmarked", marked["title"])
	}
	if original["user_id"].(map[string]interface{})[rowOwnerColumnDescriptionField] != false {
		t.Fatal("marking changed the caller's descriptions in place")
	}

	for _, ownerColumn := range []string{"", "created_by"} {
		unchanged := markRowOwnerColumnDescription(original, ownerColumn)
		for columnName, rawDescription := range unchanged {
			if rawDescription.(map[string]interface{})[rowOwnerColumnDescriptionField] != false {
				t.Fatalf("owner %q marked %s, want nothing marked without a delivered owner", ownerColumn, columnName)
			}
		}
	}
}
