// main.go
// Runs the local operator command for recovering one existing administrator account.
// Bridges a protected TTY, an explicitly selected PostgreSQL target, and shared recovery logic.
// Exists so a locked-out deployment can recover access without public recovery routes or plaintext arguments.
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"easelect/backend/core_components/auth/credentials"

	_ "github.com/lib/pq"
)

const databaseConnectionTimeout = 10 * time.Second

type commandConfig struct {
	host       string
	port       string
	dbName     string
	dbUser     string
	sslMode    string
	siteDomain string
	dryRun     bool
}

type commandDependencies struct {
	openTerminal func() (operatorTerminal, error)
	openDatabase func(string) (*sql.DB, error)
	lookupEnv    func(string) string
}

// main keeps all credential prompts inside the process-owned terminal and emits no secret values.
func main() {
	dependencies := commandDependencies{
		openTerminal: openOperatorTerminal,
		openDatabase: func(connectionString string) (*sql.DB, error) {
			return sql.Open("postgres", connectionString)
		},
		lookupEnv: os.Getenv,
	}
	if err := run(context.Background(), os.Args[1:], dependencies); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

// run parses only non-secret target options and performs the TTY/database recovery workflow.
// Database, administrator, password, PIN, and confirmation failures return without partial mutation.
func run(ctx context.Context, args []string, dependencies commandDependencies) error {
	if dependencies.openTerminal == nil || dependencies.openDatabase == nil || dependencies.lookupEnv == nil {
		return errors.New("command dependencies are incomplete")
	}
	config, err := parseCommandConfig(args, dependencies.lookupEnv)
	if err != nil {
		return err
	}

	terminal, err := dependencies.openTerminal()
	if err != nil {
		return fmt.Errorf("open protected operator terminal: %w", err)
	}
	defer terminal.Close()

	terminal.Printf("Filterest administrator credential recovery\n")
	terminal.Printf("Connection target: %s:%s database=%s role=%s sslmode=%s\n", config.host, config.port, config.dbName, config.dbUser, config.sslMode)
	databasePassword, usesRuntimeSecret := resolveRuntimeDatabasePassword(config, dependencies.lookupEnv)
	if usesRuntimeSecret {
		terminal.Printf("Using the protected runtime database credential for role %s.\n", config.dbUser)
	} else {
		databasePassword, err = readConfirmedSecret(
			terminal,
			fmt.Sprintf("Database password for role %s: ", config.dbUser),
			fmt.Sprintf("Repeat database password for role %s: ", config.dbUser),
			"database password entries do not match",
		)
		if err != nil {
			return err
		}
	}

	database, err := dependencies.openDatabase(config.connectionString(databasePassword))
	if err != nil {
		return fmt.Errorf("open recovery database: %w", err)
	}
	defer database.Close()

	pingContext, cancelPing := context.WithTimeout(ctx, databaseConnectionTimeout)
	defer cancelPing()
	if err = database.PingContext(pingContext); err != nil {
		return fmt.Errorf("connect to recovery database: %w", err)
	}

	editor := credentials.NewRecoveryEditor(database)
	emailDeliveryReady := credentials.EmailDeliveryConfigured(
		firstConfiguredValue(dependencies.lookupEnv, "POSTMARK_API_KEY", "POSTMARK_SERVER_TOKEN"),
		firstConfiguredValue(dependencies.lookupEnv, "EMAIL_FROM_ADDRESS", "POSTMARK_FROM_ADDRESS"),
	)
	return executeRecoveryWorkflow(ctx, terminal, editor, config.siteDomain, config.dryRun, emailDeliveryReady)
}

// resolveRuntimeDatabasePassword uses an existing protected runtime admin credential only for its matching role.
// It never falls across role names, prints the value, or accepts a database password from command arguments.
func resolveRuntimeDatabasePassword(config commandConfig, lookupEnv func(string) string) (string, bool) {
	runtimeAdminUser := strings.TrimSpace(lookupEnv("DB_ADMIN_USER"))
	runtimeAdminPassword := lookupEnv("DB_ADMIN_PASSWORD")
	if strings.TrimSpace(runtimeAdminPassword) == "" {
		return "", false
	}
	if runtimeAdminUser != "" && config.dbUser != runtimeAdminUser {
		return "", false
	}
	return runtimeAdminPassword, true
}

func parseCommandConfig(args []string, lookupEnv func(string) string) (commandConfig, error) {
	config := commandConfig{}
	flags := flag.NewFlagSet("filterest-admin-recovery", flag.ContinueOnError)
	flags.StringVar(&config.host, "host", configuredValueOrDefault(lookupEnv, "DB_HOST", "127.0.0.1"), "PostgreSQL host or SSH-tunnel endpoint")
	flags.StringVar(&config.port, "port", configuredValueOrDefault(lookupEnv, "DB_PORT", "5432"), "PostgreSQL port")
	flags.StringVar(&config.dbName, "db-name", configuredValueOrDefault(lookupEnv, "DB_NAME", "filterest"), "PostgreSQL database")
	flags.StringVar(&config.dbUser, "db-user", configuredValueOrDefault(lookupEnv, "DB_ADMIN_USER", "filterest_admin"), "privileged PostgreSQL role")
	flags.StringVar(&config.sslMode, "sslmode", configuredValueOrDefault(lookupEnv, "DB_SSLMODE", "require"), "PostgreSQL SSL mode")
	flags.BoolVar(&config.dryRun, "dry-run", false, "show target identity and eligible administrators without changing credentials")
	if err := flags.Parse(args); err != nil {
		return config, err
	}
	if flags.NArg() != 0 {
		return config, errors.New("positional arguments are not accepted; passwords and PINs must be entered in the protected terminal")
	}
	for fieldName, value := range map[string]string{
		"host": config.host, "port": config.port, "db-name": config.dbName,
		"db-user": config.dbUser, "sslmode": config.sslMode,
	} {
		if strings.TrimSpace(value) == "" {
			return config, fmt.Errorf("%s must not be empty", fieldName)
		}
	}
	siteDomain, err := siteDomainFromProtectedBaseURL(lookupEnv("BASE_URL"))
	if err != nil {
		return config, err
	}
	config.siteDomain = siteDomain
	return config, nil
}

// siteDomainFromProtectedBaseURL extracts one canonical hostname from the container's protected public origin.
// It rejects ambiguous URLs so the final confirmation cannot silently derive a domain from display metadata.
func siteDomainFromProtectedBaseURL(value string) (string, error) {
	rawBaseURL := strings.TrimSpace(value)
	if rawBaseURL == "" {
		return "", errors.New("protected BASE_URL is required for administrator recovery target confirmation")
	}
	parsedBaseURL, err := url.Parse(rawBaseURL)
	if err != nil || !parsedBaseURL.IsAbs() || parsedBaseURL.Hostname() == "" {
		return "", errors.New("protected BASE_URL must be an absolute site URL")
	}
	if parsedBaseURL.Scheme != "https" && !(parsedBaseURL.Scheme == "http" && isLoopbackSiteHostname(parsedBaseURL.Hostname())) {
		return "", errors.New("protected BASE_URL must use HTTPS except for a loopback development host")
	}
	if parsedBaseURL.User != nil || (parsedBaseURL.Path != "" && parsedBaseURL.Path != "/") ||
		parsedBaseURL.ForceQuery || parsedBaseURL.RawQuery != "" || parsedBaseURL.Fragment != "" {
		return "", errors.New("protected BASE_URL must not contain credentials, a path, query parameters, or a fragment")
	}
	domain := strings.ToLower(strings.TrimSpace(parsedBaseURL.Hostname()))
	domain = strings.TrimSuffix(domain, ".")
	if domain == "" {
		return "", errors.New("protected BASE_URL hostname must not be empty")
	}
	if len(domain) > 253 {
		return "", errors.New("protected BASE_URL hostname is longer than 253 characters")
	}
	if strings.ContainsAny(domain, "/\\:@ \t\r\n") {
		return "", errors.New("protected BASE_URL hostname contains ambiguous delimiters or whitespace")
	}
	for _, label := range strings.Split(domain, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", errors.New("protected BASE_URL hostname contains an invalid DNS label")
		}
		for _, character := range label {
			if (character < 'a' || character > 'z') &&
				(character < '0' || character > '9') && character != '-' {
				return "", errors.New("protected BASE_URL hostname contains characters outside ASCII DNS hostname syntax")
			}
		}
	}
	return domain, nil
}

