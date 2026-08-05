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
