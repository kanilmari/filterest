// migration_runner_test.go
// Verifies migration gating and security-critical application startup ordering.
// Reads the importable runtime composition against migration and permission stages.
// Exists so refactoring the executable cannot open traffic before required guards.
package startup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunEnabledMigrationsDoesNotRequireDatabaseWhenGateIsDisabled(t *testing.T) {
	t.Setenv("ENABLE_SQL_MIGRATIONS", "false")
	if err := RunEnabledMigrations(nil, t.TempDir()); err != nil {
		t.Fatalf("RunEnabledMigrations() with disabled gate returned %v", err)
	}
}

func TestResolveMigrationDirectoriesUsesStandaloneDefault(t *testing.T) {
	root := t.TempDir()
	got := resolveMigrationDirectories(root, nil)
	want := filepath.Join(root, "server_tools", "migrations")
	if len(got) != 1 || got[0] != want {
		t.Fatalf("resolveMigrationDirectories() = %v, want [%s]", got, want)
	}
}

func TestResolveMigrationDirectoriesKeepsPublicAndPrivateSourcesSeparate(t *testing.T) {
	root := t.TempDir()
	absoluteDirectory := filepath.Join(t.TempDir(), "absolute-migrations")
	got := resolveMigrationDirectories(root, []string{
		"filterest/app/server_tools/migrations",
		absoluteDirectory,
	})
	want := []string{
		filepath.Join(root, "filterest", "app", "server_tools", "migrations"),
		absoluteDirectory,
	}
	if len(got) != len(want) {
		t.Fatalf("resolveMigrationDirectories() = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("resolveMigrationDirectories()[%d] = %q, want %q", index, got[index], want[index])
		}
	}
}

func readApplicationRuntimeSource(t *testing.T) string {
	t.Helper()
	runtimePath := filepath.Join("..", "application_runtime", "application_runner.go")
	runtimeSource, err := os.ReadFile(runtimePath)
	if err != nil {
		t.Fatalf("read application runtime source: %v", err)
	}
	return string(runtimeSource)
}

func TestApplicationRuntimeRunsEnabledMigrationsBeforeReservedUserReconciliation(t *testing.T) {
	source := readApplicationRuntimeSource(t)
	migrationIndex := strings.Index(source, "startup.RunEnabledMigrations")
	reconcileIndex := strings.Index(source, "startup.ReconcileReservedTestUsers")
	if migrationIndex < 0 || reconcileIndex < 0 || migrationIndex > reconcileIndex {
		t.Fatalf("startup order must run enabled migrations before reserved-user reconciliation")
	}
}

func TestApplicationRuntimeFailsClosedOnConfidentialRolePermissionsBeforeTraffic(t *testing.T) {
	source := readApplicationRuntimeSource(t)
	migrationIndex := strings.Index(source, "startup.RunEnabledMigrations")
	confidentialIndex := strings.Index(source, "backend.EnsureConfidentialRolePermissions")
	reconcileIndex := strings.Index(source, "startup.ReconcileReservedTestUsers")
	trafficIndex := strings.Index(source, "startRegisteredApps(port, environmentType)")
	if migrationIndex < 0 || confidentialIndex < 0 || reconcileIndex < 0 || trafficIndex < 0 {
		t.Fatalf("startup source is missing a required authentication-readiness stage")
	}
	if !(migrationIndex < confidentialIndex && confidentialIndex < reconcileIndex && reconcileIndex < trafficIndex) {
		t.Fatalf("confidential-role permissions must reconcile after migrations and before authentication consumers or traffic")
	}

	confidentialBlock := source[confidentialIndex:reconcileIndex]
	if !strings.Contains(confidentialBlock, `log.Fatalf("[CONFIDENTIAL ROLE PERMISSIONS] startup reconcile failed: %v", err)`) {
		t.Fatalf("confidential-role permission failure must terminate startup before traffic")
	}
}

func TestApplicationRuntimeFailsClosedOnRowGroupRuntimePermissionsBeforeTraffic(t *testing.T) {
	source := readApplicationRuntimeSource(t)
	migrationIndex := strings.Index(source, "startup.RunEnabledMigrations")
	confidentialIndex := strings.Index(source, "backend.EnsureConfidentialRolePermissions")
	rowGroupIndex := strings.Index(source, "backend.EnsureRowGroupRuntimeRolePermissions")
	reconcileIndex := strings.Index(source, "startup.ReconcileReservedTestUsers")
	trafficIndex := strings.Index(source, "startRegisteredApps(port, environmentType)")
	if migrationIndex < 0 || confidentialIndex < 0 || rowGroupIndex < 0 || reconcileIndex < 0 || trafficIndex < 0 {
		t.Fatalf("startup source is missing a required row-group readiness stage")
	}
	if !(migrationIndex < confidentialIndex && confidentialIndex < rowGroupIndex && rowGroupIndex < reconcileIndex && reconcileIndex < trafficIndex) {
		t.Fatalf("row-group permissions must reconcile after migrations and before authentication consumers or traffic")
	}

	rowGroupBlock := source[rowGroupIndex:reconcileIndex]
	if !strings.Contains(rowGroupBlock, `log.Fatalf("[ROW GROUP PERMISSIONS] startup reconcile failed: %v", err)`) {
		t.Fatalf("row-group permission failure must terminate startup before traffic")
	}
}
