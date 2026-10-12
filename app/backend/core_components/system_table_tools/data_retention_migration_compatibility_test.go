// data_retention_migration_compatibility_test.go
// Pins the migration's canonical member list to the reader's actual JSON tags.
// Shares accepted and malformed fixtures with the disposable PostgreSQL proof.
// Prevents upgrades from invalidating retention through alternate member names.
package system_table_tools

import (
	"encoding/json"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

type retentionMigrationFixture struct {
	name      string
	raw       string
	canonical bool
	accepted  bool
	sqlNull   bool
}

func retentionMigrationCompatibilityFixtures() []retentionMigrationFixture {
	return []retentionMigrationFixture{
		{name: "canonical-empty-defaults-appended", raw: `[]`, canonical: true, accepted: true},
		{name: "canonical-content-name-collision-defaults-appended", raw: `[{"name":"log-retention-system_audit_log","table_name":"regfetch_conversations","timestamp_column":"updated_at","mode":"rolling_years","keep_years":2}]`, canonical: true, accepted: true},
		{name: "canonical-disabled-log-preserved", raw: `[{"name":"custom","enabled":false,"table_name":"SYSTEM_AUDIT_LOG","timestamp_column":"created_at","mode":"rolling_days","keep_days":180}]`, canonical: true, accepted: true},
		{name: "canonical-duplicate-member-last-value", raw: `[{"name":"ignored","name":"custom","table_name":"system_audit_log","timestamp_column":"created_at","mode":"rolling_days","keep_days":180}]`, canonical: true, accepted: true},
		{name: "Name-generated-name-collision-untouched", raw: `[{"Name":"log-retention-system_audit_log","table_name":"regfetch_conversations","timestamp_column":"updated_at","mode":"rolling_years","keep_years":2}]`, accepted: true},
		{name: "NAME-generated-name-collision-untouched", raw: `[{"NAME":"log-retention-system_audit_log","table_name":"regfetch_conversations","timestamp_column":"updated_at","mode":"rolling_years","keep_years":2}]`, accepted: true},
		{name: "TABLE_NAME-disabled-log-untouched", raw: `[{"name":"operator","enabled":false,"TABLE_NAME":"\tSYSTEM_AUDIT_LOG\u00a0","timestamp_column":"created_at","mode":"rolling_days","keep_days":180}]`, accepted: true},
		{name: "mixed-case-members-untouched", raw: `[{"nAmE":"operator","EnAbLeD":false,"TaBlE_NaMe":"system_audit_log","TiMeStAmP_CoLuMn":"created_at","mOdE":"rolling_days","kEeP_dAyS":180,"DeScRiPtIoN":"keep custom rules"}]`, accepted: true},
		{name: "Kelvin-sign-member-untouched", raw: `[{"name":"operator","table_name":"system_audit_log","timestamp_column":"created_at","mode":"rolling_days","Keep_days":180}]`, accepted: true},
		{name: "long-s-member-untouched", raw: `[{"name":"operator","table_name":"system_audit_log","timeſtamp_column":"created_at","mode":"rolling_days","keep_days":180}]`, accepted: true},
		{name: "duplicate-case-alias-last-untouched", raw: `[{"name":"unused","Name":"log-retention-system_audit_log","table_name":"regfetch_conversations","timestamp_column":"updated_at","mode":"rolling_years","keep_years":2}]`, accepted: true},
		{name: "duplicate-case-alias-first-untouched", raw: `[{"Name":"log-retention-system_audit_log","name":"unused","table_name":"regfetch_conversations","timestamp_column":"updated_at","mode":"rolling_years","keep_years":2}]`, accepted: true},
		{name: "unknown-operator-metadata-untouched", raw: `[{"name":"operator","table_name":"regfetch_conversations","timestamp_column":"updated_at","mode":"rolling_years","keep_years":2,"operator_metadata":{"keep":"unchanged","Name":"nested"}}]`, accepted: true},
		{name: "mixed-canonical-and-noncanonical-array-untouched", raw: `[{"name":"disabled-audit","enabled":false,"table_name":"system_audit_log","timestamp_column":"created_at","mode":"rolling_days","keep_days":180},{"Name":"log-retention-system_transaction_log","table_name":"regfetch_conversations","timestamp_column":"updated_at","mode":"rolling_years","keep_years":2}]`, accepted: true},
		{name: "non-array-object-untouched", raw: `{"Name":"operator"}`},
		// Syntactically malformed JSON cannot be stored as JSONB. Cover malformed
		// text stored as a JSON string and malformed array entries instead.
		{name: "malformed-json-stored-as-string-untouched", raw: `"[{\"name\":]"`},
		{name: "non-array-number-untouched", raw: `42`},
		{name: "json-null-accepted-untouched", raw: `null`, accepted: true},
		{name: "sql-null-accepted-untouched", accepted: true, sqlNull: true},
		{name: "malformed-null-policy-untouched", raw: `[null]`},
		{name: "malformed-string-policy-untouched", raw: `["policy"]`},
		{name: "malformed-number-policy-untouched", raw: `[42]`},
	}
}

func migrationCanonicalMembers(t *testing.T) map[string]bool {
	t.Helper()
	// Extract the actual SQL allowlist: this test cannot pass on a second,
	// independently maintained list of canonical names.
	expression := regexp.MustCompile(`WHERE member\.name COLLATE "C" NOT IN \(([^)]+)\)`)
	match := expression.FindStringSubmatch(logRetentionMigration(t))
	if match == nil {
		t.Fatal("canonical SQL member predicate changed; update its contract proof")
	}
	members := map[string]bool{}
	for _, literal := range regexp.MustCompile(`'([^']+)'`).FindAllStringSubmatch(match[1], -1) {
		if members[literal[1]] {
			t.Fatal("duplicate migration member", literal[1])
		}
		members[literal[1]] = true
	}
	return members
}

func TestLogRetentionMigrationCanonicalMemberContractMatchesReader(t *testing.T) {
	readerMembers := map[string]bool{}
	config := reflect.TypeFor[dataRetentionPolicyConfig]()
	for i := 0; i < config.NumField(); i++ {
		name := strings.Split(config.Field(i).Tag.Get("json"), ",")[0]
		if name == "" || name == "-" {
			t.Fatal("reader field has no canonical JSON tag", config.Field(i).Name)
		}
		readerMembers[name] = true
	}
	if actual := migrationCanonicalMembers(t); !reflect.DeepEqual(actual, readerMembers) {
		t.Fatalf("migration members %v differ from reader tags %v", actual, readerMembers)
	}
}

func TestLogRetentionMigrationReaderCompatibilityFixtures(t *testing.T) {
	members := migrationCanonicalMembers(t)
	for _, fixture := range retentionMigrationCompatibilityFixtures() {
		t.Run(fixture.name, func(t *testing.T) {
			policies, err := parseDataRetentionPolicies([]byte(fixture.raw))
			if (err == nil) != fixture.accepted {
				t.Fatalf("fixture reader acceptance changed: %v, %v", policies, err)
			}
			// Check fixture shape against the real SQL's member list. Actual
			// predicate execution, migration, byte preservation and replay are
			// asserted with these same fixtures by the PostgreSQL subtests.
			canonical := strings.HasPrefix(strings.TrimSpace(fixture.raw), "[")
			var objects []json.RawMessage
			if canonical && json.Unmarshal([]byte(fixture.raw), &objects) == nil {
				for _, object := range objects {
					var fields map[string]json.RawMessage
					if json.Unmarshal(object, &fields) != nil || fields == nil {
						canonical = false
						break
					}
					for name := range fields {
						if !members[name] {
							canonical = false
						}
					}
				}
			} else {
				canonical = false
			}
			if canonical != fixture.canonical {
				t.Fatal("fixture canonical expectation disagrees with migration members")
			}
		})
	}
}
