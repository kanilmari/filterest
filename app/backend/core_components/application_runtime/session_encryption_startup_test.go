// session_encryption_startup_test.go
// Exercises real startup exits in a child process with an isolated temporary root.
// Invalid database-name quoting prevents any database connection even if validation regresses.
// Keeps encryption and signing failures ahead of session-store and database initialization.
package application_runtime

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestSessionEncryptionStartup(t *testing.T) {
	if os.Getenv("FILTEREST_TEST_ENCRYPTION_STARTUP") == "1" {
		root := os.Getenv("FILTEREST_TEST_STARTUP_ROOT")
		Run(Options{
			InstallationRoot: root,
			ApplicationRoot:  root,
			BuildEnvironment: os.Getenv("FILTEREST_TEST_BUILD_MODE"),
		})
		return
	}
	for _, scenario := range []struct {
		name, mode, build, variable, key string
		refused                          bool
	}{
		{"prod missing", "prod", "dev", "SESSION_SECRET_KEY", "", true},
		{"production missing", "production", "dev", "SESSION_SECRET_KEY", "", true},
		{"staging missing", "staging", "dev", "SESSION_SECRET_KEY", "", true},
		{"test missing", "test", "dev", "SESSION_SECRET_KEY", "", true},
		{"unset mode missing", "", "dev", "SESSION_SECRET_KEY", "", true},
		{"prod whitespace", "prod", "dev", "SESSION_SECRET_KEY", " \t\r\n", true},
		{"prod dummy key", "prod", "dev", "SESSION_SECRET_KEY", "dummy-startup-encryption-key", false},
		{"dev missing", "dev", "dev", "SESSION_SECRET_KEY", "", false},
		{"dev whitespace", "dev", "dev", "SESSION_SECRET_KEY", " \t\r\n", false},
		{"production build cannot become dev", "dev", "prod", "SESSION_SECRET_KEY", "", true},
		{"prod signing template", "prod", "dev", "SESSION_KEY", "replace-me-with-32-plus-random-characters", true},
		{"prod short signing key", "prod", "dev", "SESSION_KEY", "short-dummy-key", false},
		{"dev signing template", "dev", "dev", "SESSION_KEY", "replace-me-with-32-plus-random-characters", false},
		{"dev signing blank", "dev", "dev", "SESSION_KEY", "\u2003", true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestSessionEncryptionStartup$")
			command.Dir = t.TempDir()
			keys := map[string]string{
				"SESSION_KEY":        "dummy-startup-signing-key",
				"SESSION_SECRET_KEY": "dummy-startup-encryption-key",
			}
			keys[scenario.variable] = scenario.key
			// Do not inherit operator environment paths or key material.
			command.Env = []string{
				"FILTEREST_TEST_ENCRYPTION_STARTUP=1",
				"FILTEREST_TEST_STARTUP_ROOT=" + command.Dir,
				"FILTEREST_TEST_BUILD_MODE=" + scenario.build,
				"ENVIRONMENT_TYPE=" + scenario.mode,
				"SESSION_KEY=" + keys["SESSION_KEY"],
				"SESSION_SECRET_KEY=" + keys["SESSION_SECRET_KEY"],
				"DB_HOST=dummy.invalid", "DB_PORT=5432", "DB_NAME='unterminated-dummy",
				"DB_ADMIN_USER=dummy_admin", "DB_ADMIN_PASSWORD=dummy",
				"DB_READONLY_USER=dummy_readonly", "DB_READONLY_PASSWORD=dummy",
				"DB_CONFIDENTIAL_USER=dummy_confidential", "DB_CONFIDENTIAL_PASSWORD=dummy",
				"DB_BASIC_USER=dummy_basic", "DB_BASIC_PASSWORD=dummy",
				"DB_GUEST_USER=dummy_guest", "DB_GUEST_PASSWORD=dummy",
			}
			output, err := command.CombinedOutput()
			exit, ok := err.(*exec.ExitError)
			if !ok || exit.ExitCode() != 1 || ctx.Err() != nil {
				t.Fatalf("expected immediate startup exit 1, got %v", err)
			}
			text := string(output)
			for _, key := range keys {
				if trimmed := strings.TrimSpace(key); trimmed != "" && strings.Contains(text, trimmed) {
					t.Fatal("startup exposed dummy key material")
				}
			}
			if scenario.refused {
				if !strings.Contains(text, "Configuration validation failed:") ||
					!strings.Contains(text, scenario.variable) || !strings.Contains(text, "runtime_contract.md#session-encryption") ||
					strings.Contains(text, "error opening") || strings.Contains(text, "session data will be stored unencrypted") ||
					strings.Contains(text, "using a temporary signing key") {
					t.Fatal("startup did not refuse the session key before session/database initialization")
				}
			} else {
				// Invalid quoting makes pq.NewConnector fail before constructing a connection.
				if !strings.Contains(text, "unterminated quoted string") || strings.Contains(text, "Configuration validation failed:") {
					t.Fatal("startup did not pass configuration validation and reach database configuration")
				}
				if scenario.mode == "dev" {
					warning := "SESSION_SECRET_KEY not set — sessions will be stored unencrypted"
					if scenario.variable == "SESSION_KEY" {
						warning = "SESSION_KEY is a placeholder — using a temporary signing key for this process"
					}
					if !strings.Contains(text, warning) {
						t.Fatal("development startup did not retain its warning")
					}
				}
			}
		})
	}
}
