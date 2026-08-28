// migration_runner.go
// Runs explicitly enabled SQL migrations before startup code depends on the current schema.
// Keeps the gated migration path separate from best-effort background maintenance.
package startup

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"easelect/backend/core_components/migrations"
)

// RunEnabledMigrations applies pending migrations only when the operator has
// explicitly enabled the migration gate. Configured directories are resolved
// below the product root and merged in global filename order. An enabled
// migration failure is fatal because later initialization may depend on it.
func RunEnabledMigrations(db *sql.DB, projectRootHint string, configuredDirectories ...string) error {
	enableMigrations := strings.ToLower(strings.TrimSpace(os.Getenv("ENABLE_SQL_MIGRATIONS")))
	if enableMigrations != "true" && enableMigrations != "1" {
		log.Println("[MIGRATIONS] SQL migrations disabled (ENABLE_SQL_MIGRATIONS not set or false). Use API routes to manage schema.")
		return nil
	}
	projectRoot := strings.TrimSpace(projectRootHint)
	if projectRoot == "" {
		return fmt.Errorf("migration product root is required")
	}
	absoluteProjectRoot, err := filepath.Abs(projectRoot)
	if err != nil {
		return fmt.Errorf("resolve migration product root: %w", err)
	}

	log.Println("[MIGRATIONS] ENABLE_SQL_MIGRATIONS=true — running SQL migrations before schema-dependent startup tasks...")
	migrationDirectories := resolveMigrationDirectories(
		absoluteProjectRoot,
		configuredDirectories,
	)
	return migrations.RunMigrationsFromDirectories(db, migrationDirectories)
}

// resolveMigrationDirectories converts executable-owned relative sources into absolute paths.
// It keeps standalone Filterest on its default source while allowing private composition roots.
// The migration package then validates existence, uniqueness, and global order.
func resolveMigrationDirectories(projectRoot string, configuredDirectories []string) []string {
	if len(configuredDirectories) == 0 {
		return []string{filepath.Join(projectRoot, "server_tools", "migrations")}
	}

	resolved := make([]string, 0, len(configuredDirectories))
	for _, directory := range configuredDirectories {
		if filepath.IsAbs(directory) {
			resolved = append(resolved, filepath.Clean(directory))
			continue
		}
		resolved = append(resolved, filepath.Join(projectRoot, directory))
	}
	return resolved
}
