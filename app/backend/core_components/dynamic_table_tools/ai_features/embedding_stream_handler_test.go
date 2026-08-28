// embedding_stream_handler_test.go
// Verifies embedding diagnostics never include the row content itself.
// Bridges metadata-only logging with the external-provider privacy boundary.
// Exists to prevent customer or personal text from leaking into server logs.
package ai_features

import (
	"bytes"
	"log"
	"strings"
	"testing"
)

func TestLogEmbeddingRowMetadataOmitsContent(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	})

	const sensitiveContent = "private customer note 12345"
	logEmbeddingRowMetadata(17, sensitiveContent)

	logged := output.String()
	if strings.Contains(logged, sensitiveContent) {
		t.Fatalf("embedding log exposed row content: %q", logged)
	}
	if !strings.Contains(logged, "id=17") || !strings.Contains(logged, "text length=27") {
		t.Fatalf("embedding log = %q, want row id and text length metadata", logged)
	}
}
