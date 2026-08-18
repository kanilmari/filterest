package backend

import (
	"bytes"
	"log"
	"os"
	"strings"
	"testing"
)

func setRequiredConfigEnv(t *testing.T) {
	t.Helper()
	t.Setenv("SESSION_COOKIE_MODE", "isolated")
	t.Setenv("SESSION_COOKIE_NAME", "")
	t.Setenv("INSTANCE_NAME", "config-test")
	required := []string{
		"SESSION_KEY", "DB_HOST", "DB_PORT", "DB_NAME",
		"DB_ADMIN_USER", "DB_ADMIN_PASSWORD",
		"DB_READONLY_USER", "DB_READONLY_PASSWORD",
		"DB_CONFIDENTIAL_USER", "DB_CONFIDENTIAL_PASSWORD",
		"DB_BASIC_USER", "DB_BASIC_PASSWORD",
		"DB_GUEST_USER", "DB_GUEST_PASSWORD",
	}
	for _, key := range required {
		t.Setenv(key, "test-value")
	}
}

func TestValidateConfigRejectsSharedCookieWithoutReplicaPoolMode(t *testing.T) {
	setRequiredConfigEnv(t)
	t.Setenv("SESSION_COOKIE_NAME", "shared_session")

	err := ValidateConfig()
	if err == nil || !strings.Contains(err.Error(), "replica-pool") {
		t.Fatalf("ValidateConfig() error = %v, want explicit replica-pool requirement", err)
	}
}

func TestValidateConfigRequiresSharedCookieInReplicaPoolMode(t *testing.T) {
	setRequiredConfigEnv(t)
	t.Setenv("SESSION_COOKIE_MODE", "replica-pool")
	t.Setenv("SESSION_COOKIE_NAME", "")

	err := ValidateConfig()
	if err == nil || !strings.Contains(err.Error(), "SESSION_COOKIE_NAME is required") {
		t.Fatalf("ValidateConfig() error = %v, want missing shared cookie error", err)
	}
}

func TestValidateConfigAcceptsExplicitReplicaPoolContract(t *testing.T) {
	setRequiredConfigEnv(t)
	t.Setenv("SESSION_COOKIE_MODE", "replica-pool")
	t.Setenv("SESSION_COOKIE_NAME", "shared_session")
	t.Setenv("SESSION_SECRET_KEY", "shared-encryption-secret")

	if err := ValidateConfig(); err != nil {
		t.Fatalf("ValidateConfig() returned error for explicit replica pool: %v", err)
	}
}

func TestValidateConfigAllSet(t *testing.T) {
	setRequiredConfigEnv(t)

	if err := ValidateConfig(); err != nil {
		t.Errorf("ValidateConfig should pass when all vars set, got: %v", err)
	}
}

func TestValidateConfigMissing(t *testing.T) {
	// Clear all required vars
	required := []string{
		"SESSION_KEY", "DB_HOST", "DB_PORT", "DB_NAME",
		"DB_ADMIN_USER", "DB_ADMIN_PASSWORD",
		"DB_READONLY_USER", "DB_READONLY_PASSWORD",
		"DB_CONFIDENTIAL_USER", "DB_CONFIDENTIAL_PASSWORD",
		"DB_BASIC_USER", "DB_BASIC_PASSWORD",
		"DB_GUEST_USER", "DB_GUEST_PASSWORD",
	}
	for _, key := range required {
		t.Setenv(key, "")
		os.Unsetenv(key)
	}

	err := ValidateConfig()
	if err == nil {
		t.Fatal("ValidateConfig should fail when required vars are missing")
	}

	for _, key := range required {
		if !contains(err.Error(), key) {
			t.Errorf("error should mention missing var %s", key)
		}
	}
}

func TestValidateConfigPartialMissing(t *testing.T) {
	// Set all except SESSION_KEY
	setRequiredConfigEnv(t)
	t.Setenv("SESSION_KEY", "")
	os.Unsetenv("SESSION_KEY")

	err := ValidateConfig()
	if err == nil {
		t.Fatal("ValidateConfig should fail when SESSION_KEY is missing")
	}
	if !contains(err.Error(), "SESSION_KEY") {
		t.Error("error should mention SESSION_KEY")
	}
	if contains(err.Error(), "DB_HOST") {
		t.Error("error should not mention DB_HOST when it is set")
	}
}

func TestValidateConfigWarnsWhenPostmarkConfigIncomplete(t *testing.T) {
	setRequiredConfigEnv(t)
	t.Setenv("ENVIRONMENT_TYPE", "production")
	t.Setenv("POSTMARK_API_KEY", "live-key")
	t.Setenv("EMAIL_FROM_ADDRESS", "")
	t.Setenv("POSTMARK_FROM_ADDRESS", "")

	var logBuffer bytes.Buffer
	originalWriter := log.Writer()
	log.SetOutput(&logBuffer)
	t.Cleanup(func() {
		log.SetOutput(originalWriter)
	})

	if err := ValidateConfig(); err != nil {
		t.Fatalf("ValidateConfig should still pass with optional Postmark warning, got: %v", err)
	}
	if !strings.Contains(logBuffer.String(), "Postmark config incomplete") {
		t.Fatalf("expected incomplete Postmark warning, got %q", logBuffer.String())
	}
}

func TestValidateConfigWarnsWhenOnlyLegacyPostmarkNamesAreUsed(t *testing.T) {
	setRequiredConfigEnv(t)
	t.Setenv("ENVIRONMENT_TYPE", "production")
	t.Setenv("POSTMARK_API_KEY", "")
	t.Setenv("EMAIL_FROM_ADDRESS", "")
	t.Setenv("POSTMARK_SERVER_TOKEN", "legacy-key")
	t.Setenv("POSTMARK_FROM_ADDRESS", "legacy@example.com")

	var logBuffer bytes.Buffer
	originalWriter := log.Writer()
	log.SetOutput(&logBuffer)
	t.Cleanup(func() {
		log.SetOutput(originalWriter)
	})

	if err := ValidateConfig(); err != nil {
		t.Fatalf("ValidateConfig should still pass with legacy-name warning, got: %v", err)
	}
	if !strings.Contains(logBuffer.String(), "legacy env names") {
		t.Fatalf("expected legacy env warning, got %q", logBuffer.String())
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStr(s, substr))
}

func containsStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
