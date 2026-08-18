// refresh_lang_embeddings_test.go
// Verifies that the administrator's policy catalog includes current-project text tables
// before vector storage is provisioned, while legacy refresh listing remains capability-only.
// Exists so policy selection can precede provider processing without exposing restricted data.
package ai_features

import (
	"strings"
	"testing"
)

func TestEmbeddingDatasetCatalogSupportsSafePolicyCandidates(t *testing.T) {
	required := []string{
		"WITH RECURSIVE current_project_folders",
		"WHERE is_current_project = true",
		"sdt.folder_id IN (SELECT id FROM current_project_folders)",
		"COALESCE(NULLIF(sdt.schema_name, ''), 'public') = 'public'",
		"isc.data_type IN ('text', 'character varying')",
		"NOT $1",
		"isc.column_name = 'embedding_vector'",
		"COALESCE(sdt.multi_lang_embeddings, false)",
	}
	for _, fragment := range required {
		if !strings.Contains(embeddingDatasetCatalogQuery, fragment) {
			t.Fatalf("embedding catalog query is missing %q", fragment)
		}
	}
	if strings.Contains(embeddingDatasetCatalogQuery, "schema_name = 'restricted'") {
		t.Fatal("embedding policy catalog must not select restricted-schema datasets")
	}
}
