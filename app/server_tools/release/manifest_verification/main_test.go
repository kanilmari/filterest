// main_test.go
// Exercises the offline Go bridge's migration inspection and failure reporting.
// Connects JSON source bytes to the authoritative startup classifier.
// Proves validation errors cannot emit successful bridge output.
package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"easelect/backend/core_components/migrations"
)

func TestInspectMigrationPoliciesWithoutExecution(t *testing.T) {
	source := []byte("-- skip-on-error\n-- header\nSTART TRANSACTION; SELECT 'fixture'; COMMIT;")
	input, err := json.Marshal(map[string][]byte{"fixture.sql": source})
	if err != nil {
		t.Fatal(err)
	}
	var output, diagnostics bytes.Buffer
	if run([]string{"inspect-migrations"}, bytes.NewReader(input), &output, &diagnostics) != 0 || diagnostics.Len() != 0 {
		t.Fatalf("inspection failed: %s", diagnostics.String())
	}
	var result map[string]migrations.SourceContract
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["fixture.sql"] != migrations.DescribeMigrationSource(source) {
		t.Fatalf("bridge policy differs from runner: %+v", result)
	}
}

func TestBridgeFailureHasNoSuccessOutput(t *testing.T) {
	for _, arguments := range [][]string{{"inspect-migrations"}, {"verify"}, {"validate"}, {"unknown"}} {
		var output, diagnostics bytes.Buffer
		if run(arguments, strings.NewReader("not JSON"), &output, &diagnostics) == 0 || output.Len() != 0 || diagnostics.Len() == 0 {
			t.Fatalf("unexpected success: %v output=%s diagnostics=%s", arguments, output.String(), diagnostics.String())
		}
	}
}
