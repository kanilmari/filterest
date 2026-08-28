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
	"strings"
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
		{name: "semantic newest", raw: "__newest:DESC", wantColumn: semanticNewestSortColumn, wantDirection: "DESC"},
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

func TestSavePersonalDatasetSortDefaultUsesOnlySessionOwner(t *testing.T) {
	request := datasetSortRequestWithUser(
		t,
		http.MethodPost,
		"/api/dataset-sort-default/personal",
		`{"dataset":"travel_info","value":"__newest:DESC"}`,
		42,
	)
	originalSave := datasetSortDefaultSave
	var capturedDataset, capturedValue, capturedScope string
	var capturedUserID int
	datasetSortDefaultSave = func(
		w http.ResponseWriter,
		_ *http.Request,
		dataset string,
		value string,
		scope string,
		userID int,
	) {
		capturedDataset = dataset
		capturedValue = value
		capturedScope = scope
		capturedUserID = userID
		w.WriteHeader(http.StatusNoContent)
	}
	t.Cleanup(func() { datasetSortDefaultSave = originalSave })
	response := httptest.NewRecorder()

	SavePersonalDatasetSortDefaultHandler(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
	if capturedDataset != "travel_info" || capturedValue != "__newest:DESC" {
		t.Fatalf("target = %q/%q, want travel_info/__newest:DESC", capturedDataset, capturedValue)
	}
	if capturedScope != "user" || capturedUserID != 42 {
		t.Fatalf("owner = %q/%d, want user/42", capturedScope, capturedUserID)
	}
}

func TestSavePersonalDatasetSortDefaultRejectsScopeInput(t *testing.T) {
	request := datasetSortRequestWithUser(
		t,
		http.MethodPost,
		"/api/dataset-sort-default/personal",
		`{"dataset":"travel_info","value":"__newest:DESC","scope":"site"}`,
		42,
	)
	originalSave := datasetSortDefaultSave
	datasetSortDefaultSave = func(http.ResponseWriter, *http.Request, string, string, string, int) {
		t.Fatal("personal route must reject caller-selected scope before saving")
	}
	t.Cleanup(func() { datasetSortDefaultSave = originalSave })
	response := httptest.NewRecorder()

	SavePersonalDatasetSortDefaultHandler(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestSavePersonalDatasetSortDefaultRejectsGuest(t *testing.T) {
	request := datasetSortRequestWithUser(
		t,
		http.MethodPost,
		"/api/dataset-sort-default/personal",
		`{"dataset":"travel_info","value":"__newest:DESC"}`,
		1,
	)
	originalSave := datasetSortDefaultSave
	datasetSortDefaultSave = func(http.ResponseWriter, *http.Request, string, string, string, int) {
		t.Fatal("guest request must not reach dataset sorting persistence")
	}
	t.Cleanup(func() { datasetSortDefaultSave = originalSave })
	response := httptest.NewRecorder()

	SavePersonalDatasetSortDefaultHandler(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestSaveDatasetSortDefaultRetainsAdministratorSiteScope(t *testing.T) {
	request := datasetSortRequestWithUser(
		t,
		http.MethodPost,
		"/api/admin/dataset-sort-default",
		`{"dataset":"travel_info","value":"__newest:DESC","scope":"site"}`,
		7,
	)
	originalSave := datasetSortDefaultSave
	var capturedScope string
	datasetSortDefaultSave = func(
		w http.ResponseWriter,
		_ *http.Request,
		_ string,
		_ string,
		scope string,
		_ int,
	) {
		capturedScope = scope
		w.WriteHeader(http.StatusNoContent)
	}
	t.Cleanup(func() { datasetSortDefaultSave = originalSave })
	response := httptest.NewRecorder()

	SaveDatasetSortDefaultHandler(response, request)

	if response.Code != http.StatusNoContent || capturedScope != "site" {
		t.Fatalf("status/scope = %d/%q, want %d/site", response.Code, capturedScope, http.StatusNoContent)
	}
}

func datasetSortRequestWithUser(
	t *testing.T,
	method string,
	path string,
	body string,
	userID int,
) *http.Request {
	t.Helper()
	originalStore := e_sessions.Store
	originalSessionName := e_sessions.SessionName
	store := sessions.NewCookieStore([]byte("dataset-sort-handler-secret-32-bytes"))
	store.Options = &sessions.Options{Path: "/", MaxAge: 3600, HttpOnly: true}
	e_sessions.Store = store
	e_sessions.SessionName = "dataset-sort-handler-session"
	t.Cleanup(func() {
		e_sessions.Store = originalStore
		e_sessions.SessionName = originalSessionName
	})

	cookieRequest := httptest.NewRequest(method, path, strings.NewReader(body))
	cookieResponse := httptest.NewRecorder()
	session, err := store.Get(cookieRequest, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("store.Get: %v", err)
	}
	session.Values["user_id"] = userID
	if err := session.Save(cookieRequest, cookieResponse); err != nil {
		t.Fatalf("session.Save: %v", err)
	}

	request := httptest.NewRequest(method, path, strings.NewReader(body))
	for _, cookie := range cookieResponse.Result().Cookies() {
		request.AddCookie(cookie)
	}
	return request
}
