// check_app_log_search_terms_test.go
// Proves private defaults, exact opt-in URLs and cached configuration reads.
// Connects the real middleware readers to an in-memory SQL fixture only.
// Prevents missing settings, failed refreshes and concurrent logs leaking terms.
package middlewares

import (
	"database/sql/driver"
	"errors"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"easelect/backend/core_components/system_config_cache"
)

func TestAppLogSearchTermsDefaultsAndURLRedaction(t *testing.T) {
	for _, state := range []string{"off", "on", "missing", "null", "error", "invalid"} {
		t.Run(state, func(t *testing.T) {
			var reads atomic.Int64
			old := backend.Db
			backend.Db = queryfixture.Open(t, func(query string, args []driver.NamedValue) (driver.Rows, error) {
				reads.Add(1)
				if query != "SELECT boolean_value FROM system_config WHERE key = $1" || args[0].Value != AppLogSearchTermsKey {
					t.Fatalf("unexpected settings query: %s %v", query, args)
				}
				switch state {
				case "missing":
					return queryfixture.Rows([]string{"boolean_value"}), nil
				case "error":
					return nil, errors.New("unavailable")
				case "null":
					return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{nil}), nil
				case "invalid":
					return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{"invalid"}), nil
				default:
					return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{state == "on"}), nil
				}
			})
			t.Cleanup(func() { backend.Db = old; system_config_cache.Delete(AppLogSearchTermsKey) })
			for _, address := range []string{
				"https://site.example/dataset?search=private+words&query=private%20words&other=value#private-words",
				"/dataset?search=one&search=two&query=three", "/dataset?", "/dataset",
			} {
				req := httptest.NewRequest("GET", address, nil)
				original := req.URL.String()
				want := original
				if state != "on" {
					want = strings.Split(strings.Split(original, "?")[0], "#")[0]
				}
				if got := AppLogRequestURL(req); got != want {
					t.Fatalf("got %q, want %q", got, want)
				}
				if req.URL.String() != original {
					t.Fatal("redaction mutated the request")
				}
			}
			if reads.Load() != 1 {
				t.Fatalf("%d settings queries, want one", reads.Load())
			}
		})
	}
}

func TestAppLogSearchTermsConcurrentMissAndFailedRefresh(t *testing.T) {
	var reads atomic.Int64
	var fail atomic.Bool
	old := backend.Db
	backend.Db = queryfixture.Open(t, func(string, []driver.NamedValue) (driver.Rows, error) {
		reads.Add(1)
		if fail.Load() {
			return nil, errors.New("unavailable")
		}
		return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{true}), nil
	})
	t.Cleanup(func() { backend.Db = old; system_config_cache.Delete(AppLogSearchTermsKey) })
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if !CheckAppLogSearchTerms() {
				t.Error("opt-in lost")
			}
		}()
	}
	wg.Wait()
	if reads.Load() != 1 {
		t.Fatalf("concurrent cache miss read %d times", reads.Load())
	}
	fail.Store(true)
	system_config_cache.PurgeExpired(time.Now().Add(system_config_cache.TTL))
	for range 2 {
		if CheckAppLogSearchTerms() {
			t.Fatal("failed refresh retained opt-in")
		}
	}
	if reads.Load() != 2 {
		t.Fatal("failed refresh was not cached", reads.Load())
	}
	backend.Db = nil
	if CheckAppLogSearchTerms() {
		t.Fatal("missing database retained opt-in")
	}
}
