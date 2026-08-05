// migrations.go
// Applies database migrations at server startup. Reads migration files from the migrations
// directory and executes any that have not yet been applied to the database.
// Exists as the explicitly gated fallback path for schema changes that cannot use APIs.
package migrations

import (
	"database/sql"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// RunMigrations applies all SQL files in dir in alphabetical order.
// A table named system_schema_migrations keeps track of applied files.

// Be very careful with this feature! Only use this if the user has told you to use this. Never use this on your own.
func RunMigrations(db *sql.DB, dir string) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS system_schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
    )`); err != nil {
		return err
	}

	files, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil {
		return err
	}
	sort.Strings(files)
	allowedFiles := configuredMigrationFileAllowlist()

	for _, f := range files {
		base := filepath.Base(f)
		if len(allowedFiles) > 0 {
			if _, allowed := allowedFiles[base]; !allowed {
				continue
			}
		}
		var exists bool
		if err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM system_schema_migrations WHERE filename = $1)`, base).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sqlBytes, err := ioutil.ReadFile(f)
		if err != nil {
			return err
		}
		content := string(sqlBytes)
		skipOnError := len(content) >= 16 && content[:16] == "-- skip-on-error"

		// Detect self-managing migrations (contain their own BEGIN/COMMIT).
		// Skip leading blank lines / SQL comments so BEGIN after a migration
		// header is still recognized correctly.
		selfManaged := startsWithSelfManagedBegin(content)

		if selfManaged {
			// Run SQL directly — the migration manages its own transaction
			if _, err := db.Exec(content); err != nil {
				if skipOnError {
					log.Printf("[MIGRATIONS] WARNING: optional migration %s failed (skipping): %v", base, err)
				} else {
					return fmt.Errorf("migration %s failed: %w", base, err)
				}
			}
			// Record as applied regardless of skip-on-error outcome
			if _, err := db.Exec(`INSERT INTO system_schema_migrations (filename) VALUES ($1)`, base); err != nil {
				return fmt.Errorf("migration %s tracking insert failed: %w", base, err)
			}
			log.Printf("Applied migration %s", base)
			continue
		}

		// Wrap migration SQL and tracking insert in a single transaction for atomicity
		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("failed to begin transaction for migration %s: %w", base, err)
		}
		if _, err := tx.Exec(content); err != nil {
			tx.Rollback()
			if skipOnError {
				log.Printf("[MIGRATIONS] WARNING: optional migration %s failed (skipping): %v", base, err)
				if _, err2 := db.Exec(`INSERT INTO system_schema_migrations (filename) VALUES ($1)`, base); err2 != nil {
					log.Printf("[MIGRATIONS] WARNING: could not record skipped migration %s: %v", base, err2)
				}
				continue
			}
			return fmt.Errorf("migration %s failed: %w", base, err)
		}
		if _, err := tx.Exec(`INSERT INTO system_schema_migrations (filename) VALUES ($1)`, base); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %s tracking insert failed: %w", base, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("migration %s commit failed: %w", base, err)
		}
		log.Printf("Applied migration %s", base)
	}
	return nil
}

// configuredMigrationFileAllowlist returns an optional exact filename filter.
// An empty filter preserves the historical behavior of running every pending
// migration. Generated Filterest launchers use the filter for narrowly scoped
// compatibility repairs without exposing the private migration chain.
func configuredMigrationFileAllowlist() map[string]struct{} {
	configured := make(map[string]struct{})
	for _, filename := range strings.Split(os.Getenv("EASELECT_MIGRATION_FILE_ALLOWLIST"), ",") {
		filename = strings.TrimSpace(filename)
		if filename != "" {
			configured[filename] = struct{}{}
		}
	}
	return configured
}

// startsWithSelfManagedBegin detects migrations that manage their own transaction.
func startsWithSelfManagedBegin(content string) bool {
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "--") {
			continue
		}
		return strings.HasPrefix(trimmed, "BEGIN")
	}
	return false
}
