// database_pool_config_test.go
// Verifies the validated env-driven SQL pool sizing defaults and overrides.
// Bridges test-set environment variables and the DB pool config loader without opening PostgreSQL.
// Exists to keep DB pool tuning changes safe even when local database startup is unavailable.
package backend

import (
	"os"
	"testing"
	"time"
)

func TestLoadDatabasePoolSettingsUsesRoleDefaults(t *testing.T) {
	settings := loadDatabasePoolSettings(dbPoolRoleBasic)

	if settings.MaxOpenConns != 12 {
		t.Fatalf("MaxOpenConns = %d, want 12", settings.MaxOpenConns)
	}
	if settings.MaxIdleConns != 4 {
		t.Fatalf("MaxIdleConns = %d, want 4", settings.MaxIdleConns)
	}
	if settings.ConnMaxLifetime != 30*time.Minute {
		t.Fatalf("ConnMaxLifetime = %s, want 30m", settings.ConnMaxLifetime)
	}
	if settings.ConnMaxIdleTime != 10*time.Minute {
		t.Fatalf("ConnMaxIdleTime = %s, want 10m", settings.ConnMaxIdleTime)
	}
}

func TestLoadDatabasePoolSettingsUsesGlobalOverride(t *testing.T) {
	t.Setenv("DB_POOL_MAX_OPEN_CONNS", "9")
	t.Setenv("DB_POOL_MAX_IDLE_CONNS", "3")
	t.Setenv("DB_POOL_CONN_MAX_LIFETIME", "45m")
	t.Setenv("DB_POOL_CONN_MAX_IDLE_TIME", "15m")

	settings := loadDatabasePoolSettings(dbPoolRoleReadOnly)

	if settings.MaxOpenConns != 9 {
		t.Fatalf("MaxOpenConns = %d, want 9", settings.MaxOpenConns)
	}
	if settings.MaxIdleConns != 3 {
		t.Fatalf("MaxIdleConns = %d, want 3", settings.MaxIdleConns)
	}
	if settings.ConnMaxLifetime != 45*time.Minute {
		t.Fatalf("ConnMaxLifetime = %s, want 45m", settings.ConnMaxLifetime)
	}
	if settings.ConnMaxIdleTime != 15*time.Minute {
		t.Fatalf("ConnMaxIdleTime = %s, want 15m", settings.ConnMaxIdleTime)
	}
}

func TestLoadDatabasePoolSettingsPrefersRoleSpecificOverride(t *testing.T) {
	t.Setenv("DB_POOL_MAX_OPEN_CONNS", "9")
	t.Setenv("DB_POOL_BASIC_MAX_OPEN_CONNS", "14")
	t.Setenv("DB_POOL_BASIC_MAX_IDLE_CONNS", "5")
	t.Setenv("DB_POOL_BASIC_CONN_MAX_LIFETIME", "1h")
	t.Setenv("DB_POOL_BASIC_CONN_MAX_IDLE_TIME", "20m")

	settings := loadDatabasePoolSettings(dbPoolRoleBasic)

	if settings.MaxOpenConns != 14 {
		t.Fatalf("MaxOpenConns = %d, want 14", settings.MaxOpenConns)
	}
	if settings.MaxIdleConns != 5 {
		t.Fatalf("MaxIdleConns = %d, want 5", settings.MaxIdleConns)
	}
	if settings.ConnMaxLifetime != time.Hour {
		t.Fatalf("ConnMaxLifetime = %s, want 1h", settings.ConnMaxLifetime)
	}
	if settings.ConnMaxIdleTime != 20*time.Minute {
		t.Fatalf("ConnMaxIdleTime = %s, want 20m", settings.ConnMaxIdleTime)
	}
}

