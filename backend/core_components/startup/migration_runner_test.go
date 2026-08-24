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

func TestMainRunsEnabledMigrationsBeforeReservedUserReconciliation(t *testing.T) {
	mainPath := filepath.Join("..", "..", "..", "main.go")
	mainSource, err := os.ReadFile(mainPath)
	if err != nil {
		t.Fatalf("read main startup source: %v", err)
	}

	source := string(mainSource)
	migrationIndex := strings.Index(source, "startup.RunEnabledMigrations")
	reconcileIndex := strings.Index(source, "startup.ReconcileReservedTestUsers")
	if migrationIndex < 0 || reconcileIndex < 0 || migrationIndex > reconcileIndex {
		t.Fatalf("startup order must run enabled migrations before reserved-user reconciliation")
	}
}

func TestMainFailsClosedOnConfidentialRolePermissionsBeforeTraffic(t *testing.T) {
	mainPath := filepath.Join("..", "..", "..", "main.go")
	mainSource, err := os.ReadFile(mainPath)
	if err != nil {
		t.Fatalf("read main startup source: %v", err)
	}

	source := string(mainSource)
	migrationIndex := strings.Index(source, "startup.RunEnabledMigrations")
	confidentialIndex := strings.Index(source, "backend.EnsureConfidentialRolePermissions")
	reconcileIndex := strings.Index(source, "startup.ReconcileReservedTestUsers")
	trafficIndex := strings.Index(source, "StartApps(port, envType)")
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
