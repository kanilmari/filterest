// database_pool_config.go
// Derives validated SQL connection-pool settings for each Easelect runtime role.
// Bridges deployment environment variables and sql.DB pool setters with one shared config source.
// Exists so production sizing can be tuned safely without editing InitDB for every environment.
package backend

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type databasePoolSettings struct {
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	ConnMaxIdleTime time.Duration
}

type databasePoolHeadroomAssessment struct {
	PostgresMaxConnections int
	ConfiguredTotalMaxOpen int
	RemainingHeadroom      int
	RecommendedReserve     int
	IsTight                bool
	IsAtOrAboveCapacity    bool
}

type DatabasePoolRuntimeStatus struct {
	Role                     string `json:"role"`
	MaxOpenConnections       int    `json:"max_open_connections"`
	OpenConnections          int    `json:"open_connections"`
	InUse                    int    `json:"in_use"`
	Idle                     int    `json:"idle"`
	WaitCount                int64  `json:"wait_count"`
	WaitDurationMilliseconds int64  `json:"wait_duration_milliseconds"`
	MaxIdleClosed            int64  `json:"max_idle_closed"`
	MaxIdleTimeClosed        int64  `json:"max_idle_time_closed"`
	MaxLifetimeClosed        int64  `json:"max_lifetime_closed"`
}

type DatabasePoolHeadroomStatus struct {
	Available              bool   `json:"available"`
	PostgresMaxConnections int    `json:"postgres_max_connections,omitempty"`
	ConfiguredTotalMaxOpen int    `json:"configured_total_max_open"`
	RemainingHeadroom      int    `json:"remaining_headroom,omitempty"`
	RecommendedReserve     int    `json:"recommended_reserve,omitempty"`
	IsTight                bool   `json:"is_tight"`
	IsAtOrAboveCapacity    bool   `json:"is_at_or_above_capacity"`
	Error                  string `json:"error,omitempty"`
}

const (
	dbPoolRoleAdmin        = "ADMIN"
	dbPoolRoleReadOnly     = "READONLY"
	dbPoolRoleConfidential = "CONFIDENTIAL"
	dbPoolRoleBasic        = "BASIC"
	dbPoolRoleGuest        = "GUEST"

	databasePoolMinimumReserveConnections = 10
	databasePoolReserveFractionDivisor    = 5
	databasePoolAutosizeEnabledEnvKey     = "DB_POOL_AUTOSIZE_ENABLED"
	databasePoolAutosizeMinTotalMaxOpen   = 12
	databasePoolAutosizeBytesPerOpenConn  = int64(768 * 1024 * 1024)
)

var defaultDatabasePoolSettingsByRole = map[string]databasePoolSettings{
	dbPoolRoleAdmin: {
		MaxOpenConns:    6,
		MaxIdleConns:    2,
		ConnMaxLifetime: 30 * time.Minute,
		ConnMaxIdleTime: 10 * time.Minute,
	},
	dbPoolRoleReadOnly: {
		MaxOpenConns:    4,
		MaxIdleConns:    2,
		ConnMaxLifetime: 30 * time.Minute,
		ConnMaxIdleTime: 10 * time.Minute,
	},
	dbPoolRoleConfidential: {
		MaxOpenConns:    2,
		MaxIdleConns:    1,
		ConnMaxLifetime: 30 * time.Minute,
		ConnMaxIdleTime: 10 * time.Minute,
	},
	dbPoolRoleBasic: {
		MaxOpenConns:    12,
		MaxIdleConns:    4,
		ConnMaxLifetime: 30 * time.Minute,
		ConnMaxIdleTime: 10 * time.Minute,
	},
	dbPoolRoleGuest: {
		MaxOpenConns:    12,
		MaxIdleConns:    4,
		ConnMaxLifetime: 30 * time.Minute,
		ConnMaxIdleTime: 10 * time.Minute,
	},
}

var databasePoolRoleOrder = []string{
	dbPoolRoleAdmin,
	dbPoolRoleReadOnly,
	dbPoolRoleConfidential,
	dbPoolRoleBasic,
	dbPoolRoleGuest,
}

