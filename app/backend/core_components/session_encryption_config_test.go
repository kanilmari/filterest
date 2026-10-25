// session_encryption_config_test.go
// Verifies both startup session-key requirements without a database or HTTP server.
// Connects the shared environment reader and validator to dummy-only diagnostics.
// Keeps development exceptions and the production boundary in one test matrix.
package backend

import (
	"bytes"
	"log"
	"os"
	"strings"
	"testing"
)

func captureEncryptionConfigLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previous) })
	return &output
}

func TestValidateConfigSessionEncryption(t *testing.T) {
	validateSessionKeyConfig(t, "SESSION_SECRET_KEY")
}

func TestValidateConfigSessionSigning(t *testing.T) {
	validateSessionKeyConfig(t, "SESSION_KEY")
}

func validateSessionKeyConfig(t *testing.T, variable string) {
	t.Helper()
	environments := []struct {
		name  string
		value string
		dev   bool
	}{
		{"prod", "prod", false},
		{"production", "production", false},
		{"stage", "stage", false},
		{"staging", "staging", false},
		{"test", "test", false},
		{"testing", "testing", false},
		{"qa", "qa", false},
		{"preview", "preview", false},
		{"unknown", "unrecognized-environment", false},
		{"development is not dev", "development", false},
		{"uppercase is not dev", "DEV", false},
		{"mixed case is not dev", "Dev", false},
		{"empty defaults to prod", "", false},
		{"whitespace defaults to prod", " \t\r\n", false},
		{"unset defaults to prod", "", false},
		{"dev", "dev", true},
		{"trimmed dev", " \tdev\r\n", true},
	}
	keys := []struct {
		name, value string
		missing     bool
	}{
		{"unset", "", true},
		{"empty", "", true},
		{"spaces", "   ", true},
		{"whitespace", "\t\r\n", true},
		{"unicode whitespace", "\u2003", true},
		{"template placeholder", "replace-me-with-32-plus-random-characters", true},
		{"placeholder prefix", "replace-me-custom-placeholder", true},
		{"trimmed placeholder", " \treplace-me\r\n", true},
		{"short existing key", "x", false},
		{"short dummy key", "short-dummy-key", false},
		{"non-prefix existing key", "keep-replace-me", false},
		{"dummy key", "dummy-session-encryption-key", false},
	}
	for _, environment := range environments {
		t.Run(environment.name, func(t *testing.T) {
			for _, key := range keys {
				t.Run(key.name, func(t *testing.T) {
					setRequiredConfigEnv(t)
					t.Setenv("ENVIRONMENT_TYPE", environment.value)
					if environment.name == "unset defaults to prod" {
						if err := os.Unsetenv("ENVIRONMENT_TYPE"); err != nil {
							t.Fatal(err)
						}
					}
					t.Setenv(variable, key.value)
					if key.name == "unset" {
						if err := os.Unsetenv(variable); err != nil {
							t.Fatal(err)
						}
					}
					output := captureEncryptionConfigLog(t)
					err := ValidateConfig()
					trimmed := strings.TrimSpace(key.value)
					diagnostics := output.String()
					if err != nil {
						diagnostics += err.Error()
					}
					for _, dummy := range []string{trimmed, "test-value", "dummy-session-encryption-key"} {
						if len(dummy) > 1 && strings.Contains(diagnostics, dummy) {
							t.Fatal("session diagnostics exposed dummy key material")
						}
					}
					refused := key.missing && (!environment.dev || (variable == "SESSION_KEY" && trimmed == ""))
					if refused {
						if err == nil || !strings.Contains(err.Error(), variable) ||
							!strings.Contains(err.Error(), "runtime_contract.md#session-encryption") {
							t.Fatal("startup must refuse the key with its variable name and contract link")
						}
						if variable == "SESSION_SECRET_KEY" && err.Error() != "SESSION_SECRET_KEY is required outside dev; see app/docs/instructions_and_documentation/runtime_contract.md#session-encryption" {
							t.Fatal("encryption refusal changed")
						}
					} else if err != nil {
						t.Fatalf("startup validation failed: %v", err)
					}
					warning := "SESSION_SECRET_KEY not set — sessions will be stored unencrypted"
					if variable == "SESSION_KEY" {
						warning = "SESSION_KEY is a placeholder — using a temporary signing key for this process"
					}
					warned := strings.Contains(output.String(), warning)
					if warned != (key.missing && environment.dev && !refused) {
						t.Fatal("unexpected session-key warning state")
					}
				})
			}
		})
	}
}
