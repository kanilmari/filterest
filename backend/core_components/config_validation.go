// config_validation.go
// Validates critical environment variables before the application proceeds
// with database connections and session initialization. Called early in
// main.go to fail fast with clear error messages.
package backend

import (
	"fmt"
	"log"
	"os"
	"strings"
)

// firstConfiguredOptionalEnv resolves the first non-empty value from related optional env keys.
func firstConfiguredOptionalEnv(keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value != "" {
			return value
		}
	}
	return ""
}

// logOptionalPostmarkWarnings surfaces incomplete outbound email config early without blocking startup.
func logOptionalPostmarkWarnings() {
	postmarkToken := firstConfiguredOptionalEnv("POSTMARK_API_KEY", "POSTMARK_SERVER_TOKEN")
	postmarkFrom := firstConfiguredOptionalEnv("EMAIL_FROM_ADDRESS", "POSTMARK_FROM_ADDRESS")
	usesLegacyToken := strings.TrimSpace(os.Getenv("POSTMARK_API_KEY")) == "" &&
		strings.TrimSpace(os.Getenv("POSTMARK_SERVER_TOKEN")) != ""
	usesLegacyFrom := strings.TrimSpace(os.Getenv("EMAIL_FROM_ADDRESS")) == "" &&
		strings.TrimSpace(os.Getenv("POSTMARK_FROM_ADDRESS")) != ""

	switch {
	case postmarkToken == "" && postmarkFrom == "":
		log.Println("⚠ Postmark outbound email not configured — email sign-in verification, password recovery, profile email verification, and outbound replies will fail; password-only, fixed-PIN, and authenticator sign-in remain available")
	case postmarkToken == "" || postmarkFrom == "":
		log.Println("⚠ Postmark config incomplete — set both POSTMARK_API_KEY and EMAIL_FROM_ADDRESS (legacy POSTMARK_SERVER_TOKEN / POSTMARK_FROM_ADDRESS are still accepted)")
	case usesLegacyToken || usesLegacyFrom:
		log.Println("⚠ Postmark config still relies on legacy env names in this scope; prefer POSTMARK_API_KEY and EMAIL_FROM_ADDRESS")
	}
}

// ValidateConfig checks that all critical environment variables are set.
// Returns an error listing all missing variables if any are absent.
// Also logs warnings for optional-but-recommended variables.
func ValidateConfig() error {
	required := []string{
		"SESSION_KEY",
		"DB_HOST",
		"DB_PORT",
		"DB_NAME",
		"DB_ADMIN_USER",
		"DB_ADMIN_PASSWORD",
		"DB_READONLY_USER",
		"DB_READONLY_PASSWORD",
		"DB_CONFIDENTIAL_USER",
		"DB_CONFIDENTIAL_PASSWORD",
		"DB_BASIC_USER",
		"DB_BASIC_PASSWORD",
		"DB_GUEST_USER",
		"DB_GUEST_PASSWORD",
	}

	var missing []string
	for _, key := range required {
		if os.Getenv(key) == "" {
			missing = append(missing, key)
		}
	}

	// Warnings for optional but recommended variables
	if os.Getenv("SESSION_SECRET_KEY") == "" {
		log.Println("⚠ SESSION_SECRET_KEY not set — sessions will be stored unencrypted")
	}
	logOptionalPostmarkWarnings()

	if missing != nil {
		return fmt.Errorf("missing required environment variables:\n  %s",
			strings.Join(missing, "\n  "))
	}

	return nil
}