func loadDatabasePoolSettings(roleKey string) databasePoolSettings {
	return loadDatabasePoolSettingsFromDefaults(roleKey, defaultDatabasePoolSettingsByRole[roleKey])
}

// loadDatabasePoolSettingsFromDefaults resolves one role's validated pool settings from provided defaults.
// It bridges autosized/static role defaults and environment overrides before sql.DB setters are applied.
// Exists so startup can keep one shared override path while swapping the baseline defaults safely.
func loadDatabasePoolSettingsFromDefaults(roleKey string, defaults databasePoolSettings) databasePoolSettings {
	settings := databasePoolSettings{
		MaxOpenConns: parseDatabasePoolIntEnv(
			roleKey,
			"MAX_OPEN_CONNS",
			"DB_POOL_MAX_OPEN_CONNS",
			defaults.MaxOpenConns,
			1,
		),
		MaxIdleConns: parseDatabasePoolIntEnv(
			roleKey,
			"MAX_IDLE_CONNS",
			"DB_POOL_MAX_IDLE_CONNS",
			defaults.MaxIdleConns,
			0,
		),
		ConnMaxLifetime: parseDatabasePoolDurationEnv(
			roleKey,
			"CONN_MAX_LIFETIME",
			"DB_POOL_CONN_MAX_LIFETIME",
			defaults.ConnMaxLifetime,
		),
		ConnMaxIdleTime: parseDatabasePoolDurationEnv(
			roleKey,
			"CONN_MAX_IDLE_TIME",
			"DB_POOL_CONN_MAX_IDLE_TIME",
			defaults.ConnMaxIdleTime,
		),
	}

	if settings.MaxIdleConns > settings.MaxOpenConns {
		log.Printf(
			"\033[33mwarning: DB pool %s max idle (%d) exceeds max open (%d); clamping idle to max open\033[0m",
			strings.ToLower(roleKey),
			settings.MaxIdleConns,
			settings.MaxOpenConns,
		)
		settings.MaxIdleConns = settings.MaxOpenConns
	}

	return settings
}

// resolveDatabasePoolDefaultSettings derives the role-default pool settings for the current startup.
// It bridges one live database handle, PostgreSQL capacity, and effective memory limits into pool defaults.
// Exists so runtime hosts can autosize the baseline budget before env overrides are layered on top.
func resolveDatabasePoolDefaultSettings(db *sql.DB) map[string]databasePoolSettings {
	resolvedDefaults := cloneDatabasePoolSettingsByRole(defaultDatabasePoolSettingsByRole)
	if !isDatabasePoolAutosizeEnabled() {
		return resolvedDefaults
	}

	postgresMaxConnections, err := readPostgresMaxConnections(db)
	if err != nil {
		log.Printf(
			"\033[33mwarning: failed to resolve postgres max_connections for db pool autosize, using static defaults: %v\033[0m",
			err,
		)
		return resolvedDefaults
	}

	effectiveMemoryLimitBytes, err := readEffectiveMemoryLimitBytes()
	if err != nil {
		log.Printf(
			"\033[33mwarning: failed to resolve effective memory limit for db pool autosize, using static defaults: %v\033[0m",
			err,
		)
		return resolvedDefaults
	}

	autosizedTotalMaxOpen := calculateDatabasePoolAutosizedTotalMaxOpen(postgresMaxConnections, effectiveMemoryLimitBytes)
	if autosizedTotalMaxOpen <= 0 {
		return resolvedDefaults
	}

	log.Printf(
		"db pool autosize: postgres_max_connections=%d effective_memory_limit_bytes=%d autosized_total_max_open_conns=%d default_total_max_open_conns=%d",
		postgresMaxConnections,
		effectiveMemoryLimitBytes,
		autosizedTotalMaxOpen,
		getDatabasePoolDefaultTotalMaxOpen(),
	)

	return scaleDatabasePoolDefaultsToTotalMaxOpen(autosizedTotalMaxOpen)
}

