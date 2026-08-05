// version_check.go
// Startup check that compares the running application version against the stored database
// version. Logs a warning or halts startup if there is a version mismatch.
// Exists to prevent incompatible app and database versions from running silently.
package startup

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// CheckDatabaseVersion compares the required DB version (from VERSION_DB file)
// against the actual version in the database (system_db_version table).
// Returns nil if compatible, error with descriptive message if not.
func CheckDatabaseVersion(db *sql.DB, projectRoot string) error {
	// 1. Read required DB version from file
	requiredVersion, err := readVersionFile(filepath.Join(projectRoot, "VERSION_DB"))
	if err != nil {
		return fmt.Errorf("cannot read VERSION_DB file: %w", err)
	}

	// 2. Read actual DB version from database
	actualVersion, err := readDatabaseVersion(db)
	if err != nil {
		return fmt.Errorf("cannot read database version: %w", err)
	}

	// 3. Compare versions
	if !isCompatible(requiredVersion, actualVersion) {
		return fmt.Errorf(
			"DB version mismatch: app requires DB ≥ %s, but database is at %s. "+
				"Run migrations or restore a compatible dump",
			requiredVersion, actualVersion,
		)
	}

	log.Printf("✓ DB version check passed (required ≥ %s, found %s)", requiredVersion, actualVersion)
	return nil
}

// readVersionFile reads and trims a version string from a file.
func readVersionFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	version := strings.TrimSpace(string(data))
	if version == "" {
		return "", fmt.Errorf("version file is empty: %s", path)
	}
	return version, nil
}

// readDatabaseVersion gets the latest version from system_db_version table.
func readDatabaseVersion(db *sql.DB) (string, error) {
	// Check if table exists
	var tableExists bool
	err := db.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables 
			WHERE table_schema = 'public' AND table_name = 'system_db_version'
		)
	`).Scan(&tableExists)
	if err != nil {
		return "", err
	}
	if !tableExists {
		return "0.0.0", nil // No version table = unversioned database
	}

	var version string
	err = db.QueryRow(`
		SELECT version FROM system_db_version 
		ORDER BY applied_at DESC, id DESC 
		LIMIT 1
	`).Scan(&version)
	if err == sql.ErrNoRows {
		return "0.0.0", nil
	}
	if err != nil {
		return "", err
	}
	return version, nil
}

// isCompatible checks all three numeric components so every tracked database
// migration version participates in the startup safety gate.
func isCompatible(required, actual string) bool {
	reqParts := parseVersion(required)
	actParts := parseVersion(actual)

	for index := range reqParts {
		if actParts[index] < reqParts[index] {
			return false
		}
		if actParts[index] > reqParts[index] {
			return true
		}
	}
	return true
}

// parseVersion splits "4.2.1" into [4, 2, 1]. Returns [0,0,0] on error.
func parseVersion(v string) [3]int {
	var result [3]int
	parts := strings.Split(v, ".")
	for i := 0; i < 3 && i < len(parts); i++ {
		n, err := strconv.Atoi(parts[i])
		if err == nil {
			result[i] = n
		}
	}
	return result
}

// readApplicationVersionFile reads the private Easelect or public Filterest app version.
// Between source checkouts and startup logging, it accepts the private
// VERSION_EASELECT marker first and falls back to the public VERSION_APP marker.
// Exists so generated Filterest can start without carrying the private marker file.
func readApplicationVersionFile(projectRoot string) (string, string, error) {
	candidates := []string{"VERSION_EASELECT", "VERSION_APP"}
	var errors []string
	for _, fileName := range candidates {
		version, err := readVersionFile(filepath.Join(projectRoot, fileName))
		if err == nil {
			return version, fileName, nil
		}
		errors = append(errors, fmt.Sprintf("%s: %v", fileName, err))
	}
	return "", "", fmt.Errorf("cannot read application version file (%s)", strings.Join(errors, "; "))
}

// LogApplicationVersion reads and logs the app version from the active product marker.
func LogApplicationVersion(projectRoot string) {
	version, fileName, err := readApplicationVersionFile(projectRoot)
	if err != nil {
		log.Printf("⚠ Cannot read application version file: %v", err)
		return
	}
	productName := "Easelect"
	if fileName == "VERSION_APP" {
		productName = "Filterest"
	}
	log.Printf("%s v%s", productName, version)
}
