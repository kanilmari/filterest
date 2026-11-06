// vector_embedding_error_handlers_test.go
// Replays provider and wrapped database failures through vector and embedding SSE handlers.
// Connects real handlers and sessions to offline SQL and HTTP response fixtures.
// Protects every log sink while preserving the exact opt-in diagnostic lines.
package dtt_1_row_read

import (
	"context"
	"database/sql/driver"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"easelect/backend/core_components/dynamic_table_tools/ai_features"
	"easelect/backend/core_components/middlewares"
	esessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/system_config_cache"

	"github.com/gorilla/sessions"
	"github.com/lib/pq"
)

type vectorEmbeddingErrorTransport struct {
	t      *testing.T
	status int
	body   string
	calls  int
}

func (transport *vectorEmbeddingErrorTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	transport.calls++
	body, err := io.ReadAll(r.Body)
	if err != nil || !strings.Contains(string(body), "1e1000") || !strings.Contains(string(body), searchLogMarker) {
		transport.t.Fatalf("provider input missing search text: %s, %v", body, err)
	}
	return &http.Response{StatusCode: transport.status, Header: make(http.Header), Request: r,
		Body: io.NopCloser(strings.NewReader(transport.body))}, nil
}

func TestVectorAndEmbeddingStreamErrorsRespectSearchTermSetting(t *testing.T) {
	const query = "1e1000 " + searchLogMarker
	for _, handler := range []string{"vector", "embedding-stream"} {
		for _, failure := range []string{"decode", "provider-envelope", "provider-http", "wrapped-query", "iteration", "offset", "identity"} {
			if handler == "embedding-stream" && (failure == "offset" || failure == "identity") {
				continue
			}
			for _, enabled := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/on=%t", handler, failure, enabled), func(t *testing.T) {
					wrapped := fmt.Errorf("query input %s: %w", query, &pq.Error{Code: "42601", Message: query, Detail: query})
					fallback := galleryHandlerConn{state: &galleryHandlerState{t: t, allowed: true}}
					dataCalls := 0
					db := queryfixture.Open(t, func(q string, args []driver.NamedValue) (driver.Rows, error) {
						switch {
						case strings.Contains(q, "SELECT boolean_value FROM system_config"):
							return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{enabled}), nil
						case strings.Contains(q, "COALESCE(external_embedding_enabled"):
							return queryfixture.Rows([]string{"uid", "enabled", "configured"}, []driver.Value{int64(161), true, true}), nil
						case strings.Contains(q, "scd.external_embedding_allowed"):
							return queryfixture.Rows([]string{"uid", "column_uid", "column_name", "data_type", "multilingual", "allowed"},
								[]driver.Value{int64(161), int64(2), "e2e_text", "text", false, true}), nil
						case strings.Contains(q, "column_name = 'embedding_vector'"):
							if strings.Contains(q, "SELECT 1") {
								return queryfixture.Rows([]string{"exists"}, []driver.Value{int64(1)}), nil
							}
							return queryfixture.Rows([]string{"column_name"}, []driver.Value{"embedding_vector"}), nil
						case failure == "identity" && strings.Contains(q, "SELECT table_uid FROM system_db_tables"):
							return queryfixture.Rows([]string{"table_uid"}, []driver.Value{query}), nil
						case handler == "embedding-stream" && strings.Contains(q, `SELECT "id", "e2e_text"`),
							handler == "vector" && strings.Contains(q, ` LIMIT 10 OFFSET 0`):
							dataCalls++
							if failure == "wrapped-query" {
								return nil, wrapped
							}
							if failure == "iteration" {
								return &searchErrorRows{Rows: queryfixture.Rows([]string{"id", "e2e_text"}), err: wrapped}, nil
							}
							return queryfixture.Rows([]string{"id", "e2e_text"}, []driver.Value{int64(17), query}), nil
						}
						return fallback.QueryContext(context.Background(), q, args)
					})
					oldDB, oldBasic := backend.Db, backend.DbBasic
					backend.Db, backend.DbBasic = db, db
					oldStore, oldName := esessions.Store, esessions.SessionName
					esessions.Store, esessions.SessionName = sessions.NewCookieStore([]byte("vector-error-cookie-fixture-32")), "session"
					transport := &vectorEmbeddingErrorTransport{t: t, status: http.StatusOK}
					providerError := "google embedding: API error 400: " + query
					transport.body = `{"error":{"code":400,"message":"` + query + `"}}`
					if failure == "decode" {
						transport.body = `{"embedding":{"values":[1e1000]}}`
						providerError = "google embedding: unmarshal error: json: cannot unmarshal number 1e1000 into Go struct field geminiEmbeddingData.embedding.values of type float32"
					}
					if failure == "provider-http" {
						transport.status = http.StatusBadRequest
						providerError = "google embedding: API returned 400: " + transport.body
					}
					oldTransport := http.DefaultTransport
					http.DefaultTransport = transport
					t.Setenv("EMBEDDING_PROVIDER", "google")
					t.Setenv("GOOGLE_API_KEY", "offline-fixture")
					t.Cleanup(func() {
						backend.Db, backend.DbBasic = oldDB, oldBasic
						esessions.Store, esessions.SessionName = oldStore, oldName
						http.DefaultTransport = oldTransport
						system_config_cache.Delete(middlewares.AppLogSearchTermsKey)
						InvalidateSchemaCache(supportFixtureDataset)
						resetJoinMetadataCacheForTests()
					})
					params := url.Values{"dataset": {supportFixtureDataset}}
					joinUID := "161"
					if failure == "identity" {
						joinUID = query
					}
					setCachedJoinMetadata(supportFixtureDataset, joinMetadataCacheEntry{tableUID: joinUID})
					if failure == "offset" {
						params.Set("offset", query)
					} else if failure == "identity" {
						params.Set("row_group", "e2e_identity")
					} else if failure != "wrapped-query" && failure != "iteration" {
						params.Set("vector_query", query)
					}
					method := http.MethodGet
					if handler == "embedding-stream" {
						method = http.MethodPost
					}
					req := httptest.NewRequest(method, "/api/e2e-search?"+params.Encode(), nil)
					session, err := esessions.Store.Get(req, esessions.SessionName)
					if err != nil {
						t.Fatal(err)
					}
					session.Values["user_id"], session.Values["user_role"] = 4, "basic"
					cookies := httptest.NewRecorder()
					if err := session.Save(req, cookies); err != nil {
						t.Fatal(err)
					}
					for _, cookie := range cookies.Result().Cookies() {
						req.AddCookie(cookie)
					}
					rec := httptest.NewRecorder()
					logs := captureSearchErrorLogs(t, func() {
						if handler == "vector" {
							GetResultsVector(rec, req)
							return
						}
						ai_features.EmbeddingStreamHandler(rec, req)
					})
					if !enabled && (strings.Contains(logs, "1e1000") || strings.Contains(logs, searchLogMarker)) {
						t.Fatalf("search/provider content leaked: %q", logs)
					}
					prefix := "error generateVectorParam: "
					if handler == "embedding-stream" {
						prefix = "error: embedding error (id=17): "
					}
					switch failure {
					case "decode", "provider-envelope", "provider-http":
						if transport.calls != 1 {
							t.Fatalf("provider calls=%d, body=%s, logs=%s", transport.calls, rec.Body, logs)
						}
						if enabled && !strings.Contains(logs, "\033[31m"+prefix+providerError+"\033[0m\n") {
							t.Fatalf("former diagnostic missing: %q; want %q", logs, providerError)
						}
					case "wrapped-query", "iteration":
						if dataCalls != 1 || enabled && !strings.Contains(logs, wrapped.Error()) {
							t.Fatalf("failure not exercised: calls=%d logs=%q body=%s", dataCalls, logs, rec.Body)
						}
					case "offset", "identity":
						if enabled && !strings.Contains(logs, query) {
							t.Fatalf("former input diagnostic missing: %q; body=%s", logs, rec.Body)
						}
					}
					if !enabled && !strings.Contains(logs, "error_class=") {
						t.Fatalf("content-free error not logged: %q; body=%s", logs, rec.Body)
					}
				})
			}
		}
	}
}