func parseDatabasePoolIntEnv(roleKey string, settingSuffix string, globalKey string, defaultValue int, minValue int) int {
	rawValue, sourceKey, found := readDatabasePoolEnvValue(roleKey, settingSuffix, globalKey)
	if !found {
		return defaultValue
	}

	parsedValue, err := strconv.Atoi(rawValue)
	if err != nil || parsedValue < minValue {
		log.Printf(
			"\033[31merror: invalid %s=%q, using default %d\033[0m",
			sourceKey,
			rawValue,
			defaultValue,
		)
		return defaultValue
	}

	return parsedValue
}

func parseDatabasePoolDurationEnv(roleKey string, settingSuffix string, globalKey string, defaultValue time.Duration) time.Duration {
	rawValue, sourceKey, found := readDatabasePoolEnvValue(roleKey, settingSuffix, globalKey)
	if !found {
		return defaultValue
	}

	parsedValue, err := time.ParseDuration(rawValue)
	if err != nil || parsedValue < 0 {
		log.Printf(
			"\033[31merror: invalid %s=%q, using default %s\033[0m",
			sourceKey,
			rawValue,
			defaultValue,
		)
		return defaultValue
	}

	return parsedValue
}

func readDatabasePoolEnvValue(roleKey string, settingSuffix string, globalKey string) (string, string, bool) {
	roleSpecificKey := fmt.Sprintf("DB_POOL_%s_%s", roleKey, settingSuffix)
	if rawValue := strings.TrimSpace(os.Getenv(roleSpecificKey)); rawValue != "" {
		return rawValue, roleSpecificKey, true
	}

	if rawValue := strings.TrimSpace(os.Getenv(globalKey)); rawValue != "" {
		return rawValue, globalKey, true
	}

	return "", "", false
}

func isDatabasePoolAutosizeEnabled() bool {
	rawValue := strings.TrimSpace(os.Getenv(databasePoolAutosizeEnabledEnvKey))
	if rawValue == "" {
		return true
	}

	enabled, err := strconv.ParseBool(rawValue)
	if err != nil {
		log.Printf(
			"\033[31merror: invalid %s=%q, using default true\033[0m",
			databasePoolAutosizeEnabledEnvKey,
			rawValue,
		)
		return true
	}

	return enabled
}

func applyDatabasePoolSettings(db *sql.DB, settings databasePoolSettings) {
	db.SetMaxOpenConns(settings.MaxOpenConns)
	db.SetMaxIdleConns(settings.MaxIdleConns)
	db.SetConnMaxLifetime(settings.ConnMaxLifetime)
	db.SetConnMaxIdleTime(settings.ConnMaxIdleTime)
}

func logDatabasePoolConfiguration(roleLabel string, settings databasePoolSettings, stats sql.DBStats) {
	log.Printf(
		"db pool configured: role=%s max_open=%d max_idle=%d conn_max_lifetime=%s conn_max_idle_time=%s open=%d in_use=%d idle=%d",
		roleLabel,
		settings.MaxOpenConns,
		settings.MaxIdleConns,
		settings.ConnMaxLifetime,
		settings.ConnMaxIdleTime,
		stats.OpenConnections,
		stats.InUse,
		stats.Idle,
	)
}

func logDatabasePoolStats(roleLabel string, lifecycle string, stats sql.DBStats) {
	log.Printf(
		"db pool stats: role=%s lifecycle=%s max_open=%d open=%d in_use=%d idle=%d wait_count=%d wait_duration=%s max_idle_closed=%d max_idle_time_closed=%d max_lifetime_closed=%d",
		roleLabel,
		lifecycle,
		stats.MaxOpenConnections,
		stats.OpenConnections,
		stats.InUse,
		stats.Idle,
		stats.WaitCount,
		stats.WaitDuration,
		stats.MaxIdleClosed,
		stats.MaxIdleTimeClosed,
		stats.MaxLifetimeClosed,
	)
}

