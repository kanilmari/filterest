// vector_search_logging_test.go
// Verifies semantic-search diagnostics contain metadata but no request details.
// Bridges vector-result logging with the search privacy boundary.
// Exists to prevent search terms and embedding arguments from leaking to logs.
package dtt_1_row_read

import (
	"bytes"
	"log"
	"strings"
	"testing"
)

func TestLogVectorSearchResultMetadataContainsOnlyOperationalFields(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	})

	logVectorSearchResultMetadata("services", 3)

	logged := output.String()
	if !strings.Contains(logged, "3 rows") || !strings.Contains(logged, "services") {
		t.Fatalf("vector search log = %q, want dataset and result count", logged)
	}
	for _, sensitiveMarker := range []string{"vector_query", "query:", "args:"} {
		if strings.Contains(logged, sensitiveMarker) {
			t.Fatalf("vector search log exposed request details: %q", logged)
		}
	}
}
