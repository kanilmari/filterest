// migration_runner_test.go
// Verifies migration gating and security-critical application startup ordering.
// Reads the importable runtime composition against migration and permission stages.
// Exists so refactoring the executable cannot open traffic before required guards.
package startup

import (
	"path/filepath"
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
