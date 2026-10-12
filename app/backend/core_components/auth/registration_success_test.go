// registration_success_test.go
// Verifies completed registration renders a neutral notice for every mail outcome.
// Connects the real Go template and existing JSON/log diagnostics without PostgreSQL.
// Keeps welcome-email configuration out of the person-facing success notice.
package auth

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"easelect/backend/core_components/logging"
)

func assertNeutralRegistrationHTML(t *testing.T, response *httptest.ResponseRecorder) {
	t.Helper()
	body := response.Body.String()
	if response.Code != http.StatusOK || !strings.Contains(body, `data-lang-key="registration_account_created"`) ||
		!strings.Contains(body, `data-registration-complete="true"`) || !strings.Contains(body, `href="/login"`) {
		t.Fatal("successful registration must show a completion notice and the existing sign-in link")
	}
	if strings.Contains(body, "registration_email_") || strings.Contains(body, `data-testid="register-password"`) {
		t.Fatal("completed registration still shows email status or account-entry fields")
	}
}

func TestRegistrationSuccessNoticeIndependentOfMailDelivery(t *testing.T) {
	prepareLoginHandlerSessionStore(t)
	setupLoginHandlerMockDB(t, false)
	previous := frontend_dir
	frontend_dir = filepath.Join("..", "..", "..", "frontend")
	t.Cleanup(func() { frontend_dir = previous })
	var logOutput bytes.Buffer
	logging.SetOutput(&logOutput)
	t.Cleanup(func() { logging.SetOutput(os.Stderr) })

	for _, status := range []string{"registration_email_sent", "registration_email_failed", "registration_email_not_configured"} {
		for _, target := range []string{"/register", "/register?fragment=1"} {
			t.Run(status+target, func(t *testing.T) {
				logOutput.Reset()
				response := httptest.NewRecorder()
				respondRegistrationSuccess(response, httptest.NewRequest(http.MethodPost, target, nil), status, "fixed_pin")
				assertNeutralRegistrationHTML(t, response)
				if status != "registration_email_sent" && !strings.Contains(logOutput.String(), status) {
					t.Fatal("the existing server log must retain the mail configuration/delivery diagnostic")
				}
			})
		}
	}
}

func TestRegistrationSuccessPreservesJSONMailDiagnostic(t *testing.T) {
	for _, status := range []string{"registration_email_sent", "registration_email_failed", "registration_email_not_configured"} {
		t.Run(status, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/register", nil)
			request.Header.Set("Accept", "application/json")
			response := httptest.NewRecorder()
			respondRegistrationSuccess(response, request, status, "none")
			var payload struct {
				Registered bool   `json:"registered"`
				MailStatus string `json:"mail_status"`
				Redirect   string `json:"redirect"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if response.Code != http.StatusOK || !payload.Registered || payload.MailStatus != status || payload.Redirect != "/login" {
				t.Fatalf("JSON account API changed: %+v", payload)
			}
		})
	}
}

func TestRegistrationHandlerRendersNeutralNoticeAfterAccountCommit(t *testing.T) {
	state := setupRegisterAdmin(t)
	t.Setenv("POSTMARK_API_KEY", "")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")
	request := registerAdminRequest(t, validRegistrationAdminSession(), "test-csrf")
	response := httptest.NewRecorder()
	RegisterAPIHandler(response, request)
	if state.inserts != 1 {
		t.Fatal("registration must commit the account before reporting success")
	}
	assertNeutralRegistrationHTML(t, response)
}
