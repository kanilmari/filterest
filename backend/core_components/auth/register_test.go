// register_test.go
// Verifies that GET /register now hands off into the SPA guest shell instead of rendering directly.
// Bridges RegisterHandler route behavior and the register-entry redirect contract without invoking template rendering.
// Exists to keep the guest-shell register entry stable while the actual form stays server-rendered.
package auth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func withRegistrationEnabledForTest(t *testing.T) {
	t.Helper()
	original := registrationEnabledFunc
	registrationEnabledFunc = func() bool { return true }
	t.Cleanup(func() {
		registrationEnabledFunc = original
	})
}

func TestRegisterHandlerRedirectsGuestEntryWithoutRedirectParam(t *testing.T) {
	withRegistrationEnabledForTest(t)

	req := httptest.NewRequest(http.MethodGet, "/register_ndYOyXV0INOK3F", nil)
	rr := httptest.NewRecorder()

	RegisterHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}

	if got := rr.Header().Get("Location"); got != "/?register-entry=1" {
		t.Fatalf("Location = %q, want %q", got, "/?register-entry=1")
	}
}

func TestRegisterHandlerRedirectsGuestEntryWithEncodedRedirectParam(t *testing.T) {
	withRegistrationEnabledForTest(t)

	req := httptest.NewRequest(http.MethodGet, "/register_ndYOyXV0INOK3F?redirect=%2Fapp_service_catalog%3Ffoo%3D1%26bar%3D2", nil)
	rr := httptest.NewRecorder()

	RegisterHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}

	got := rr.Header().Get("Location")
	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("Location parse failed for %q: %v", got, err)
	}

	if parsed.Path != "/" {
		t.Fatalf("Location path = %q, want %q", parsed.Path, "/")
	}
	if parsed.Query().Get("register-entry") != "1" {
		t.Fatalf("register-entry = %q, want %q", parsed.Query().Get("register-entry"), "1")
	}
	if parsed.Query().Get("redirect") != "/app_service_catalog?foo=1&bar=2" {
		t.Fatalf("redirect = %q, want %q", parsed.Query().Get("redirect"), "/app_service_catalog?foo=1&bar=2")
	}
}

func TestValidateRegistrationVerificationAcceptsPasswordOnly(t *testing.T) {
	method, validationKey := validateRegistrationVerification("none", "", "")
	if validationKey != "" {
		t.Fatalf("validation key = %q, want empty", validationKey)
	}
	if method != verificationNone {
		t.Fatalf("method = %q, want %q", method, verificationNone)
	}
}

func TestValidateRegistrationVerificationRequiresMatchingFixedPIN(t *testing.T) {
	if _, key := validateRegistrationVerification("fixed_pin", "123", "123"); key != "first_run_fixed_pin_invalid" {
		t.Fatalf("short PIN validation key = %q", key)
	}
	if _, key := validateRegistrationVerification("fixed_pin", "1234", "5678"); key != "first_run_fixed_pin_mismatch" {
		t.Fatalf("mismatched PIN validation key = %q", key)
	}
	method, key := validateRegistrationVerification("fixed_pin", "1234", "1234")
	if key != "" || method != verificationFixedPIN {
		t.Fatalf("valid PIN result = (%q, %q), want (%q, empty)", method, key, verificationFixedPIN)
	}
}

func TestValidateRegistrationVerificationRejectsMissingAndTOTPMethods(t *testing.T) {
	for _, method := range []string{"", "totp", "unknown"} {
		if _, key := validateRegistrationVerification(method, "", ""); key != "first_run_verification_invalid" {
			t.Errorf("method %q validation key = %q", method, key)
		}
	}
}

func TestValidateRegistrationVerificationOffersEmailOnlyWhenDeliveryIsConfigured(t *testing.T) {
	t.Setenv("POSTMARK_API_KEY", "test-token")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")
	t.Setenv("EMAIL_FROM_ADDRESS", "")
	t.Setenv("POSTMARK_FROM_ADDRESS", "")
	if _, key := validateRegistrationVerification("email", "", ""); key != "first_run_postmark_required" {
		t.Fatalf("email without sender validation key = %q", key)
	}

	t.Setenv("EMAIL_FROM_ADDRESS", "noreply@example.test")
	method, key := validateRegistrationVerification("email", "", "")
	if key != "" || method != verificationEmail {
		t.Fatalf("configured email result = (%q, %q), want (%q, empty)", method, key, verificationEmail)
	}
}

func TestBuildRegistrationFixedPINHashNeverStoresPlainPIN(t *testing.T) {
	const pin = "2468"
	hash, err := buildRegistrationFixedPINHash(verificationFixedPIN, pin)
	if err != nil {
		t.Fatalf("build fixed PIN hash: %v", err)
	}
	if hash == "" || hash == pin {
		t.Fatalf("fixed PIN hash must be non-empty and different from the PIN")
	}
	if !verifyFixedPIN(hash, pin) {
		t.Fatalf("fixed PIN hash does not verify")
	}

	noneHash, err := buildRegistrationFixedPINHash(verificationNone, pin)
	if err != nil || noneHash != "" {
		t.Fatalf("password-only hash = %q, err = %v; want empty, nil", noneHash, err)
	}
}

func TestSelectedRegistrationVerificationMethodDefaultsToFixedPIN(t *testing.T) {
	if got := selectedRegistrationVerificationMethod("", false); got != "fixed_pin" {
		t.Fatalf("empty selection = %q, want fixed_pin", got)
	}
	if got := selectedRegistrationVerificationMethod("email", false); got != "fixed_pin" {
		t.Fatalf("unavailable email selection = %q, want fixed_pin", got)
	}
	if got := selectedRegistrationVerificationMethod("none", false); got != "none" {
		t.Fatalf("explicit password-only selection = %q, want none", got)
	}
}
