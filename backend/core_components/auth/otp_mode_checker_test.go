// Covers shared authentication environment and Postmark readiness helpers.
// Exists to keep external-email aliases and explicit development detection stable.

package auth

import "testing"

func TestIsExplicitDevEnvironment(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	if !isExplicitDevEnvironment() {
		t.Fatal("explicit dev environment was not recognized")
	}
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	if isExplicitDevEnvironment() {
		t.Fatal("production environment was treated as development")
	}
}

func TestPostmarkDeliveryConfigurationAcceptsCanonicalAndLegacyToken(t *testing.T) {
	t.Setenv("POSTMARK_API_KEY", "canonical-key")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")
	if !isPostmarkDeliveryConfiguredForAuth() {
		t.Fatal("canonical Postmark token was not recognized")
	}
	t.Setenv("POSTMARK_API_KEY", "")
	t.Setenv("POSTMARK_SERVER_TOKEN", "legacy-key")
	if !isPostmarkDeliveryConfiguredForAuth() {
		t.Fatal("legacy Postmark token was not recognized")
	}
}
