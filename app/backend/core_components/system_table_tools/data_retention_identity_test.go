// data_retention_identity_test.go
// Proves migration and reader identity matching share the Unicode boundary.
// Connects the SQL identity rule to actual policy parsing without a database.
// Prevents whitespace, case or competing policies from defeating opt-outs.
package system_table_tools

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"unicode"
)

func logRetentionMigration(t *testing.T) string {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", logRetentionMigrationFile))
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}

func readerTrimmedWhitespace() string {
	var whitespace strings.Builder
	for character := rune(0); character <= unicode.MaxRune; character++ {
		if strings.TrimSpace(string(character)) == "" {
			whitespace.WriteRune(character)
		}
	}
	return whitespace.String()
}

func TestLogRetentionMigrationNormalizationMatchesReader(t *testing.T) {
	// Parse the real SQL literals, rather than repeating a hand-picked subset
	// of whitespace in a test. PostgreSQL execution is covered by the opt-in proof.
	expression := regexp.MustCompile(`SELECT translate\(btrim\(value, ([\s\w()|]+)\),\s*'ABCDEFGHIJKLMNOPQRSTUVWXYZ' \|\| chr\(304\) \|\| chr\(8490\),\s*'([^']+)'\);`)
	match := expression.FindStringSubmatch(logRetentionMigration(t))
	if match == nil {
		t.Fatal("migration identity expression changed; update its parity proof")
	}
	var sqlWhitespace strings.Builder
	for _, codePoint := range regexp.MustCompile(`chr\(([0-9]+)\)`).FindAllStringSubmatch(match[1], -1) {
		value, err := strconv.ParseInt(codePoint[1], 10, 32)
		if err != nil {
			t.Fatal(err)
		}
		sqlWhitespace.WriteRune(rune(value))
	}
	trimSet := sqlWhitespace.String()
	if trimSet != readerTrimmedWhitespace() {
		t.Fatalf("migration whitespace %q differs from reader %q", trimSet, readerTrimmedWhitespace())
	}
	from, to := []rune("ABCDEFGHIJKLMNOPQRSTUVWXYZİK"), []rune(match[2])
	if len(from) != len(to) {
		t.Fatal("invalid SQL case mapping")
	}
	replacements := make(map[rune]rune, len(from))
	for index, character := range from {
		replacements[character] = to[index]
	}
	for character := rune(0); character <= unicode.MaxRune; character++ {
		actual := character
		if replacement, found := replacements[character]; found {
			actual = replacement
		}
		// Only ASCII results can equal an allowlisted table or a generated
		// name. Include non-ASCII characters that lower to ASCII in this proof.
		want := unicode.ToLower(character)
		if (actual < 128 || want < 128) && actual != want {
			t.Fatalf("SQL and reader disagree for U+%04X: %q vs %q", character, actual, want)
		}
	}
	for _, character := range trimSet {
		t.Run(fmt.Sprintf("U+%04X", character), func(t *testing.T) {
			cfg := dataRetentionPolicyConfig{Name: "existing", TableName: string(character) + "SYSTEM_AUDIT_LOG" + string(character), TimestampColumn: "created_at", Mode: dataRetentionModeRollingYears, KeepYears: 2}
			policy, err := normalizeDataRetentionPolicy(cfg)
			if err != nil || policy.TableName != "system_audit_log" {
				t.Fatal("reader did not recognize migration whitespace", policy, err)
			}
		})
	}
}

func TestDataRetentionReaderRefusesDuplicateNormalizedTables(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		for _, whitespace := range readerTrimmedWhitespace() {
			configs := []dataRetentionPolicyConfig{
				{Name: "operator", Enabled: &enabled, TableName: string(whitespace) + "SYSTEM_AUDIT_LOG" + string(whitespace), TimestampColumn: "created_at", Mode: dataRetentionModeRollingYears, KeepYears: 2},
				{Name: "default", TableName: "system_audit_log", TimestampColumn: "created_at", Mode: dataRetentionModeRollingDays, KeepDays: 90},
			}
			raw, err := json.Marshal(configs)
			if err != nil {
				t.Fatal(err)
			}
			policies, err := parseDataRetentionPolicies(raw)
			if err == nil || policies != nil || !strings.Contains(err.Error(), "duplicate policy table") {
				t.Fatalf("competing policies accepted (%v, U+%04X): %v, %v", enabled, whitespace, policies, err)
			}
		}
	}
}