// CurrentDatabasePoolRuntimeStatus snapshots the role-specific DB pools for manager status endpoints.
// It bridges package-level sql.DB handles and cloud-readiness evidence without exposing credentials.
// Exists so operators can see live pool pressure and PostgreSQL headroom before accepting a runtime.
func CurrentDatabasePoolRuntimeStatus() ([]DatabasePoolRuntimeStatus, DatabasePoolHeadroomStatus) {
	dbConnectionList := []struct {
		roleLabel string
		db        *sql.DB
	}{
		{roleLabel: "admin", db: DbAdmin},
		{roleLabel: "readonly", db: DbReaderOnly},
		{roleLabel: "confidential", db: DbConfidential},
		{roleLabel: "basic", db: DbBasic},
		{roleLabel: "guest", db: DbGuest},
	}

	poolStatuses := make([]DatabasePoolRuntimeStatus, 0, len(dbConnectionList))
	totalConfiguredMaxOpen := 0
	var capacityDB *sql.DB

	for _, conn := range dbConnectionList {
		if conn.db == nil {
			continue
		}
		if capacityDB == nil {
			capacityDB = conn.db
		}

		stats := conn.db.Stats()
		totalConfiguredMaxOpen += stats.MaxOpenConnections
		poolStatuses = append(poolStatuses, DatabasePoolRuntimeStatus{
			Role:                     conn.roleLabel,
			MaxOpenConnections:       stats.MaxOpenConnections,
			OpenConnections:          stats.OpenConnections,
			InUse:                    stats.InUse,
			Idle:                     stats.Idle,
			WaitCount:                stats.WaitCount,
			WaitDurationMilliseconds: stats.WaitDuration.Milliseconds(),
			MaxIdleClosed:            stats.MaxIdleClosed,
			MaxIdleTimeClosed:        stats.MaxIdleTimeClosed,
			MaxLifetimeClosed:        stats.MaxLifetimeClosed,
		})
	}

	headroomStatus := DatabasePoolHeadroomStatus{
		ConfiguredTotalMaxOpen: totalConfiguredMaxOpen,
	}
	if capacityDB == nil {
		headroomStatus.Error = "database_handle_unavailable"
		return poolStatuses, headroomStatus
	}

	postgresMaxConnections, err := readPostgresMaxConnections(capacityDB)
	if err != nil {
		headroomStatus.Error = "postgres_max_connections_unavailable"
		return poolStatuses, headroomStatus
	}

	assessment := assessDatabasePoolHeadroom(postgresMaxConnections, totalConfiguredMaxOpen)
	headroomStatus.Available = true
	headroomStatus.PostgresMaxConnections = assessment.PostgresMaxConnections
	headroomStatus.RemainingHeadroom = assessment.RemainingHeadroom
	headroomStatus.RecommendedReserve = assessment.RecommendedReserve
	headroomStatus.IsTight = assessment.IsTight
	headroomStatus.IsAtOrAboveCapacity = assessment.IsAtOrAboveCapacity
	return poolStatuses, headroomStatus
}

// assessDatabasePoolHeadroom summarizes how much PostgreSQL connection capacity remains
// between the combined Easelect pool budget and server-side max_connections.
// Exists so startup logging can warn when pool sizing leaves too little operational headroom.
func assessDatabasePoolHeadroom(postgresMaxConnections int, configuredTotalMaxOpen int) databasePoolHeadroomAssessment {
	recommendedReserve := calculateDatabasePoolRecommendedReserve(postgresMaxConnections)

	remainingHeadroom := postgresMaxConnections - configuredTotalMaxOpen

	return databasePoolHeadroomAssessment{
		PostgresMaxConnections: postgresMaxConnections,
		ConfiguredTotalMaxOpen: configuredTotalMaxOpen,
		RemainingHeadroom:      remainingHeadroom,
		RecommendedReserve:     recommendedReserve,
		IsTight:                remainingHeadroom > 0 && remainingHeadroom < recommendedReserve,
		IsAtOrAboveCapacity:    remainingHeadroom <= 0,
	}
}

