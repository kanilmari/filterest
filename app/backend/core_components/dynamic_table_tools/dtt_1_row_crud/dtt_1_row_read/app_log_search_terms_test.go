// app_log_search_terms_test.go
// Proves AI diagnostics are private by default and opt-in output stays exact.
// Connects the real search diagnostic printer to an in-memory settings fixture.
// Includes result names because they can themselves repeat the visitor's query.
package dtt_1_row_read

import (
	"database/sql/driver"
	"io"
	"os"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"easelect/backend/core_components/system_config_cache"
)

func TestAISearchDiagnosticsRespectSearchTermSetting(t *testing.T) {
	for _, state := range []string{"off", "on", "missing"} {
		t.Run(state, func(t *testing.T) {
			oldDB := backend.Db
			backend.Db = queryfixture.Open(t, func(string, []driver.NamedValue) (driver.Rows, error) {
				if state == "missing" {
					return queryfixture.Rows([]string{"boolean_value"}), nil
				}
				return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{state == "on"}), nil
			})
			t.Cleanup(func() { backend.Db = oldDB; system_config_cache.Delete("app_log_search_terms") })
			const separator = "--------------------------------------------------------\n"
			const query = "🔍 Search query: \"private words\"\n"
			for _, diagnostic := range []struct {
				name              string
				text              []rowTextRank
				semantic          []rowSemanticScore
				embeddingsPresent bool
				details           string
			}{
				{"matches", []rowTextRank{{RowID: 7, RowName: "private words", Rank: 0.25}},
					[]rowSemanticScore{{RowID: 8, RowName: "private words", DistanceScore: 0.5, MatchLanguage: "fi"}}, true,
					"✏️  Full text — 1 matches:\n" +
						"    • id=7 name=private words (rank=0.2500)\n" +
						"🧩 Embedding search — 1 matches:\n" +
						"    • id=8 name=private words (distance=0.5000, language=\"fi\")\n"},
				{"empty", nil, nil, true, "✏️  Full text: no matches.\n🧩 Embedding search: no matches.\n"},
				{"no_embedding_column", nil, nil, false, "✏️  Full text: no matches.\n🧩 Embedding search: column missing, skipping.\n"},
			} {
				t.Run(diagnostic.name, func(t *testing.T) {
					reader, writer, err := os.Pipe()
					if err != nil {
						t.Fatal(err)
					}
					defer reader.Close()
					oldStdout := os.Stdout
					os.Stdout = writer
					func() {
						defer func() { os.Stdout = oldStdout; writer.Close() }()
						logSearchDiagnostics("private words", diagnostic.text, diagnostic.semantic, diagnostic.embeddingsPresent)
					}()
					output, err := io.ReadAll(reader)
					if err != nil {
						t.Fatal(err)
					}
					want := ""
					if state == "on" {
						want = separator + query + diagnostic.details + separator
					}
					if string(output) != want {
						t.Fatalf("output=%q, want %q", output, want)
					}
				})
			}
		})
	}
}