// isLoopbackSiteHostname limits the only non-HTTPS BASE_URL exception to local development addresses.
// It prevents a remote plaintext origin from becoming trusted recovery confirmation metadata.
func isLoopbackSiteHostname(hostname string) bool {
	canonicalHostname := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(hostname), "."))
	if canonicalHostname == "localhost" || strings.HasSuffix(canonicalHostname, ".localhost") {
		return true
	}
	address := net.ParseIP(canonicalHostname)
	return address != nil && address.IsLoopback()
}

// connectionString URL-escapes the in-memory database credential for lib/pq without logging it.
// The resulting value must remain inside the database opener and must never be printed or audited.
func (config commandConfig) connectionString(password string) string {
	connectionURL := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(config.dbUser, password),
		Host:   net.JoinHostPort(config.host, config.port),
		Path:   config.dbName,
	}
	query := connectionURL.Query()
	query.Set("sslmode", config.sslMode)
	connectionURL.RawQuery = query.Encode()
	return connectionURL.String()
}

func configuredValueOrDefault(lookupEnv func(string) string, key, fallback string) string {
	if lookupEnv != nil {
		if value := strings.TrimSpace(lookupEnv(key)); value != "" {
			return value
		}
	}
	return fallback
}

func firstConfiguredValue(lookupEnv func(string) string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(lookupEnv(key)); value != "" {
			return value
		}
	}
	return ""
}
