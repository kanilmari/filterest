// dataset_sort_defaults_test.go
// Verifies the accepted persistent sorting values and safe virtual sort keys.
// Covers the validation boundary between browser selections and database settings.
// Exists to prevent arbitrary sort expressions from entering stored defaults.
package system_table_tools

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
)

func TestGetDatasetSortDefaultAuthenticationGenerationUsesConfidentialPoolAndFailsClosed(t *testing.T) {
	originalStore := e_sessions.Store
	originalSessionName := e_sessions.SessionName
	originalAdminDB := backend.DbAdmin
	originalConfidentialDB := backend.DbConfidential
	originalMatcher := datasetSortAuthenticationGenerationMatches

	store := sessions.NewCookieStore([]byte("dataset-sort-test-secret-32-bytes"))
	store.Options = &sessions.Options{Path: "/", MaxAge: 3600, HttpOnly: true}
	e_sessions.Store = store
	e_sessions.SessionName = "session"
	backend.DbAdmin = nil
	backend.DbConfidential = new(sql.DB)
	usedConfidentialPool := false
	datasetSortAuthenticationGenerationMatches = func(
		_ context.Context,
		database auth_generation.Querier,
		_ *sessions.Session,
		_ int,
	) (bool, error) {
		usedConfidentialPool = database == backend.DbConfidential
		return false, errors.New("simulated generation read failure")
	}
	t.Cleanup(func() {
		e_sessions.Store = originalStore
		e_sessions.SessionName = originalSessionName
		backend.DbAdmin = originalAdminDB
		backend.DbConfidential = originalConfidentialDB
		datasetSortAuthenticationGenerationMatches = originalMatcher
	})

	cookieRequest := httptest.NewRequest(http.MethodGet, "/api/dataset-sort-default?dataset=app_example", nil)
	cookieResponse := httptest.NewRecorder()
	session, err := store.Get(cookieRequest, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("store.Get: %v", err)
	}
	session.Values["user_id"] = 42
	session.Values[auth_generation.SessionKey] = int64(1)
	if err = session.Save(cookieRequest, cookieResponse); err != nil {
		t.Fatalf("session.Save: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/dataset-sort-default?dataset=app_example", nil)
	for _, cookie := range cookieResponse.Result().Cookies() {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()

	GetDatasetSortDefaultHandler(response, request)

	if !usedConfidentialPool {
		t.Fatal("dataset sort authentication generation check did not use the confidential pool")
	}
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestParseDatasetSortValue(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		raw           string
		wantColumn    string
		wantDirection string
		wantError     bool
	}{
		{name: "search relevance", raw: "", wantColumn: searchRelevanceSortColumn, wantDirection: "ASC"},
		{name: "newest", raw: "created:DESC", wantColumn: "created", wantDirection: "DESC"},
		{name: "normalizes direction", raw: "updated:asc", wantColumn: "updated", wantDirection: "ASC"},
		{name: "virtual image sort", raw: "__images_first:DESC", wantColumn: imagesFirstSortColumn, wantDirection: "DESC"},
		{name: "missing direction", raw: "created", wantError: true},
		{name: "invalid direction", raw: "created:sideways", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			column, direction, err := parseDatasetSortValue(test.raw)
			if test.wantError {
				if err == nil {
					t.Fatal("expected validation error")
				}
				return
			}
			if err != nil {
				t.Fatalf("parseDatasetSortValue returned error: %v", err)
			}
			if column != test.wantColumn || direction != test.wantDirection {
				t.Fatalf("got %q/%q, want %q/%q", column, direction, test.wantColumn, test.wantDirection)
			}
		})
	}
}
