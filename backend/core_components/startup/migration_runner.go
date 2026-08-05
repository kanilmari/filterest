// migration_runner.go
// Runs explicitly enabled SQL migrations before startup code depends on the current schema.
// Keeps the gated migration path separate from best-effort background maintenance.
package startup

import (
	"database/sql"
	"log"
	"os"
	"path/filepath"
	"strings"

	"easelect/backend/core_components/migrations"
)

// RunEnabledMigrations applies pending migrations only when the operator has
// explicitly enabled the migration gate. An enabled migration failure is fatal
// to startup because later initialization may depend on the new schema.
func RunEnabledMigrations(db *sql.DB, projectRootHint string) error {
	enableMigrations := strings.ToLower(strings.TrimSpace(os.Getenv("ENABLE_SQL_MIGRATIONS")))
	if enableMigrations != "true" && enableMigrations != "1" {
		log.Println("[MIGRATIONS] SQL migrations disabled (ENABLE_SQL_MIGRATIONS not set or false). Use API routes to manage schema.")
		return nil
	}

	log.Println("[MIGRATIONS] ENABLE_SQL_MIGRATIONS=true — running SQL migrations before schema-dependent startup tasks...")
	migrationDirectory := filepath.Join(resolveProjectRoot(projectRootHint), "server_tools", "migrations")
	return migrations.RunMigrations(db, migrationDirectory)
}
