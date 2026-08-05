// email_test.go
// Unit tests for the email package.
// Uses httptest to mock the Postmark API and os.Setenv to control environment-based branching.
package email

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// setPostmarkMock points postmarkURL at a test server and returns a cleanup func.
func setPostmarkMock(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)
	origURL := postmarkURL
	origClient := postmarkHTTPClient
	postmarkURL = srv.URL
	postmarkHTTPClient = srv.Client()
	t.Cleanup(func() {
		postmarkURL = origURL
		postmarkHTTPClient = origClient
		srv.Close()
	})
	return srv
}

// ── dev-mode (no API key) ─────────────────────────────────────────────

func TestSendOTPEmailDevMode(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("POSTMARK_API_KEY", "")
	err := SendOTPEmail("user@example.com", "abc def ghj", "login")
	if err != nil {
		t.Fatalf("dev-mode should not error: %v", err)
	}
}

func TestSendOTPEmailUnknownPurposeDevMode(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("POSTMARK_API_KEY", "")
	err := SendOTPEmail("user@example.com", "abc def ghj", "unknown_purpose")
	if err != nil {
		t.Fatalf("dev-mode with unknown purpose should not error: %v", err)
	}
}

func TestSendOTPEmailMissingAPIKeyOutsideDevMode(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "production")
	t.Setenv("POSTMARK_API_KEY", "")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")

	err := SendOTPEmail("user@example.com", "abc def ghj", "login")
	if err == nil {
		t.Fatal("expected error when POSTMARK_API_KEY is missing outside explicit dev mode")
	}
	if !strings.Contains(err.Error(), "POSTMARK_API_KEY not configured") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// ── missing EMAIL_FROM_ADDRESS ────────────────────────────────────────

func TestSendOTPEmailMissingFromAddress(t *testing.T) {
	t.Setenv("POSTMARK_API_KEY", "test-key")
	t.Setenv("EMAIL_FROM_ADDRESS", "")
	t.Setenv("POSTMARK_FROM_ADDRESS", "")

	err := SendOTPEmail("user@example.com", "abc def ghj", "login")
	if err == nil {
		t.Fatal("expected error for missing EMAIL_FROM_ADDRESS")
	}
}

func TestSendOTPEmailAcceptsLegacyPostmarkEnvNames(t *testing.T) {
	var received postmarkRequest

	setPostmarkMock(t, func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		_ = json.NewEncoder(w).Encode(postmarkResponse{
			To:        received.To,
			MessageID: "msg-legacy",
			ErrorCode: 0,
			Message:   "OK",
		})
	})

	t.Setenv("POSTMARK_API_KEY", "")
	t.Setenv("EMAIL_FROM_ADDRESS", "")
	t.Setenv("POSTMARK_SERVER_TOKEN", "legacy-token")
	t.Setenv("POSTMARK_FROM_ADDRESS", "legacy@example.com")

	err := SendOTPEmail("user@example.com", "abc def ghj", "login")
	if err != nil {
		t.Fatalf("expected legacy env fallback to work, got: %v", err)
	}

	if received.From != "legacy@example.com" {
		t.Fatalf("From = %q, want legacy@example.com", received.From)
	}
}

// ── purpose subject mapping ───────────────────────────────────────────

func TestPurposeSubjectsKnown(t *testing.T) {
	for _, purpose := range []string{"login", "email_change", "password_change", "password_reset"} {
		if _, ok := purposeSubjects[purpose]; !ok {
			t.Fatalf("missing subject for purpose %q", purpose)
		}
	}
}

// ── Postmark API mock: success ────────────────────────────────────────

func TestSendOTPEmailPostmarkSuccess(t *testing.T) {
	var received postmarkRequest

	setPostmarkMock(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Postmark-Server-Token") != "test-key" {
			t.Error("missing or wrong API token header")
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Error("missing Content-Type header")
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		json.NewEncoder(w).Encode(postmarkResponse{
			To:        received.To,
			MessageID: "msg-123",
			ErrorCode: 0,
			Message:   "OK",
		})
	})

	t.Setenv("POSTMARK_API_KEY", "test-key")
	t.Setenv("EMAIL_FROM_ADDRESS", "noreply@example.com")

	err := SendOTPEmail("user@example.com", "abc def ghj", "login")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if received.To != "user@example.com" {
		t.Fatalf("To = %q, want user@example.com", received.To)
	}
	if received.From != "noreply@example.com" {
		t.Fatalf("From = %q, want noreply@example.com", received.From)
	}
	if received.Subject != purposeSubjects["login"] {
		t.Fatalf("Subject = %q, want %q", received.Subject, purposeSubjects["login"])
	}
	if !strings.Contains(received.HtmlBody, "abc def ghj") {
		t.Fatal("HtmlBody should contain the formatted code")
	}
	if !strings.Contains(received.TextBody, "abc def ghj") {
		t.Fatal("TextBody should contain the formatted code")
	}
}

// ── Postmark API mock: fallback subject ───────────────────────────────

func TestSendOTPEmailFallbackSubject(t *testing.T) {
	var received postmarkRequest

	setPostmarkMock(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&received)
		json.NewEncoder(w).Encode(postmarkResponse{ErrorCode: 0, Message: "OK", MessageID: "msg-fallback"})
	})

	t.Setenv("POSTMARK_API_KEY", "test-key")
	t.Setenv("EMAIL_FROM_ADDRESS", "noreply@example.com")

	err := SendOTPEmail("user@example.com", "abc def ghj", "unknown_purpose")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received.Subject != "Vahvistuskoodi" {
		t.Fatalf("Subject = %q, want fallback 'Vahvistuskoodi'", received.Subject)
	}
}

