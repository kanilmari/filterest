// commit_stream_route_test.go
// Exercises the registered POST embedding stream through transaction middleware.
// Reuses the local row driver to refuse missing embedding policy without a provider call.
// Keeps SSE error events immediately flushed instead of held as finite write output.
package dtt_1_row_update

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/ai_features"
	"easelect/backend/core_components/middlewares"
)

func TestEmbeddingStreamRouteStillFlushesImmediately(t *testing.T) {
	response := httptest.NewRecorder()
	state := &rowCommitDriver{response: response, t: t}
	db := sql.OpenDB(state)
	defer db.Close()
	oldDB, oldAdmin := backend.Db, backend.DbAdmin
	backend.Db, backend.DbAdmin = db, db
	defer func() { backend.Db, backend.DbAdmin = oldDB, oldAdmin }()
	request := buildUpdateRowSessionRequest(t, http.MethodPost, "/api/embedding_stream_handler?dataset=plain_rows", "")
	request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(2, "admin")))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ai_features.EmbeddingStreamHandler(w, r)
		if !response.Flushed || !strings.Contains(response.Body.String(), "event: error") {
			t.Fatal("SSE event was delayed until handler return", response)
		}
	})
	middlewares.WithLazyTransaction(handler).ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "text/event-stream" || !response.Flushed || state.committed {
		t.Fatal("embedding stream contract changed", response)
	}
}
