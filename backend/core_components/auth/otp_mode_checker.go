// otp_mode_checker.go
// Resolves shared environment and outbound-email readiness for authentication flows.
// Bridges environment configuration and setup/login handlers.
// Exists so runtime readiness checks stay centralized without selecting auth by environment.

package auth

import (
	"os"
	"strings"
)

// isExplicitDevEnvironment keeps auth-only dev fallbacks gated behind the explicit dev env.
func isExplicitDevEnvironment() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("ENVIRONMENT_TYPE")), "dev")
}

// firstConfiguredAuthEnv resolves the first non-empty auth-related env alias.
func firstConfiguredAuthEnv(keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value != "" {
			return value
		}
	}
	return ""
}

// isPostmarkDeliveryConfiguredForAuth keeps auth OTP gating aligned with both canonical and legacy Postmark env names.
func isPostmarkDeliveryConfiguredForAuth() bool {
	return firstConfiguredAuthEnv("POSTMARK_API_KEY", "POSTMARK_SERVER_TOKEN") != ""
}