// ── Postmark API mock: error response ─────────────────────────────────

func TestSendOTPEmailPostmarkError(t *testing.T) {
	setPostmarkMock(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(postmarkResponse{
			ErrorCode: 300,
			Message:   "Invalid email address",
		})
	})

	t.Setenv("POSTMARK_API_KEY", "test-key")
	t.Setenv("EMAIL_FROM_ADDRESS", "noreply@example.com")

	err := SendOTPEmail("user@example.com", "abc def ghj", "login")
	if err == nil {
		t.Fatal("expected error for Postmark error response")
	}
	if !strings.Contains(err.Error(), "300") {
		t.Fatalf("error should contain error code: %v", err)
	}
}

func TestSendOTPEmailInvalidRecipientAddress(t *testing.T) {
	t.Setenv("POSTMARK_API_KEY", "test-key")
	t.Setenv("EMAIL_FROM_ADDRESS", "noreply@example.com")

	err := SendOTPEmail("not-an-email", "abc def ghj", "login")
	if err == nil {
		t.Fatal("expected invalid recipient error")
	}
	if !strings.Contains(err.Error(), "recipient address") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSendOTPEmailPostmarkHTTPStatusFailure(t *testing.T) {
	setPostmarkMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(postmarkResponse{
			ErrorCode: 300,
			Message:   "Invalid email address",
		})
	})

	t.Setenv("POSTMARK_API_KEY", "test-key")
	t.Setenv("EMAIL_FROM_ADDRESS", "noreply@example.com")

	err := SendOTPEmail("user@example.com", "abc def ghj", "login")
	if err == nil {
		t.Fatal("expected HTTP status failure")
	}
	if !strings.Contains(err.Error(), "status 400") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSendOTPEmailPostmarkHTTPStatusFailureWithNonJSONBody(t *testing.T) {
	setPostmarkMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("<html><body>temporary upstream failure</body></html>"))
	})

	t.Setenv("POSTMARK_API_KEY", "test-key")
	t.Setenv("EMAIL_FROM_ADDRESS", "noreply@example.com")

	err := SendOTPEmail("user@example.com", "abc def ghj", "login")
	if err == nil {
		t.Fatal("expected non-JSON HTTP status failure")
	}
	if !strings.Contains(err.Error(), "status 502") {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(err.Error(), "temporary upstream failure") {
		t.Fatalf("expected raw response excerpt, got: %v", err)
	}
}

func TestSendOTPEmailPostmarkHTTPStatusFailureWithEmptyBody(t *testing.T) {
	setPostmarkMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})

	t.Setenv("POSTMARK_API_KEY", "test-key")
	t.Setenv("EMAIL_FROM_ADDRESS", "noreply@example.com")

	err := SendOTPEmail("user@example.com", "abc def ghj", "login")
	if err == nil {
		t.Fatal("expected empty-body HTTP status failure")
	}
	if !strings.Contains(err.Error(), "empty response body") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// ── Postmark API mock: HTTP failure ───────────────────────────────────

func TestSendOTPEmailHTTPFailure(t *testing.T) {
	// Point at a closed server to simulate network error
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close() // immediately close

	origURL := postmarkURL
	origClient := postmarkHTTPClient
	postmarkURL = srv.URL
	postmarkHTTPClient = srv.Client()
	t.Cleanup(func() {
		postmarkURL = origURL
		postmarkHTTPClient = origClient
	})

	t.Setenv("POSTMARK_API_KEY", "test-key")
	t.Setenv("EMAIL_FROM_ADDRESS", "noreply@example.com")

	err := SendOTPEmail("user@example.com", "abc def ghj", "login")
	if err == nil {
		t.Fatal("expected error for HTTP failure")
	}
}

func TestSendOTPEmailMissingMessageID(t *testing.T) {
	setPostmarkMock(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(postmarkResponse{
			ErrorCode: 0,
			Message:   "OK",
		})
	})

	t.Setenv("POSTMARK_API_KEY", "test-key")
	t.Setenv("EMAIL_FROM_ADDRESS", "noreply@example.com")

	err := SendOTPEmail("user@example.com", "abc def ghj", "login")
	if err == nil {
		t.Fatal("expected missing MessageID error")
	}
	if !strings.Contains(err.Error(), "missing MessageID") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// ── Auto-Submitted header ─────────────────────────────────────────────

func TestSendOTPEmailAutoSubmittedHeader(t *testing.T) {
	var received postmarkRequest

	setPostmarkMock(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&received)
		json.NewEncoder(w).Encode(postmarkResponse{ErrorCode: 0, Message: "OK", MessageID: "msg-header"})
	})

	t.Setenv("POSTMARK_API_KEY", "test-key")
	t.Setenv("EMAIL_FROM_ADDRESS", "noreply@example.com")

	SendOTPEmail("user@example.com", "abc def ghj", "login")

	found := false
	for _, h := range received.Headers {
		if h.Name == "Auto-Submitted" && h.Value == "auto-generated" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected Auto-Submitted header in request")
	}
}
