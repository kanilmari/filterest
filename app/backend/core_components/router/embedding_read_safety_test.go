// embedding_read_safety_test.go
// Proves safe methods cannot create vectors, change schema or invalidate caches.
// Connects the registered route to warm kind evidence and a fake embedding client.
// Includes an opt-in information_schema proof on a disposable PostgreSQL dataset.
package router

import (
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_kinds/kindtest"
	"easelect/backend/pipeline"
)

type safeMethodEmbeddingTransport struct{ calls int }

func (c *safeMethodEmbeddingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	c.calls++
	return nil, errors.New("offline embedding client")
}

func embeddingReadSafetyFixture(t *testing.T, db *sql.DB) (http.HandlerFunc, *safeMethodEmbeddingTransport) {
	t.Helper()
	oldDB, oldTransport := backend.Db, http.DefaultTransport
	backend.Db = nil // Registration must not initialize payment tables or configuration.
	client := &safeMethodEmbeddingTransport{}
	http.DefaultTransport = client
	t.Setenv("EMBEDDING_PROVIDER", "openai")
	t.Setenv("OPENAI_API_KEY", "offline-test-key")
	t.Cleanup(func() {
		backend.Db, http.DefaultTransport = oldDB, oldTransport
		ResetRouteDefinitions()
		pipeline.ResetRouteProfiles()
	})
	RegisterRoutes(t.TempDir(), t.TempDir())
	backend.Db = db
	for _, route := range GetRouteDefinitions() {
		if route.UrlPattern == "/api/embedding_stream_handler" {
			return route.HandlerFunc, client
		}
	}
	t.Fatal("embedding route missing")
	return nil, nil
}

func TestEmbeddingSafeMethodsDoNotWrite(t *testing.T) {
	state := &safeMethodDB{}
	db := sql.OpenDB(state)
	t.Cleanup(func() { _ = db.Close() })
	handler, client := embeddingReadSafetyFixture(t, db)
	read := kindtest.WarmProbe(t)
	read(1)
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		t.Run(method, func(t *testing.T) {
			r := kindtest.AuthenticatedRequest(t, method, "/api/embedding_stream_handler?dataset=plain", nil)
			w := httptest.NewRecorder()
			handler(w, r) // Deliberately no CSRF header.
			if w.Code != http.StatusMethodNotAllowed || state.writes != 0 || state.reads != 0 || client.calls != 0 {
				t.Fatalf("safe method reached work: status=%d reads=%d writes=%d provider=%d", w.Code, state.reads, state.writes, client.calls)
			}
			read(1)
		})
	}
}

func TestEmbeddingSafeMethodsSchemaPostgres(t *testing.T) {
	db := routeIdentityDisposableDB(t) // Opt-in fixture, never a live database.
	if _, err := db.Exec(`CREATE TABLE public.sec5_plain (id integer PRIMARY KEY, title text); INSERT INTO public.sec5_plain VALUES (1,'sample')`); err != nil {
		t.Fatal(err)
	}
	handler, client := embeddingReadSafetyFixture(t, db)
	schema := func() string {
		var result string
		err := db.QueryRow(`SELECT string_agg(column_name || ':' || udt_name, ',' ORDER BY ordinal_position)
			FROM information_schema.columns WHERE table_schema='public' AND table_name='sec5_plain'`).Scan(&result)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	before := schema()
	if strings.Contains(before, "embedding_vector") {
		t.Fatal("fixture must lack embedding_vector")
	}
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		r := kindtest.AuthenticatedRequest(t, method, "/api/embedding_stream_handler?dataset=sec5_plain", nil)
		w := httptest.NewRecorder()
		handler(w, r)
		var rows int
		if err := db.QueryRow(`SELECT count(*) FROM public.sec5_plain WHERE id=1 AND title='sample'`).Scan(&rows); err != nil {
			t.Fatal(err)
		}
		if w.Code != http.StatusMethodNotAllowed || schema() != before || client.calls != 0 || rows != 1 {
			t.Fatalf("%s changed state or called provider: status=%d calls=%d rows=%d", method, w.Code, client.calls, rows)
		}
	}
}
