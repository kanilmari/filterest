// migrations.go
// Applies database migrations at server startup. Reads migration files from the migrations
// directory and executes any that have not yet been applied to the database.
// Exists as the explicitly gated fallback path for schema changes that cannot use APIs.
package migrations

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// RunMigrations applies one directory through the shared multi-directory runner.
// It preserves the original public API for callers that own one migration source.
// Use it only behind the explicit SQL-migration operator gate.
func RunMigrations(db *sql.DB, dir string) error {
	return RunMigrationsFromDirectories(db, []string{dir})
}

type migrationFile struct {
	filename string
	path     string
}

// RunMigrationsFromDirectories merges migration files from independent source owners.
// It orders public and private inputs by their globally unique filenames before execution.
// This lets an outer composition extend Filterest without making Filterest depend on it.
func RunMigrationsFromDirectories(db *sql.DB, directories []string) error {
	files, err := collectMigrationFiles(directories)
	if err != nil {
		return err
	}

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS system_schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
    )`); err != nil {
		return err
	}

	allowedFiles := configuredMigrationFileAllowlist()

	for _, migration := range files {
		base := migration.filename
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
		sqlBytes, err := os.ReadFile(migration.path)
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

// collectMigrationFiles validates each configured source and rejects filename collisions.
// It bridges filesystem-owned migration directories with the database's filename ledger.
// Failing closed prevents one source from silently shadowing another source's migration.
func collectMigrationFiles(directories []string) ([]migrationFile, error) {
	if len(directories) == 0 {
		return nil, fmt.Errorf("at least one migration directory is required")
	}

	filesByName := make(map[string]migrationFile)
	seenDirectories := make(map[string]struct{})

	for _, directory := range directories {
		cleanDirectory := filepath.Clean(directory)
		if _, seen := seenDirectories[cleanDirectory]; seen {
			continue
		}
		seenDirectories[cleanDirectory] = struct{}{}

		info, err := os.Stat(cleanDirectory)
		if err != nil {
			return nil, fmt.Errorf("migration directory %s: %w", cleanDirectory, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("migration directory %s is not a directory", cleanDirectory)
		}

		paths, err := filepath.Glob(filepath.Join(cleanDirectory, "*.sql"))
		if err != nil {
			return nil, fmt.Errorf("scan migration directory %s: %w", cleanDirectory, err)
		}
		for _, migrationPath := range paths {
			filename := filepath.Base(migrationPath)
			if existing, found := filesByName[filename]; found {
				return nil, fmt.Errorf(
					"migration filename collision %s between %s and %s",
					filename,
					existing.path,
					migrationPath,
				)
			}
			filesByName[filename] = migrationFile{filename: filename, path: migrationPath}
		}
	}

	files := make([]migrationFile, 0, len(filesByName))
	for _, migration := range filesByName {
		files = append(files, migration)
	}
	sort.Slice(files, func(left, right int) bool {
		return files[left].filename < files[right].filename
	})
	return files, nil
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