func TestLoadDatabasePoolSettingsRejectsInvalidValues(t *testing.T) {
	t.Setenv("DB_POOL_CONFIDENTIAL_MAX_OPEN_CONNS", "0")
	t.Setenv("DB_POOL_CONFIDENTIAL_MAX_IDLE_CONNS", "-1")
	t.Setenv("DB_POOL_CONFIDENTIAL_CONN_MAX_LIFETIME", "invalid")
	t.Setenv("DB_POOL_CONFIDENTIAL_CONN_MAX_IDLE_TIME", "-5m")

	settings := loadDatabasePoolSettings(dbPoolRoleConfidential)

	if settings.MaxOpenConns != 2 {
		t.Fatalf("MaxOpenConns = %d, want default 2", settings.MaxOpenConns)
	}
	if settings.MaxIdleConns != 1 {
		t.Fatalf("MaxIdleConns = %d, want default 1", settings.MaxIdleConns)
	}
	if settings.ConnMaxLifetime != 30*time.Minute {
		t.Fatalf("ConnMaxLifetime = %s, want default 30m", settings.ConnMaxLifetime)
	}
	if settings.ConnMaxIdleTime != 10*time.Minute {
		t.Fatalf("ConnMaxIdleTime = %s, want default 10m", settings.ConnMaxIdleTime)
	}
}

func TestLoadDatabasePoolSettingsClampsIdleToOpen(t *testing.T) {
	t.Setenv("DB_POOL_GUEST_MAX_OPEN_CONNS", "5")
	t.Setenv("DB_POOL_GUEST_MAX_IDLE_CONNS", "9")

	settings := loadDatabasePoolSettings(dbPoolRoleGuest)

	if settings.MaxIdleConns != 5 {
		t.Fatalf("MaxIdleConns = %d, want 5 after clamp", settings.MaxIdleConns)
	}
}

func TestAssessDatabasePoolHeadroomKeepsComfortableReserve(t *testing.T) {
	assessment := assessDatabasePoolHeadroom(100, 36)

	if assessment.RemainingHeadroom != 64 {
		t.Fatalf("RemainingHeadroom = %d, want 64", assessment.RemainingHeadroom)
	}
	if assessment.RecommendedReserve != 20 {
		t.Fatalf("RecommendedReserve = %d, want 20", assessment.RecommendedReserve)
	}
	if assessment.IsTight {
		t.Fatalf("IsTight = true, want false")
	}
	if assessment.IsAtOrAboveCapacity {
		t.Fatalf("IsAtOrAboveCapacity = true, want false")
	}
}

func TestAssessDatabasePoolHeadroomWarnsWhenReserveGetsTight(t *testing.T) {
	assessment := assessDatabasePoolHeadroom(40, 35)

	if assessment.RemainingHeadroom != 5 {
		t.Fatalf("RemainingHeadroom = %d, want 5", assessment.RemainingHeadroom)
	}
	if assessment.RecommendedReserve != 10 {
		t.Fatalf("RecommendedReserve = %d, want 10", assessment.RecommendedReserve)
	}
	if !assessment.IsTight {
		t.Fatalf("IsTight = false, want true")
	}
	if assessment.IsAtOrAboveCapacity {
		t.Fatalf("IsAtOrAboveCapacity = true, want false")
	}
}

func TestAssessDatabasePoolHeadroomFlagsCapacityExhaustion(t *testing.T) {
	assessment := assessDatabasePoolHeadroom(30, 30)

	if assessment.RemainingHeadroom != 0 {
		t.Fatalf("RemainingHeadroom = %d, want 0", assessment.RemainingHeadroom)
	}
	if !assessment.IsAtOrAboveCapacity {
		t.Fatalf("IsAtOrAboveCapacity = false, want true")
	}
}

func TestCalculateDatabasePoolAutosizedTotalMaxOpenUsesMemoryBound(t *testing.T) {
	twentyFourGiB := int64(24 * 1024 * 1024 * 1024)
	totalMaxOpen := calculateDatabasePoolAutosizedTotalMaxOpen(100, twentyFourGiB)

	if totalMaxOpen != 32 {
		t.Fatalf("totalMaxOpen = %d, want 32", totalMaxOpen)
	}
}

func TestCalculateDatabasePoolAutosizedTotalMaxOpenUsesPostgresBound(t *testing.T) {
	sixtyFourGiB := int64(64 * 1024 * 1024 * 1024)
	totalMaxOpen := calculateDatabasePoolAutosizedTotalMaxOpen(40, sixtyFourGiB)

	if totalMaxOpen != 30 {
		t.Fatalf("totalMaxOpen = %d, want 30", totalMaxOpen)
	}
}

