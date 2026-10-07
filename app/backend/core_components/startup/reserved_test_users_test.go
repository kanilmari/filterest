// reserved_test_users_test.go
// Verifies the local administrator fixture's input and target restrictions.
// Real atomic lifecycle proofs live with the disposable PostgreSQL handler tests.
// Keeps configuration validation independent of database access.
package startup

import (
	"strings"
	"testing"
)

func TestConfiguredDevAdminRequiresProtectedPassword(t *testing.T) {
	t.Setenv(configuredDevAdminUsernameEnv, "adm")
	t.Setenv(configuredDevAdminPasswordEnv, "")
	t.Setenv("BASE_URL", "https://localhost:8100")

	_, err := reservedTestUserFixturesForDevelopment()
	if err == nil || !strings.Contains(err.Error(), configuredDevAdminPasswordEnv) {
		t.Fatalf("reservedTestUserFixturesForDevelopment() error = %v", err)
	}
}

func TestConfiguredDevAdminRejectsUnsafeUsername(t *testing.T) {
	t.Setenv(configuredDevAdminUsernameEnv, "../adm")
	t.Setenv(configuredDevAdminPasswordEnv, "protected-dev-password")
	t.Setenv("BASE_URL", "https://localhost:8100")

	_, err := reservedTestUserFixturesForDevelopment()
	if err == nil || !strings.Contains(err.Error(), configuredDevAdminUsernameEnv) {
		t.Fatalf("reservedTestUserFixturesForDevelopment() error = %v", err)
	}
}

func TestConfiguredDevAdminRejectsNonLoopbackTarget(t *testing.T) {
	t.Setenv(configuredDevAdminUsernameEnv, "adm")
	t.Setenv(configuredDevAdminPasswordEnv, "protected-dev-password")
	t.Setenv("BASE_URL", "https://filterest.example")

	_, err := reservedTestUserFixturesForDevelopment()
	if err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("reservedTestUserFixturesForDevelopment() error = %v", err)
	}
}

func TestReservedAccountLogsAndOrphanErrorsContainOnlyCountAndID(t *testing.T) {
	if got := reservedTestUsernamesForLog(reservedTestUserFixtures); got != "2 accounts" {
		t.Fatal(got)
	}
	err := (&reservedAccountOrphan{id: 123}).Error()
	if !strings.Contains(err, "123") || strings.Contains(err, "test_user") {
		t.Fatal(err)
	}
}

func TestConfiguredNumberedDevAdminAndEmailPrivacy(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv(configuredDevAdminUsernameEnv, "admin_7")
	t.Setenv(configuredDevAdminPasswordEnv, "protected-dev-password")
	t.Setenv("BASE_URL", "https://localhost:8100")
	fixtures, err := reservedTestUserFixturesForDevelopment()
	if err != nil {
		t.Fatal(err)
	}
	configured := fixtures[len(fixtures)-1]
	if configured.username != "admin_7" || configured.email != "configured_administrator@dev.invalid" {
		t.Fatal("configured development identity or constant email changed")
	}
}
