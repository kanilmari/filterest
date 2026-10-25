// config_validation.go
// Validates critical environment variables before the application proceeds
// with database connections and session initialization. Called early in
// main.go to fail fast with clear error messages.
package backend

import (
	"easelect/backend/core_components/middlewares/firewall"
	e_sessions "easelect/backend/core_components/sessions"
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

// validateCredentialRoleSeparation refuses a confidential database role that is also the signed-in users' or the
// visitors' role. Start-up grants the confidential role the credential tables before anything else checks the
// roles (EnsureConfidentialRolePermissions), so a shared role must be refused here, before any connection opens.
func validateCredentialRoleSeparation() error {
	confidentialRole := strings.TrimSpace(os.Getenv("DB_CONFIDENTIAL_USER"))
	for _, key := range []string{"DB_BASIC_USER", "DB_GUEST_USER"} {
		if confidentialRole != "" && confidentialRole == strings.TrimSpace(os.Getenv(key)) {
			return fmt.Errorf("DB_CONFIDENTIAL_USER must differ from %s: the confidential role holds the credential tables", key)
		}
	}
	return nil
}

// ValidateConfig rejects missing or invalid critical settings before startup.
// Both session keys reject placeholders outside dev; blank signing keys always fail.
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
		value := os.Getenv(key)
		if key == "SESSION_KEY" {
			value = strings.TrimSpace(value)
		}
		if value == "" {
			missing = append(missing, key)
		}
	}

	// Reuse the environment loader's mode reader; never include key material in diagnostics.
	if e_sessions.IsMissingSessionKey(os.Getenv("SESSION_SECRET_KEY")) {
		if EnvironmentType() != "dev" {
			return fmt.Errorf("SESSION_SECRET_KEY is required outside dev; see app/docs/instructions_and_documentation/runtime_contract.md#session-encryption")
		}
		log.Println("⚠ SESSION_SECRET_KEY not set — sessions will be stored unencrypted")
	}
	signingKey := os.Getenv("SESSION_KEY")
	if e_sessions.IsMissingSessionKey(signingKey) && strings.TrimSpace(signingKey) != "" {
		if EnvironmentType() != "dev" {
			return fmt.Errorf("SESSION_KEY is required outside dev; see app/docs/instructions_and_documentation/runtime_contract.md#session-encryption")
		}
		log.Println("⚠ SESSION_KEY is a placeholder — using a temporary signing key for this process")
	}
	logOptionalPostmarkWarnings()

	if missing != nil {
		guidance := ""
		if strings.TrimSpace(signingKey) == "" {
			guidance = "\nsee app/docs/instructions_and_documentation/runtime_contract.md#session-encryption"
		}
		return fmt.Errorf("missing required environment variables:\n  %s%s",
			strings.Join(missing, "\n  "), guidance)
	}
	if err := validateCredentialRoleSeparation(); err != nil {
		return err
	}
	if err := e_sessions.ValidateAuthCookieEnvironment(); err != nil {
		return fmt.Errorf("invalid authentication-cookie configuration: %w", err)
	}
	if err := firewall.ValidateTrustedProxyConfiguration(); err != nil {
		return fmt.Errorf("invalid trusted reverse-proxy configuration: %w", err)
	}

	return nil
}
