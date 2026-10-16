// registration_validation_test.go
// Compares invalid public signup replies for existing and absent identities.
// Exercises the real handler and a SQL fixture that retains the name-pair constraint.
// Prevents duplicate success from bypassing any request refusal or required read.
package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSEC4RegistrationValidationPrecedesDuplicates(t *testing.T) {
	cases := []struct {
		name, field, value, key string
		status                  int
	}{
		{"equal_names", "display_name", "ordinary_fixture", "error_user_display_name_equals_login_name", http.StatusConflict},
		{"case_and_edge_spaces", "display_name", " ORDINARY_FIXTURE ", "error_user_display_name_equals_login_name", http.StatusConflict},
		{"weak_password", "password", "short", "first_run_password_invalid", http.StatusBadRequest},
		{"invalid_login", "username", "contains spaces", "login_name_invalid", http.StatusBadRequest},
		{"reserved_login", "username", "admin_123", "login_name_reserved", http.StatusConflict},
		{"empty_display", "display_name", " ", "username_empty", http.StatusBadRequest},
		{"invalid_csrf", "csrf_token", "wrong", "csrf_token_invalid", http.StatusForbidden},
		{"invalid_method", "verification_method", "totp", "first_run_verification_invalid", http.StatusOK},
		{"invalid_pin", "verification_method", "fixed_pin", "first_run_fixed_pin_invalid", http.StatusOK},
		{"nul_full_name", "full_name", "name\x00suffix", "registration_failed", http.StatusBadRequest},
		{"invalid_utf8_full_name", "full_name", "name\xffsuffix", "registration_failed", http.StatusBadRequest},
		{"oversized_display", "display_name", strings.Repeat("large-name-", 400), "registration_failed", http.StatusBadRequest},
		{"oversized_email", "email", strings.Repeat("large-address-", 400) + "@example.invalid", "registration_failed", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, accept := range []string{"application/json", "text/html"} {
				t.Run(accept, func(t *testing.T) {
					var absentBody string
					for _, identity := range []string{"", "email", "username", "login_name"} {
						t.Run("duplicate="+identity, func(t *testing.T) {
							state := setupRegisterAdmin(t)
							registrationEnabledFunc = func() bool { return true }
							state.namesMayEqual = false
							state.duplicate = identity
							request := registrationValidationRequest(t, tc.field, tc.value, accept)
							response := httptest.NewRecorder()
							RegisterAPIHandler(response, request)
							body := response.Body.String()
							if response.Code != tc.status || !strings.Contains(body, `data-lang-key="`+tc.key+`"`) {
								t.Errorf("status=%d want=%d; expected refusal key %s", response.Code, tc.status, tc.key)
							}
							if identity == "" {
								absentBody = body
							} else if body != absentBody {
								t.Error("existing and absent identity have different response bodies")
							}
							if state.inserts != 0 || state.duplicateReads != 0 {
								t.Errorf("invalid request reached identity lookup or writes: duplicate reads=%d inserts=%d", state.duplicateReads, state.inserts)
							}
						})
					}
				})
			}
		})
	}
}

func TestSEC4RegistrationRequiredReadsPrecedeDuplicates(t *testing.T) {
	for _, failure := range []struct {
		name, query string
		lookupReads int
	}{
		{"name_policy", "display_name_may_equal_login_name", 0},
		{"ordinary_group", "", 0},
		{"display_lookup", "lower(username)", 1},
		{"email_lookup", "lower(email)", 2},
	} {
		t.Run(failure.name, func(t *testing.T) {
			var absentBody string
			for _, identity := range []string{"", "email", "username", "login_name"} {
				t.Run("duplicate="+identity, func(t *testing.T) {
					state := setupRegisterAdmin(t)
					registrationEnabledFunc = func() bool { return true }
					state.duplicate = identity
					state.failQuery = failure.query
					if failure.name == "ordinary_group" {
						state.groupMissing = true
					}
					response := httptest.NewRecorder()
					RegisterAPIHandler(response, registrationValidationRequest(t, "", "", "application/json"))
					if response.Code != http.StatusInternalServerError {
						t.Errorf("status=%d want=500", response.Code)
					}
					if identity == "" {
						absentBody = response.Body.String()
					} else if response.Body.String() != absentBody {
						t.Error("required read failure discloses identity existence")
					}
					if state.inserts != 0 || state.duplicateReads != failure.lookupReads {
						t.Errorf("required read failed after duplicate reads=%d inserts=%d", state.duplicateReads, state.inserts)
					}
				})
			}
		})
	}
}

func TestSEC4RegistrationAllowsEqualNamesWhenConfigured(t *testing.T) {
	for _, identity := range []string{"", "email", "username", "login_name"} {
		t.Run("duplicate="+identity, func(t *testing.T) {
			state := setupRegisterAdmin(t)
			registrationEnabledFunc = func() bool { return true }
			state.duplicate = identity
			response := httptest.NewRecorder()
			RegisterAPIHandler(response, registrationValidationRequest(t, "display_name", "ordinary_fixture", "application/json"))
			if response.Code != http.StatusOK || response.Body.String() != "{\"redirect\":\"/login\",\"registered\":true}\n" {
				t.Fatalf("allowed names: status=%d body=%s", response.Code, response.Body.String())
			}
			if state.namePolicyReads != 1 {
				t.Fatal("name policy must be checked even for duplicate identities")
			}
			if state.duplicateReads != 3 {
				t.Fatal("duplicate success must wait for every identity lookup")
			}
			wantInserts := 0
			if identity == "" {
				wantInserts = 1
			}
			if state.inserts != wantInserts {
				t.Fatalf("inserts=%d want=%d", state.inserts, wantInserts)
			}
		})
	}
}

func TestSEC4RegistrationAllowsDifferentNamesWhenRequired(t *testing.T) {
	state := setupRegisterAdmin(t)
	registrationEnabledFunc = func() bool { return true }
	state.namesMayEqual = false
	response := httptest.NewRecorder()
	RegisterAPIHandler(response, registrationValidationRequest(t, "", "", "application/json"))
	if response.Code != http.StatusOK || state.inserts != 1 {
		t.Fatalf("distinct names refused: status=%d inserts=%d", response.Code, state.inserts)
	}
}

func registrationValidationRequest(t *testing.T, field, value, accept string) *http.Request {
	t.Helper()
	t.Setenv("POSTMARK_API_KEY", "")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")
	request := registerAdminRequest(t, map[interface{}]interface{}{"csrf_token": "test-csrf"}, "test-csrf")
	if err := request.ParseForm(); err != nil {
		t.Fatal(err)
	}
	if field != "" {
		request.PostForm.Set(field, value)
	}
	request.URL.RawQuery = "fragment=1"
	request = withRegistrationFormBody(request, request.PostForm.Encode())
	request.RemoteAddr = "192.0.2.42:1234"
	request.Header.Set("Accept", accept)
	return request
}
