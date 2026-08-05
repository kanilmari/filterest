// app_db_compatibility_sync.go
// Mirrors the git-tracked app↔DB compatibility manifest into a DB-backed
// system table when that table exists. Keeps the manifest as the canonical
// source and treats the DB table as a startup-populated mirror.
package startup

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type appDBCompatibilityManifestRow struct {
	AppVersion         string    `json:"app_version"`
	MinDBVersion       string    `json:"min_db_version"`
	TargetDBVersion    string    `json:"target_db_version"`
	SchemaSnapshotPath string    `json:"schema_snapshot_path"`
	GitCommitSHA       string    `json:"git_commit_sha"`
	Status             string    `json:"status"`
	Notes              string    `json:"notes"`
	RecordedAtRaw      string    `json:"recorded_at"`
	RecordedAt         time.Time `json:"-"`
}

// SyncAppDBCompatibilityMirror upserts the git-tracked compatibility manifest
// into the DB-backed mirror table when that table exists. Returns the number
// of mirrored rows written during this startup pass.
func SyncAppDBCompatibilityMirror(db *sql.DB, projectRoot string) (int, error) {
	if db == nil {
		return 0, fmt.Errorf("nil database handle")
	}

	exists, err := tableExists(db, "system_app_db_compatibility")
	if err != nil {
		return 0, fmt.Errorf("check mirror table existence: %w", err)
	}
	if !exists {
		return 0, nil
	}

	rows, err := loadAppDBCompatibilityManifest(filepath.Join(
		projectRoot,
		"server_tools",
		"versioning",
		"app_db_compatibility.jsonl",
	))
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}

	tx, err := db.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin mirror sync transaction: %w", err)
	}

	// The DB table is a cache, so stale rows that no longer exist in the
	// canonical manifest may remain for diagnostics. They must never remain
	// active, however. Normalize every cached row before the manifest upserts
	// restore the one canonical active release in the same transaction.
	if _, err := tx.Exec(`
		UPDATE system_app_db_compatibility
		   SET status = 'historical',
		       updated = now()
		 WHERE status IS DISTINCT FROM 'historical'
	`); err != nil {
		_ = tx.Rollback()
		return 0, fmt.Errorf("normalize mirror row statuses: %w", err)
	}

	for _, row := range rows {
		if _, err := tx.Exec(`
			INSERT INTO system_app_db_compatibility (
				app_version,
				min_db_version,
				target_db_version,
				schema_snapshot_path,
				git_commit_sha,
				status,
				notes,
				recorded_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (app_version) DO UPDATE
			SET min_db_version = EXCLUDED.min_db_version,
			    target_db_version = EXCLUDED.target_db_version,
			    schema_snapshot_path = EXCLUDED.schema_snapshot_path,
			    git_commit_sha = EXCLUDED.git_commit_sha,
			    status = EXCLUDED.status,
			    notes = EXCLUDED.notes,
			    recorded_at = EXCLUDED.recorded_at,
			    updated = now()
		`,
			row.AppVersion,
			row.MinDBVersion,
			row.TargetDBVersion,
			row.SchemaSnapshotPath,
			row.GitCommitSHA,
			row.Status,
			row.Notes,
			row.RecordedAt,
		); err != nil {
			_ = tx.Rollback()
			return 0, fmt.Errorf("upsert mirror row for app %s: %w", row.AppVersion, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit mirror sync transaction: %w", err)
	}
	return len(rows), nil
}

func loadAppDBCompatibilityManifest(path string) ([]appDBCompatibilityManifestRow, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open compatibility manifest: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	rows := make([]appDBCompatibilityManifestRow, 0, 8)
	for lineNo := 1; scanner.Scan(); lineNo++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		var row appDBCompatibilityManifestRow
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			return nil, fmt.Errorf("parse compatibility manifest line %d: %w", lineNo, err)
		}

		recordedAt, err := time.Parse(time.RFC3339, row.RecordedAtRaw)
		if err != nil {
			return nil, fmt.Errorf("parse manifest recorded_at on line %d: %w", lineNo, err)
		}
		row.RecordedAt = recordedAt
		rows = append(rows, row)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan compatibility manifest: %w", err)
	}

	activeCount := 0
	for _, row := range rows {
		switch row.Status {
		case "active":
			activeCount++
		case "historical":
		default:
			return nil, fmt.Errorf(
				"compatibility manifest app %s has unsupported status %q",
				row.AppVersion,
				row.Status,
			)
		}
	}
	if len(rows) > 0 && activeCount != 1 {
		return nil, fmt.Errorf(
			"compatibility manifest must contain exactly one active row, got %d",
			activeCount,
		)
	}

	return rows, nil
}

func tableExists(db *sql.DB, tableName string) (bool, error) {
	var exists bool
	err := db.QueryRow(`
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = $1
		)
	`, tableName).Scan(&exists)
	return exists, err
}