func TestScaleDatabasePoolDefaultsToTotalMaxOpenPreservesRoleBias(t *testing.T) {
	scaledDefaults := scaleDatabasePoolDefaultsToTotalMaxOpen(42)

	if scaledDefaults[dbPoolRoleAdmin].MaxOpenConns != 7 {
		t.Fatalf("admin MaxOpenConns = %d, want 7", scaledDefaults[dbPoolRoleAdmin].MaxOpenConns)
	}
	if scaledDefaults[dbPoolRoleReadOnly].MaxOpenConns != 5 {
		t.Fatalf("readonly MaxOpenConns = %d, want 5", scaledDefaults[dbPoolRoleReadOnly].MaxOpenConns)
	}
	if scaledDefaults[dbPoolRoleConfidential].MaxOpenConns != 2 {
		t.Fatalf("confidential MaxOpenConns = %d, want 2", scaledDefaults[dbPoolRoleConfidential].MaxOpenConns)
	}
	if scaledDefaults[dbPoolRoleBasic].MaxOpenConns != 14 {
		t.Fatalf("basic MaxOpenConns = %d, want 14", scaledDefaults[dbPoolRoleBasic].MaxOpenConns)
	}
	if scaledDefaults[dbPoolRoleGuest].MaxOpenConns != 14 {
		t.Fatalf("guest MaxOpenConns = %d, want 14", scaledDefaults[dbPoolRoleGuest].MaxOpenConns)
	}
}

func TestIsDatabasePoolAutosizeEnabledHonorsFalseOverride(t *testing.T) {
	t.Setenv(databasePoolAutosizeEnabledEnvKey, "false")

	if isDatabasePoolAutosizeEnabled() {
		t.Fatalf("isDatabasePoolAutosizeEnabled() = true, want false")
	}
}

func TestReadMemInfoTotalBytesParsesMemTotalLine(t *testing.T) {
	tempFile, err := os.CreateTemp(t.TempDir(), "meminfo-*.txt")
	if err != nil {
		t.Fatalf("CreateTemp: %v", err)
	}

	meminfo := "MemTotal:       32768000 kB\nMemFree:         1024 kB\n"
	if _, err := tempFile.WriteString(meminfo); err != nil {
		t.Fatalf("WriteString: %v", err)
	}
	if err := tempFile.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	memTotalBytes, err := readMemInfoTotalBytes(tempFile.Name())
	if err != nil {
		t.Fatalf("readMemInfoTotalBytes: %v", err)
	}

	if memTotalBytes != 32768000*1024 {
		t.Fatalf("memTotalBytes = %d, want %d", memTotalBytes, 32768000*1024)
	}
}

func TestCurrentDatabasePoolRuntimeStatusHandlesMissingDatabaseHandles(t *testing.T) {
	originalDbAdmin := DbAdmin
	originalDbReaderOnly := DbReaderOnly
	originalDbConfidential := DbConfidential
	originalDbBasic := DbBasic
	originalDbGuest := DbGuest
	t.Cleanup(func() {
		DbAdmin = originalDbAdmin
		DbReaderOnly = originalDbReaderOnly
		DbConfidential = originalDbConfidential
		DbBasic = originalDbBasic
		DbGuest = originalDbGuest
	})

	DbAdmin = nil
	DbReaderOnly = nil
	DbConfidential = nil
	DbBasic = nil
	DbGuest = nil

	poolStatuses, headroomStatus := CurrentDatabasePoolRuntimeStatus()

	if len(poolStatuses) != 0 {
		t.Fatalf("len(poolStatuses) = %d, want 0", len(poolStatuses))
	}
	if headroomStatus.Available {
		t.Fatal("headroomStatus.Available = true, want false")
	}
	if headroomStatus.Error != "database_handle_unavailable" {
		t.Fatalf("headroomStatus.Error = %q, want database_handle_unavailable", headroomStatus.Error)
	}
}
