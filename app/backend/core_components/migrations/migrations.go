// migrations.go
// Applies pending database migrations at server startup in global filename order.
// Connects public/private SQL sources to transactional execution and ledger evidence.
// Keeps exact attempted bytes and outcomes distinct from unverified historical rows.
package migrations

import (
	"crypto/sha256"
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

	evidenceAvailable, err := migrationEvidenceAvailable(db)
	if err != nil {
		return err
	}
	if evidenceAvailable {
		if err := refuseUnresolvedSelfManagedMigrations(db); err != nil {
			return err
		}
	}
	allowedFiles := configuredMigrationFileAllowlist()
	// Only evidence observed by this invocation can cross the old-ledger boundary.
	// A restart deliberately cannot reconstruct it from today's source files.
	var pendingEvidence []migrationEvidence

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
		skipOnError := strings.HasPrefix(content, "-- skip-on-error")
		evidence := migrationEvidence{filename: base, hash: fmt.Sprintf("%x", sha256.Sum256(sqlBytes)), outcome: outcomeApplied}

		// A leading explicit transaction runs outside the runner's transaction.
		selfManaged := startsWithSelfManagedBegin(content)

		if selfManaged {
			if err := runSelfManagedMigration(db, content, skipOnError, evidenceAvailable, &evidence); err != nil {
				return err
			}
			if !evidenceAvailable {
				pendingEvidence = append(pendingEvidence, evidence)
			}
			log.Printf("Migration %s: %s", base, evidence.outcome)
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
				evidence.outcome = outcomeOptionalFailureSkipped
				if err := insertMigrationEvidence(db, evidence, evidenceAvailable); err != nil {
					return err
				}
				if !evidenceAvailable {
					pendingEvidence = append(pendingEvidence, evidence)
				}
				log.Printf("[MIGRATIONS] WARNING: optional migration %s failed (skipping)", base)
				continue
			}
			return fmt.Errorf("migration %s failed: %w", base, err)
		}
		// The extension is detected inside its own transaction; its execution,
		// ledger row and this run's earlier evidence become durable together.
		txEvidenceAvailable := evidenceAvailable
		if !txEvidenceAvailable {
			txEvidenceAvailable, err = migrationEvidenceAvailable(tx)
			if err != nil {
				tx.Rollback()
				return err
			}
		}
		if err := insertMigrationEvidence(tx, evidence, txEvidenceAvailable); err != nil {
			tx.Rollback()
			return err
		}
		if txEvidenceAvailable {
			for _, earlier := range pendingEvidence {
				if err := persistDeferredMigrationEvidence(tx, earlier); err != nil {
					tx.Rollback()
					return err
				}
			}
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("migration %s commit failed: %w", base, err)
		}
		evidenceAvailable = txEvidenceAvailable
		if evidenceAvailable {
			pendingEvidence = nil
		} else {
			pendingEvidence = append(pendingEvidence, evidence)
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

// startsWithSelfManagedBegin detects leading PostgreSQL transaction control.
// Headers, SQL keyword case and START TRANSACTION must not hide self-managed SQL
// inside a runner transaction, where its COMMIT could separate effects and evidence.
func startsWithSelfManagedBegin(content string) bool {
	content = trimMigrationSQLHeader(content)
	word, rest := migrationSQLKeyword(content)
	if word == "BEGIN" {
		return true
	}
	next, _ := migrationSQLKeyword(trimMigrationSQLHeader(rest))
	return word == "START" && next == "TRANSACTION"
}

func migrationSQLKeyword(content string) (string, string) {
	end := 0
	for end < len(content) && (content[end] >= 'a' && content[end] <= 'z' || content[end] >= 'A' && content[end] <= 'Z' || content[end] == '_') {
		end++
	}
	return strings.ToUpper(content[:end]), content[end:]
}

func trimMigrationSQLHeader(content string) string {
	for {
		content = strings.TrimSpace(content)
		if strings.HasPrefix(content, "--") {
			end := strings.IndexByte(content, '\n')
			if end < 0 {
				return ""
			}
			content = content[end+1:]
		} else if strings.HasPrefix(content, "/*") {
			depth, end := 1, 2
			for depth > 0 && end < len(content) {
				if strings.HasPrefix(content[end:], "/*") {
					depth++
					end += 2
				} else if strings.HasPrefix(content[end:], "*/") {
					depth--
					end += 2
				} else {
					end++
				}
			}
			if depth != 0 {
				return ""
			}
			content = content[end:]
		} else {
			return content
		}
	}
}
