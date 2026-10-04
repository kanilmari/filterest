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

func TestApplicationRuntimeFailsClosedOnRuntimeRoleWriteRevocationsBeforeTraffic(t *testing.T) {
	source := readApplicationRuntimeSource(t)
	migrationIndex := strings.Index(source, "startup.RunEnabledMigrations")
	rowGroupIndex := strings.Index(source, "backend.EnsureRowGroupRuntimeRolePermissions")
	revocationIndex := strings.Index(source, "backend.EnsureGuestAndPrivilegeViewWriteRevocations")
	reconcileIndex := strings.Index(source, "startup.ReconcileReservedTestUsers")
	trafficIndex := strings.Index(source, "startRegisteredApps(port, environmentType)")
	if migrationIndex < 0 || rowGroupIndex < 0 || revocationIndex < 0 || reconcileIndex < 0 || trafficIndex < 0 {
		t.Fatalf("startup source is missing the runtime role write revocation stage")
	}
	// The revocations must follow the migrations, because older migrations grant
	// the development role names, and must finish before any request arrives.
	if !(migrationIndex < rowGroupIndex && rowGroupIndex < revocationIndex && revocationIndex < reconcileIndex && reconcileIndex < trafficIndex) {
		t.Fatalf("runtime role write revocations must run after migrations and before authentication consumers or traffic")
	}

	revocationBlock := source[revocationIndex:reconcileIndex]
	if !strings.Contains(revocationBlock, `log.Fatalf("[RUNTIME ROLE WRITE REVOCATIONS] startup reconcile failed: %v", err)`) {
		t.Fatalf("runtime role write revocation failure must terminate startup before traffic")
	}
}

func TestApplicationRuntimeFailsClosedOnAccountTableWriteRevocationsBeforeTraffic(t *testing.T) {
	source := readApplicationRuntimeSource(t)
	validationIndex := strings.Index(source, "backend.ValidateConfig()")
	confidentialIndex := strings.Index(source, "backend.EnsureConfidentialRolePermissions")
	stageOneIndex := strings.Index(source, "backend.EnsureGuestAndPrivilegeViewWriteRevocations")
	accountIndex := strings.Index(source, "backend.EnsureAccountTableWriteRevocations")
	reconcileIndex := strings.Index(source, "startup.ReconcileReservedTestUsers")
	trafficIndex := strings.Index(source, "startRegisteredApps(port, environmentType)")
	if validationIndex < 0 || confidentialIndex < 0 || stageOneIndex < 0 || accountIndex < 0 || reconcileIndex < 0 || trafficIndex < 0 {
		t.Fatalf("startup source is missing the account table write revocation stage")
	}
	// The shared-role refusal in ValidateConfig comes before the confidential grants; the
	// account-table step follows stage 1, which has removed every PUBLIC write it relies on,
	// and finishes before any request arrives.
	if !(validationIndex < confidentialIndex && stageOneIndex < accountIndex && accountIndex < reconcileIndex && reconcileIndex < trafficIndex) {
		t.Fatalf("account table write revocations must run after stage 1 and before authentication consumers or traffic")
	}

	accountBlock := source[accountIndex:reconcileIndex]
	if !strings.Contains(accountBlock, `log.Fatalf("[ACCOUNT TABLE WRITE REVOCATIONS] startup reconcile failed: %v", err)`) {
		t.Fatalf("account table write revocation failure must terminate startup before traffic")
	}
}
