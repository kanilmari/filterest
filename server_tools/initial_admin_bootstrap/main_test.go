// main_test.go
// Verifies the initial Filterest admin bootstrap helper's pure safety logic.
// Bridges site-slug normalization, handoff-file permissions, and generated credential text.
// Exists so the public setup path keeps deterministic username and secret-file behavior.
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSanitizeSiteSlugDefaultsToFilterest(t *testing.T) {
	tests := map[string]string{
		"":              "filterest",
		"   ":           "filterest",
		"Filterest":     "filterest",
		"My Site.fi":    "my_site_fi",
		"---Example---": "example",
	}

	for input, want := range tests {
		if got := sanitizeSiteSlug(input); got != want {
			t.Fatalf("sanitizeSiteSlug(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestUsernameUsesAdminSiteSlugFormat(t *testing.T) {
	cfg := initialAdminConfig{siteSlug: "Example Site"}

	if got := cfg.username(); got != "admin_example_site" {
		t.Fatalf("username = %q, want admin_example_site", got)
	}
}

func TestParseConfigRequiresEmailUnlessDevOverride(t *testing.T) {
	t.Setenv("FILTEREST_DB_PASSWORD", "secret")

	if _, err := parseConfig([]string{}); err == nil || !strings.Contains(err.Error(), "FILTEREST_INITIAL_ADMIN_EMAIL") {
		t.Fatalf("parseConfig without email error = %v, want FILTEREST_INITIAL_ADMIN_EMAIL requirement", err)
	}

	cfg, err := parseConfig([]string{"--allow-invalid-email"})
	if err != nil {
		t.Fatalf("parseConfig with dev override returned error: %v", err)
	}
	if cfg.email != "admin@filterest.invalid" {
		t.Fatalf("email = %q, want admin@filterest.invalid", cfg.email)
	}
}

func TestParseConfigAcceptsExplicitEmail(t *testing.T) {
	t.Setenv("FILTEREST_DB_PASSWORD", "secret")

	cfg, err := parseConfig([]string{"--site-slug", "Customer Site", "--email", "admin@example.test"})
	if err != nil {
		t.Fatalf("parseConfig returned error: %v", err)
	}
	if cfg.username() != "admin_customer_site" {
		t.Fatalf("username = %q, want admin_customer_site", cfg.username())
	}
	if cfg.email != "admin@example.test" {
		t.Fatalf("email = %q, want admin@example.test", cfg.email)
	}
}

func TestWriteCredentialHandoffUses0600File(t *testing.T) {
	tmp := t.TempDir()
	handoffPath := filepath.Join(tmp, "data", "bootstrap", "initial_admin_credentials.txt")
	result := initialAdminResult{
		username:  "admin_filterest",
		password:  "secret-password",
		email:     "admin@filterest.invalid",
		createdAt: time.Date(2026, 7, 5, 4, 0, 0, 0, time.UTC),
	}

	if err := writeCredentialHandoff(handoffPath, result); err != nil {
		t.Fatalf("writeCredentialHandoff returned error: %v", err)
	}

	info, err := os.Stat(handoffPath)
	if err != nil {
		t.Fatalf("handoff file missing: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("handoff file mode = %o, want 600", got)
	}

	content, err := os.ReadFile(handoffPath)
	if err != nil {
		t.Fatalf("read handoff file: %v", err)
	}
	text := string(content)
	for _, fragment := range []string{
		"Username: admin_filterest",
		"Password: secret-password",
		"Delete this file after the first login and password rotation.",
		"The public bootstrap seed does not contain reusable admin credentials.",
	} {
		if !strings.Contains(text, fragment) {
			t.Fatalf("handoff content missing %q\n%s", fragment, text)
		}
	}
}