// calculateDatabasePoolRecommendedReserve returns the connection headroom that should stay outside app pools.
// It bridges PostgreSQL max_connections and Easelect's startup warnings with one shared reserve rule.
// Exists so both autosizing and headroom logging use the same safety margin.
func calculateDatabasePoolRecommendedReserve(postgresMaxConnections int) int {
	recommendedReserve := postgresMaxConnections / databasePoolReserveFractionDivisor
	if recommendedReserve < databasePoolMinimumReserveConnections {
		recommendedReserve = databasePoolMinimumReserveConnections
	}

	return recommendedReserve
}

// calculateDatabasePoolAutosizedTotalMaxOpen derives a combined app-side open-connection budget.
// It bridges PostgreSQL capacity and effective memory limits into one startup pool ceiling.
// Exists so smaller hosts can stay conservative while larger hosts can scale beyond static defaults.
func calculateDatabasePoolAutosizedTotalMaxOpen(postgresMaxConnections int, effectiveMemoryLimitBytes int64) int {
	usablePostgresConnections := postgresMaxConnections - calculateDatabasePoolRecommendedReserve(postgresMaxConnections)
	if usablePostgresConnections < len(databasePoolRoleOrder) {
		usablePostgresConnections = len(databasePoolRoleOrder)
	}

	memoryBoundTotalMaxOpen := int(effectiveMemoryLimitBytes / databasePoolAutosizeBytesPerOpenConn)
	if memoryBoundTotalMaxOpen < databasePoolAutosizeMinTotalMaxOpen {
		memoryBoundTotalMaxOpen = databasePoolAutosizeMinTotalMaxOpen
	}

	if usablePostgresConnections < memoryBoundTotalMaxOpen {
		return usablePostgresConnections
	}

	return memoryBoundTotalMaxOpen
}

// scaleDatabasePoolDefaultsToTotalMaxOpen redistributes the combined budget across runtime roles.
// It bridges one total max_open target and the existing role-weight defaults into per-role settings.
// Exists so autosizing preserves the established admin/readonly/confidential/basic/guest bias.
func scaleDatabasePoolDefaultsToTotalMaxOpen(totalMaxOpen int) map[string]databasePoolSettings {
	defaultTotalMaxOpen := getDatabasePoolDefaultTotalMaxOpen()
	scaledOpenByRole := make(map[string]int, len(databasePoolRoleOrder))
	remainderByRole := make(map[string]int, len(databasePoolRoleOrder))
	assignedTotal := 0

	for _, roleKey := range databasePoolRoleOrder {
		defaultOpen := defaultDatabasePoolSettingsByRole[roleKey].MaxOpenConns
		scaledOpen := (defaultOpen * totalMaxOpen) / defaultTotalMaxOpen
		if scaledOpen < 1 {
			scaledOpen = 1
		}

		scaledOpenByRole[roleKey] = scaledOpen
		remainderByRole[roleKey] = (defaultOpen * totalMaxOpen) % defaultTotalMaxOpen
		assignedTotal += scaledOpen
	}

	for assignedTotal < totalMaxOpen {
		nextRoleKey := databasePoolRoleOrder[0]
		nextRemainder := -1

		for _, roleKey := range databasePoolRoleOrder {
			if remainderByRole[roleKey] > nextRemainder {
				nextRoleKey = roleKey
				nextRemainder = remainderByRole[roleKey]
			}
		}

		scaledOpenByRole[nextRoleKey]++
		remainderByRole[nextRoleKey] = -1
		assignedTotal++
	}

	scaledDefaults := cloneDatabasePoolSettingsByRole(defaultDatabasePoolSettingsByRole)
	for _, roleKey := range databasePoolRoleOrder {
		defaults := scaledDefaults[roleKey]
		defaults.MaxOpenConns = scaledOpenByRole[roleKey]
		defaults.MaxIdleConns = scaleDatabasePoolIdleConns(defaultDatabasePoolSettingsByRole[roleKey], defaults.MaxOpenConns)
		scaledDefaults[roleKey] = defaults
	}

	return scaledDefaults
}

