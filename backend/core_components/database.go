// database.go
// Configures and exposes the shared database connection pool for the backend package.
// Provides package-level *sql.DB variables (Db, DbAdmin, DbBasic, DbGuest, DbConfidential)
// and helpers for initializing each role-specific SQL client at startup.
package backend

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/lib/pq"
)

var (
	// Db = "pääyhteys" joka tässä esimerkissä halutaan osoittaa samaan kuin DbGuest
	Db             *sql.DB
	DbAdmin        *sql.DB
	DbReaderOnly   *sql.DB
	DbConfidential *sql.DB
	DbBasic        *sql.DB
	DbGuest        *sql.DB
)

func InitDB() error {
	if _, err := ensureEnvironmentVariablesLoaded(); err != nil {
		fmt.Printf("\033[31merror loading environment variables: %s\033[0m\n", err.Error())
	}

	dbHost := os.Getenv("DB_HOST")
	dbPort := os.Getenv("DB_PORT")
	dbName := os.Getenv("DB_NAME")
	// SSL mode: respect DB_SSLMODE env var, fallback to environment type logic
	sslMode := os.Getenv("DB_SSLMODE")
	if sslMode == "" {
		// Default: require SSL in production, disable in dev
		if os.Getenv("ENVIRONMENT_TYPE") == "dev" {
			sslMode = "disable"
		} else {
			sslMode = "require"
		}
	}

	type DbConnectionInfo struct {
		roleKey         string
		roleLabel       string
		roleDescription string
		dbUserEnv       string
		dbPasswordEnv   string
		dbPointer       **sql.DB
	}

	dbConnectionList := []DbConnectionInfo{
		{
			roleKey:         dbPoolRoleAdmin,
			roleLabel:       "admin",
			roleDescription: "Access to public",
			dbUserEnv:       os.Getenv("DB_ADMIN_USER"),
			dbPasswordEnv:   os.Getenv("DB_ADMIN_PASSWORD"),
			dbPointer:       &DbAdmin,
		},
		{
			roleKey:         dbPoolRoleReadOnly,
			roleLabel:       "readonly",
			roleDescription: "Read-only access to public, great for AI SQL queries",
			dbUserEnv:       os.Getenv("DB_READONLY_USER"),
			dbPasswordEnv:   os.Getenv("DB_READONLY_PASSWORD"),
			dbPointer:       &DbReaderOnly,
		},
		{
			roleKey:         dbPoolRoleConfidential,
			roleLabel:       "confidential",
			roleDescription: "Access only to confidential data",
			dbUserEnv:       os.Getenv("DB_CONFIDENTIAL_USER"),
			dbPasswordEnv:   os.Getenv("DB_CONFIDENTIAL_PASSWORD"),
			dbPointer:       &DbConfidential,
		},
		{
			roleKey:         dbPoolRoleBasic,
			roleLabel:       "basic",
			roleDescription: "Basic user can't see if they have been muted, etc.",
			dbUserEnv:       os.Getenv("DB_BASIC_USER"),
			dbPasswordEnv:   os.Getenv("DB_BASIC_PASSWORD"),
			dbPointer:       &DbBasic,
		},
		{
			roleKey:         dbPoolRoleGuest,
			roleLabel:       "guest",
			roleDescription: "Guest user can't see users, etc.",
			dbUserEnv:       os.Getenv("DB_GUEST_USER"),
			dbPasswordEnv:   os.Getenv("DB_GUEST_PASSWORD"),
			dbPointer:       &DbGuest,
		},
	}

	totalConfiguredMaxOpenConns := 0
	totalConfiguredMaxIdleConns := 0
	var resolvedDefaultPoolSettingsByRole map[string]databasePoolSettings

	for _, conn := range dbConnectionList {
		connectionString := fmt.Sprintf(
			"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
			dbHost, dbPort, conn.dbUserEnv, conn.dbPasswordEnv, dbName, sslMode,
		)

		dbInstance, err := sql.Open("postgres", connectionString)
		if err != nil {
			fmt.Printf("\033[31merror opening %s: %s\033[0m\n",
				conn.roleDescription, err.Error())
			return err
		}

		if err := dbInstance.Ping(); err != nil {
			fmt.Printf("\033[31merror connecting to '%s': %s\033[0m\n",
				conn.roleDescription, err.Error())
			return err
		}

		if resolvedDefaultPoolSettingsByRole == nil {
			resolvedDefaultPoolSettingsByRole = resolveDatabasePoolDefaultSettings(dbInstance)
		}

		*conn.dbPointer = dbInstance

		poolSettings := loadDatabasePoolSettingsFromDefaults(
			conn.roleKey,
			resolvedDefaultPoolSettingsByRole[conn.roleKey],
		)
		applyDatabasePoolSettings(*conn.dbPointer, poolSettings)

		totalConfiguredMaxOpenConns += poolSettings.MaxOpenConns
		totalConfiguredMaxIdleConns += poolSettings.MaxIdleConns

		logDatabasePoolConfiguration(conn.roleLabel, poolSettings, (*conn.dbPointer).Stats())
	}

	// Sovelluksen käynnistyessä otetaan käyttöön Db:n arvo
	Db = DbAdmin
	logDatabasePoolHeadroom(DbAdmin, totalConfiguredMaxOpenConns, totalConfiguredMaxIdleConns)

	fmt.Printf(
		"Database connections opened successfully. configured_total_max_open_conns=%d configured_total_max_idle_conns=%d\n",
		totalConfiguredMaxOpenConns,
		totalConfiguredMaxIdleConns,
	)
	return nil
}

func CloseDB() {
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

	for _, conn := range dbConnectionList {
		if conn.db == nil {
			continue
		}
		logDatabasePoolStats(conn.roleLabel, "shutdown", conn.db.Stats())
		conn.db.Close()
	}
}
