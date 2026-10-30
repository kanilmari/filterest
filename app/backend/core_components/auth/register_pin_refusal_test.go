// register_pin_refusal_test.go
// Pins server-rendered PIN refusals beneath the rejected registration field.
// Exercises the real handler for both refusal codes and existing/absent identities.
// Keeps the SEC4 refusal evidence present before JavaScript mounts the shared view.
package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRegisterPINRefusalRendersUnderField(t *testing.T) {
	for _, tc := range []struct {
		name, pin, confirmation, key, field, text string
	}{
		{"invalid", "123", "123", "first_run_fixed_pin_invalid", "fixed_pin", "The PIN must contain 4–8 digits."},
		{"mismatch", "1234", "5678", "first_run_fixed_pin_mismatch", "confirm_fixed_pin", "The PIN entries do not match."},
	} {
		for _, accept := range []string{"application/json", "text/html"} {
			t.Run(tc.name+"/"+accept, func(t *testing.T) {
				var absentBody string
				for _, identity := range []string{"", "email", "username", "login_name"} {
					t.Run("duplicate="+identity, func(t *testing.T) {
						state := setupRegisterAdmin(t)
						registrationEnabledFunc = func() bool { return true }
						state.duplicate = identity
						request := registrationValidationRequest(t, "verification_method", "fixed_pin", accept)
						if err := request.ParseForm(); err != nil {
							t.Fatal(err)
						}
						request.PostForm.Set("fixed_pin", tc.pin)
						request.PostForm.Set("confirm_fixed_pin", tc.confirmation)
						request = withRegistrationFormBody(request, request.PostForm.Encode())
						response := httptest.NewRecorder()
						RegisterAPIHandler(response, request)
						body := response.Body.String()
						if response.Code != http.StatusOK {
							t.Fatalf("status=%d, want 200", response.Code)
						}
						if strings.Count(body, `data-lang-key="`+tc.key+`"`) != 1 {
							t.Fatalf("expected exactly one server-rendered refusal key %s", tc.key)
						}
						message := `<p class="auth-verify__error" data-verify="error" data-lang-key="` + tc.key + `">` + tc.text + `</p>`
						groupStart := strings.Index(body, "data-pin-setup")
						if groupStart < 0 {
							t.Fatal("missing PIN setup group")
						}
						groupEnd := strings.Index(body[groupStart:], "</div>")
						if groupEnd < 0 {
							t.Fatal("unclosed PIN setup group")
						}
						group := body[groupStart : groupStart+groupEnd]
						fieldIndex := strings.Index(group, `id="`+tc.field+`"`)
						messageIndex := strings.Index(group, message)
						if fieldIndex < 0 || messageIndex <= fieldIndex || strings.Contains(group[fieldIndex:messageIndex], "<input") || strings.Contains(group[fieldIndex:messageIndex], "<label") {
							t.Fatalf("refusal must follow its PIN input inside the setup group: %s", tc.key)
						}
						if identity == "" {
							absentBody = body
						} else if body != absentBody {
							t.Error("existing and absent identity have different response bodies")
						}
						if state.duplicateReads != 0 || state.inserts != 0 {
							t.Error("PIN refusal reached identity lookup or writes")
						}
					})
				}
			})
		}
	}
}