// scaleDatabasePoolIdleConns keeps max_idle roughly proportional to a role's scaled max_open.
// It bridges the original idle/open ratio and the autosized open budget for a single role.
// Exists so autosizing does not leave idle pools wildly out of sync with scaled open limits.
func scaleDatabasePoolIdleConns(defaults databasePoolSettings, scaledMaxOpen int) int {
	scaledIdle := (defaults.MaxIdleConns*scaledMaxOpen + defaults.MaxOpenConns/2) / defaults.MaxOpenConns
	if defaults.MaxIdleConns > 0 && scaledMaxOpen > 0 && scaledIdle < 1 {
		scaledIdle = 1
	}
	if scaledIdle > scaledMaxOpen {
		scaledIdle = scaledMaxOpen
	}

	return scaledIdle
}

// getDatabasePoolDefaultTotalMaxOpen sums the static role-aware max_open defaults across all roles.
// It bridges the role-default registry and autosize math that needs the baseline total budget.
// Exists so scaling logic can stay data-driven instead of duplicating magic numbers.
func getDatabasePoolDefaultTotalMaxOpen() int {
	total := 0
	for _, roleKey := range databasePoolRoleOrder {
		total += defaultDatabasePoolSettingsByRole[roleKey].MaxOpenConns
	}

	return total
}

// cloneDatabasePoolSettingsByRole copies the role-default registry before startup mutates derived values.
// It bridges the shared default map and any autosized per-startup variant without aliasing the original.
// Exists so role defaults remain a stable canonical source inside this package.
func cloneDatabasePoolSettingsByRole(source map[string]databasePoolSettings) map[string]databasePoolSettings {
	cloned := make(map[string]databasePoolSettings, len(source))
	for roleKey, settings := range source {
		cloned[roleKey] = settings
	}

	return cloned
}

// logDatabasePoolHeadroom compares the combined application pool budget against PostgreSQL capacity.
// It bridges one live sql.DB handle and the already computed pool totals to startup observability logs.
// Exists so operators get an immediate warning when the configured pool budget leaves little room to breathe.
func logDatabasePoolHeadroom(db *sql.DB, configuredTotalMaxOpen int, configuredTotalMaxIdle int) {
	if db == nil {
		return
	}

	postgresMaxConnections, err := readPostgresMaxConnections(db)
	if err != nil {
		log.Printf(
			"\033[33mwarning: failed to inspect postgres max_connections for db pool headroom: %v\033[0m",
			err,
		)
		return
	}

	assessment := assessDatabasePoolHeadroom(postgresMaxConnections, configuredTotalMaxOpen)

	if assessment.IsAtOrAboveCapacity {
		log.Printf(
			"\033[33mwarning: configured db pools meet or exceed postgres capacity: configured_total_max_open_conns=%d configured_total_max_idle_conns=%d postgres_max_connections=%d remaining_headroom=%d recommended_reserve=%d\033[0m",
			configuredTotalMaxOpen,
			configuredTotalMaxIdle,
			assessment.PostgresMaxConnections,
			assessment.RemainingHeadroom,
			assessment.RecommendedReserve,
		)
		return
	}

	if assessment.IsTight {
		log.Printf(
			"\033[33mwarning: db pool headroom is tight: configured_total_max_open_conns=%d configured_total_max_idle_conns=%d postgres_max_connections=%d remaining_headroom=%d recommended_reserve=%d\033[0m",
			configuredTotalMaxOpen,
			configuredTotalMaxIdle,
			assessment.PostgresMaxConnections,
			assessment.RemainingHeadroom,
			assessment.RecommendedReserve,
		)
		return
	}

	log.Printf(
		"db pool headroom: configured_total_max_open_conns=%d configured_total_max_idle_conns=%d postgres_max_connections=%d remaining_headroom=%d recommended_reserve=%d",
		configuredTotalMaxOpen,
		configuredTotalMaxIdle,
		assessment.PostgresMaxConnections,
		assessment.RemainingHeadroom,
		assessment.RecommendedReserve,
	)
}

