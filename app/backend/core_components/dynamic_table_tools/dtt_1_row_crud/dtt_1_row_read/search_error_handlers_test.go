// search_error_handlers_test.go
// Exercises private search failures through ordinary, AI and streaming handlers.
// Connects real requests, sessions and search builders to offline SQL/HTTP fixtures.
// Covers parser messages, delayed row errors and provider responses echoing input.
package dtt_1_row_read

import (
	"context"
	"database/sql/driver"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"easelect/backend/core_components/middlewares"
	esessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/system_config_cache"

	"github.com/gorilla/sessions"
	"github.com/lib/pq"
)

const searchLogMarker = "e2e_private_search"
const malformedSearch = searchLogMarker + " &"

type searchErrorRows struct {
	driver.Rows
	err error
}

func (rows *searchErrorRows) Next([]driver.Value) error { return rows.err }

type searchErrorTransport struct {
	t     *testing.T
	calls int
}

func (transport *searchErrorTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	transport.calls++
	body, err := io.ReadAll(r.Body)
	if err != nil || !strings.Contains(string(body), searchLogMarker) {
		transport.t.Fatalf("embedding request did not carry the search: %s, %v", body, err)
	}
	return &http.Response{StatusCode: http.StatusBadRequest, Header: make(http.Header), Request: r,
		Body: io.NopCloser(strings.NewReader(`{"error":{"code":400,"message":"` + searchLogMarker + `"}}`))}, nil
}

func captureSearchErrorLogs(t *testing.T, run func()) string {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	stdout, stderr, output, flags, prefix := os.Stdout, os.Stderr, log.Writer(), log.Flags(), log.Prefix()
	os.Stdout, os.Stderr = writer, writer
	log.SetOutput(writer)
	log.SetFlags(0)
	log.SetPrefix("")
	func() {
		defer func() {
			os.Stdout, os.Stderr = stdout, stderr
			log.SetOutput(output)
			log.SetFlags(flags)
			log.SetPrefix(prefix)
			writer.Close()
		}()
		run()
	}()
	result, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return string(result)
}

