// publication_handler_test.go
// Exercises publication request validation before any database transaction starts.
// Connects the dedicated release-goal API to publication dates and state invariants.
// Prevents malformed scheduling or publication evidence from reaching storage.
package workline_observatory

import (
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPublicationCreateRejectsInvalidDetailsBeforeDatabaseAccess(t *testing.T) {
	for _, details := range []string{
		`"target_date":"2026-02-30"`,
		`"target_date":"2026-10-10T12:00:00Z"`,
		`"published":false,"published_at":"2026-10-10T12:00:00Z"`,
		`"published":true,"published_at":"yesterday"`,
	} {
		t.Run(details, func(t *testing.T) {
			body := `{"identity_key":"publication-demo","version":1,"title":"Demo","outcome":"Plan","publication_version":"9.4.0",` + details + `}`
			r := httptest.NewRequest(http.MethodPost, "/api/app/workline-observatory/release-goals", strings.NewReader(body))
			w := httptest.NewRecorder()
			createReleaseGoal(w, r, 2)
			if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"error_lang_key":"invalid_publication_`) {
				t.Fatalf("status = %d, want 400; body = %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestPublicationUpdateRequiresAnExplicitRevisionBeforeDatabaseAccess(t *testing.T) {
	for _, revision := range []string{"", `,"expected_revision":null`, `,"expected_revision":-1`} {
		req := httptest.NewRequest(http.MethodPatch, "/api/app/workline-observatory/release-goals", strings.NewReader(`{"id":7,"action":"update"`+revision+`}`))
		w := httptest.NewRecorder()
		applyReleaseGoalAction(w, req, 2)
		if w.Code != 400 || !strings.Contains(w.Body.String(), "publication_revision_required") {
			t.Fatalf("missing revision = %d %s", w.Code, w.Body.String())
		}
	}
}

func TestPublicationDetailsSeparateTextVersionFromContractRevision(t *testing.T) {
	date, at := "2028-02-29", "2028-02-29T10:30:00+02:00"
	input := publicationDetails{PublicationVersion: " 9.4.0 ", TargetDate: &date, ReaderDescription: " Tietokone ja puhelin ", Published: true, PublishedAt: &at}
	got, err := normalizePublicationDetails(input)
	if err != nil || got.PublicationVersion != "9.4.0" || got.ReaderDescription != "Tietokone ja puhelin" {
		t.Fatalf("normalized = %+v, %v", got, err)
	}
	input.PublicationVersion = "desktop-mobile preview"
	if _, err := normalizePublicationDetails(input); err != nil {
		t.Fatal("text version must not be constrained to an integer or version table", err)
	}
	input.ReaderDescription = strings.Repeat("界", 6000)
	if _, err := normalizePublicationDetails(input); err != nil {
		t.Fatal("description limit must count Unicode characters", err)
	}
	input.ReaderDescription += "界"
	if _, err := normalizePublicationDetails(input); err == nil {
		t.Fatal("oversized description accepted")
	}
	if _, err := normalizePublicationDetails(publicationDetails{Published: true}); err == nil {
		t.Fatal("published version cannot be blank")
	}
	date = "0000-01-01"
	if _, err := normalizePublicationDetails(publicationDetails{TargetDate: &date}); err == nil {
		t.Fatal("year zero is unsupported")
	}
	if _, err := normalizePublicationDetails(publicationDetails{}); err != nil {
		t.Fatal("legacy optional fields must remain editable", err)
	}
}

func TestPublicationAPIRejectsUnauthenticatedRequests(t *testing.T) {
	oldStore := e_sessions.Store
	e_sessions.Store = sessions.NewCookieStore([]byte("publication-handler-test-only-key"))
	t.Cleanup(func() { e_sessions.Store = oldStore })
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPatch} {
		w := httptest.NewRecorder()
		ReleaseGoalsHandler(w, httptest.NewRequest(method, "/api/app/workline-observatory/release-goals", nil))
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s status=%d", method, w.Code)
		}
	}
}