// readPostgresMaxConnections reads PostgreSQL's runtime connection ceiling using the current DB session.
// It bridges sql.DB query access and the pool headroom logger without requiring write access or extra tooling.
// Exists so Easelect can compare its combined pool budget against the server's actual configured limit.
func readPostgresMaxConnections(db *sql.DB) (int, error) {
	var postgresMaxConnections int
	if err := db.QueryRow("SELECT current_setting('max_connections')::int").Scan(&postgresMaxConnections); err != nil {
		return 0, err
	}

	return postgresMaxConnections, nil
}

// readEffectiveMemoryLimitBytes resolves the effective memory ceiling for the current host/container.
// It bridges cgroup limits and /proc/meminfo into one conservative byte count for autosizing.
// Exists so DB pool defaults can adapt to container limits instead of assuming host RAM.
func readEffectiveMemoryLimitBytes() (int64, error) {
	memoryCandidates := []int64{}

	if memoryLimitBytes, err := readMemoryLimitBytesFile("/sys/fs/cgroup/memory.max"); err == nil && memoryLimitBytes > 0 {
		memoryCandidates = append(memoryCandidates, memoryLimitBytes)
	}
	if memoryLimitBytes, err := readMemoryLimitBytesFile("/sys/fs/cgroup/memory/memory.limit_in_bytes"); err == nil && memoryLimitBytes > 0 {
		memoryCandidates = append(memoryCandidates, memoryLimitBytes)
	}
	if memTotalBytes, err := readMemInfoTotalBytes("/proc/meminfo"); err == nil && memTotalBytes > 0 {
		memoryCandidates = append(memoryCandidates, memTotalBytes)
	}

	if len(memoryCandidates) == 0 {
		return 0, fmt.Errorf("no readable memory limit sources")
	}

	smallestCandidate := memoryCandidates[0]
	for _, candidate := range memoryCandidates[1:] {
		if candidate < smallestCandidate {
			smallestCandidate = candidate
		}
	}

	return smallestCandidate, nil
}

// readMemoryLimitBytesFile parses a raw byte-count limit from one cgroup memory file.
// It bridges the filesystem-based cgroup APIs and autosize logic with one small parser wrapper.
// Exists so different cgroup layouts can be probed without duplicating file-reading code.
func readMemoryLimitBytesFile(path string) (int64, error) {
	rawValue, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}

	return parseMemoryLimitBytes(string(rawValue))
}

// parseMemoryLimitBytes validates one raw cgroup memory limit value.
// It bridges cgroup string values like byte counts or "max" into a typed int64 result.
// Exists so autosize can reject unbounded or malformed limits and safely fall back.
func parseMemoryLimitBytes(rawValue string) (int64, error) {
	trimmedValue := strings.TrimSpace(rawValue)
	if trimmedValue == "" || trimmedValue == "max" {
		return 0, fmt.Errorf("memory limit is not bounded")
	}

	parsedValue, err := strconv.ParseUint(trimmedValue, 10, 64)
	if err != nil {
		return 0, err
	}

	if parsedValue > uint64(^uint64(0)>>1) {
		return 0, fmt.Errorf("memory limit %q exceeds int64 range", trimmedValue)
	}

	return int64(parsedValue), nil
}

// readMemInfoTotalBytes extracts MemTotal from a Linux /proc/meminfo-style file.
// It bridges kernel memory reporting and autosize fallback logic when cgroup limits are absent.
// Exists so bare-metal and lightly containerized hosts still provide a usable memory baseline.
func readMemInfoTotalBytes(path string) (int64, error) {
	rawValue, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}

	for _, line := range strings.Split(string(rawValue), "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0, fmt.Errorf("unexpected MemTotal line: %q", line)
		}

		memTotalKiB, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			return 0, err
		}

		return memTotalKiB * 1024, nil
	}

	return 0, fmt.Errorf("MemTotal not found")
}