func TestSearchErrorsThroughHandlersRespectSearchTermSetting(t *testing.T) {
	for _, failure := range []string{"ordinary-count", "ordinary-execute", "ordinary-iteration", "ai-text", "stream-text", "ai-rows", "stream-rows", "ai-provider", "stream-provider"} {
		var privateResponse string
		var privateStatus int
		for _, enabled := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/on=%t", failure, enabled), func(t *testing.T) {
				searchErr := &pq.Error{Code: "42601", Message: `syntax error in tsquery: "` + searchLogMarker + `:* | &:*"`,
					Detail: searchLogMarker, Hint: searchLogMarker, InternalQuery: searchLogMarker, Where: searchLogMarker}
				fallback := galleryHandlerConn{state: &galleryHandlerState{t: t, allowed: true}}
				searchCalls := 0
				db := queryfixture.Open(t, func(q string, args []driver.NamedValue) (driver.Rows, error) {
					if strings.Contains(q, "SELECT boolean_value FROM system_config") {
						return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{enabled}), nil
					}
					if strings.Contains(q, "FROM information_schema.columns") && strings.Contains(q, "SELECT 1") {
						if len(args) == 2 && args[1].Value == "search_vector_simple" || strings.HasSuffix(failure, "provider") && strings.Contains(q, "column_name = 'embedding_vector'") {
							return queryfixture.Rows([]string{"exists"}, []driver.Value{int64(1)}), nil
						}
					}
					if strings.Contains(q, "to_tsquery(") {
						searchCalls++
						found := false
						for _, arg := range args {
							found = found || arg.Value == searchLogMarker+":* | &:*"
						}
						if !found {
							t.Fatalf("malformed search did not reach SQL arguments: %v", args)
						}
						switch failure {
						case "ordinary-count", "ordinary-execute", "ai-text", "stream-text":
							return nil, searchErr
						case "ordinary-iteration":
							return &searchErrorRows{Rows: queryfixture.Rows([]string{"id"}), err: searchErr}, nil
						}
					}
					if strings.HasSuffix(failure, "rows") && strings.Contains(q, "FROM wanted") {
						return &searchErrorRows{Rows: queryfixture.Rows([]string{"id"}), err: searchErr}, nil
					}
					return fallback.QueryContext(context.Background(), q, args)
				})
				oldDB, oldBasic := backend.Db, backend.DbBasic
				backend.Db, backend.DbBasic = db, db
				oldStore, oldName := esessions.Store, esessions.SessionName
				esessions.Store, esessions.SessionName = sessions.NewCookieStore([]byte("search-error-cookie-fixture-32")), "session"
				oldPageSize := getCachedConfig("results_load_amount")
				t.Cleanup(func() {
					backend.Db, backend.DbBasic = oldDB, oldBasic
					esessions.Store, esessions.SessionName = oldStore, oldName
					system_config_cache.Delete(middlewares.AppLogSearchTermsKey)
					system_config_cache.Delete("results_load_amount")
					if oldPageSize != nil {
						setCachedConfig("results_load_amount", oldPageSize)
					}
					InvalidateSchemaCache(supportFixtureDataset)
					InvalidatePermissionsCache(supportFixtureDataset)
					InvalidateUserColumnSettingsCache(supportFixtureDataset, "table")
					InvalidateDatasetExistsCache(supportFixtureDataset)
					resetJoinMetadataCacheForTests()
				})
				now := time.Now()
				setCachedDatasetExists(supportFixtureDataset, &existsCacheEntry{exists: true, cachedAt: now})
				setCachedConfig("results_load_amount", &configCacheEntry{resultsPerLoad: 10, cachedAt: now})
				setCachedPermissions("basic", supportFixtureDataset, &permCacheEntry{columns: []string{"id"}, cachedAt: now})
				setCachedSchemaMetadata(supportFixtureDataset, &schemaCacheEntry{columnsMap: map[int]dtt_models.ColumnInfo{1: {ColumnName: "id", DataType: "integer"}}, cachedAt: now})
				setCachedUserColumnSettings(4, supportFixtureDataset, "table", &ucsCacheEntry{settings: []UserColumnSetting{{ColumnName: "id"}}, cachedAt: now})
				setCachedJoinMetadata(supportFixtureDataset, joinMetadataCacheEntry{tableUID: "161"})
				transport := &searchErrorTransport{t: t}
				oldTransport := http.DefaultTransport
				http.DefaultTransport = transport
				t.Cleanup(func() { http.DefaultTransport = oldTransport })
				t.Setenv("EMBEDDING_PROVIDER", "google")
				t.Setenv("GOOGLE_API_KEY", "offline-fixture")
				params := url.Values{"dataset": {supportFixtureDataset}, "offset": {"1"}, "search": {malformedSearch}, "query": {malformedSearch}}
				if failure != "ordinary-count" {
					params.Set("row_count", "1")
				}
				if strings.HasPrefix(failure, "stream") {
					params.Set("stream", "1")
				}
				req := httptest.NewRequest("GET", "/api/get-results?"+params.Encode(), nil)
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
					if strings.HasPrefix(failure, "ordinary") {
						GetResultsHandlerWrapper(rec, req)
					} else {
						GetIntelligentResultsHandlerWrapper(rec, req)
					}
				})
				if searchCalls == 0 {
					t.Fatal("handler never executed a search", rec.Code, rec.Body, logs)
				}
				if strings.Contains(rec.Body.String(), searchLogMarker) {
					t.Fatal("user-facing response echoes search text", rec.Body)
				}
				if !enabled {
					privateResponse, privateStatus = rec.Body.String(), rec.Code
				} else if rec.Body.String() != privateResponse || rec.Code != privateStatus {
					t.Fatal("logging setting changed the user-facing response", rec.Code, rec.Body)
				}
				if !enabled && strings.Contains(logs, searchLogMarker) {
					t.Fatalf("search text leaked with logging off: %q", logs)
				}
				if strings.HasSuffix(failure, "provider") {
					if transport.calls != 1 || rec.Code != http.StatusOK {
						t.Fatalf("provider flow: calls=%d, status=%d body=%s logs=%s", transport.calls, rec.Code, rec.Body, logs)
					}
					want := "[embedding_client] Google API error 400\n"
					if enabled {
						want = `[embedding_client] Google API error 400: {"error":{"code":400,"message":"` + searchLogMarker + `"}}` + "\n"
					}
					if !strings.Contains(logs, want) {
						t.Fatalf("provider line=%q, want %q", logs, want)
					}
				} else if enabled {
					message := searchErr.Error()
					switch failure {
					case "ordinary-count":
						message = "error counting rows: " + message
					case "stream-text":
						message = "full‑text search failed: " + message
					}
					if !strings.Contains(logs, "\033[31merror: "+message+"\033[0m\n") {
						t.Fatalf("former error line missing: %q", logs)
					}
				} else if !strings.Contains(logs, "error_class=*pq.Error sqlstate=42601 handler=") || !strings.Contains(logs, `dataset="`+supportFixtureDataset+`"`) {
					t.Fatalf("content-free diagnostic lost identity: %q", logs)
				}
			})
		}
	}
}
