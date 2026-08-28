// main.go
// Creates the first generated Filterest admin credentials during local setup.
// Bridges the public bootstrap database, bcrypt password hashing, and a local handoff file.
// Exists so public seeds never carry reusable admin passwords while fresh installs still get a usable admin.
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	_ "github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

const (
	defaultSiteSlug    = "filterest"
	defaultHandoffFile = "data/bootstrap/initial_admin_credentials.txt"
	creationSpec       = "filterest initial admin bootstrap"
)

type initialAdminConfig struct {
	host              string
	port              string
	dbName            string
	dbUser            string
	dbPassword        string
	sslMode           string
	siteSlug          string
	email             string
	handoffFile       string
	allowInvalidEmail bool
}

type existingAdminState struct {
	username           string
	loginReady         bool
	hasRestrictedCreds bool
	enabled            bool
	adminAccessAllowed bool
	hasAdminGroup      bool
}

// main runs the initial-admin bootstrap CLI between setup scripts and the local database.
// It exists as the command entry point so setup can fail closed on unsafe credential states.
func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

// run coordinates config parsing, database inspection, admin creation, and one-time credential output.
// It bridges the generated Filterest setup script and the lower-level bootstrap helpers.
func run(ctx context.Context, args []string) error {
	cfg, err := parseConfig(args)
	if err != nil {
		return err
	}

	db, err := sql.Open("postgres", cfg.dsn())
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	if err = db.PingContext(ctx); err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}

	result, err := ensureInitialAdmin(ctx, db, cfg)
	if err != nil {
		return err
	}

	switch result.status {
	case "created":
		if err = writeCredentialHandoff(cfg.handoffFile, result); err != nil {
			return err
		}
		fmt.Println("Filterest initial admin credentials generated.")
		fmt.Printf("  Username: %s\n", result.username)
		fmt.Printf("  Password: %s\n", result.password)
		fmt.Printf("  Email: %s\n", result.email)
		fmt.Printf("  Handoff file: %s\n", cfg.handoffFile)
		fmt.Println("  Delete the handoff file after the first login and password rotation.")
		if strings.HasSuffix(strings.ToLower(result.email), ".invalid") {
			fmt.Println("  Dev-only email placeholder used; keep LOGIN_OTP_CODE configured for this local preview.")
		}
	case "exists":
		fmt.Printf("Filterest login-ready admin already exists: %s\n", result.username)
		fmt.Println("  No password was generated or reprinted.")
	default:
		return fmt.Errorf("unknown bootstrap result status: %s", result.status)
	}
	return nil
}

// parseConfig converts setup flags and secret-bearing environment variables into bootstrap config.
// It exists to keep unsafe defaults, especially missing real admin email, out of the creation path.
func parseConfig(args []string) (initialAdminConfig, error) {
	var cfg initialAdminConfig
	flags := flag.NewFlagSet("initial-admin-bootstrap", flag.ContinueOnError)
	flags.StringVar(&cfg.host, "host", "localhost", "PostgreSQL host")
	flags.StringVar(&cfg.port, "port", "5433", "PostgreSQL port")
	flags.StringVar(&cfg.dbName, "db-name", "filterest", "database name")
	flags.StringVar(&cfg.dbUser, "db-user", "filterest_admin", "database user")
	flags.StringVar(&cfg.sslMode, "sslmode", "disable", "PostgreSQL sslmode")
	flags.StringVar(&cfg.siteSlug, "site-slug", defaultSiteSlug, "site slug for admin_<site_slug>")
	flags.StringVar(&cfg.email, "email", "", "initial admin email")
	flags.StringVar(&cfg.handoffFile, "handoff-file", defaultHandoffFile, "one-time credential handoff file")
	flags.BoolVar(&cfg.allowInvalidEmail, "allow-invalid-email", false, "allow a .invalid placeholder email only for explicit local dev OTP previews")
	if err := flags.Parse(args); err != nil {
		return cfg, err
	}

	cfg.dbPassword = strings.TrimSpace(firstEnv("FILTEREST_DB_PASSWORD", "PGPASSWORD"))
	if cfg.dbPassword == "" {
		return cfg, errors.New("FILTEREST_DB_PASSWORD or PGPASSWORD is required")
	}

	cfg.siteSlug = sanitizeSiteSlug(cfg.siteSlug)
	if cfg.siteSlug == "" {
		cfg.siteSlug = defaultSiteSlug
	}
	cfg.email = strings.TrimSpace(cfg.email)
	if cfg.email == "" {
		if !cfg.allowInvalidEmail {
			return cfg, errors.New("FILTEREST_INITIAL_ADMIN_EMAIL or --email is required unless --allow-invalid-email is set for an explicit local dev OTP preview")
		}
		cfg.email = fmt.Sprintf("admin@%s.invalid", cfg.siteSlug)
	}
	if !strings.Contains(cfg.email, "@") {
		return cfg, fmt.Errorf("initial admin email %q must contain @", cfg.email)
	}
	cfg.handoffFile = strings.TrimSpace(cfg.handoffFile)
	if cfg.handoffFile == "" {
		cfg.handoffFile = defaultHandoffFile
	}
	return cfg, nil
}

// firstEnv returns the first non-empty environment value from a priority list.
// It bridges legacy PGPASSWORD usage and the Filterest-specific setup password variable.
func firstEnv(keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value != "" {
			return value
		}
	}
	return ""
}

var invalidSlugRunes = regexp.MustCompile(`[^a-z0-9]+`)

// sanitizeSiteSlug normalizes a public site slug into the admin username suffix.
// It exists so the generated username format stays deterministic and shell/URL safe.
func sanitizeSiteSlug(value string) string {
	clean := strings.ToLower(strings.TrimSpace(value))
	clean = invalidSlugRunes.ReplaceAllString(clean, "_")
	clean = strings.Trim(clean, "_")
	if clean == "" {
		return defaultSiteSlug
	}
	return clean
}

// username builds the public first-admin username from the sanitized site slug.
// It implements the owner-selected admin_<site_slug> contract.
func (cfg initialAdminConfig) username() string {
	return "admin_" + sanitizeSiteSlug(cfg.siteSlug)
}

// dsn renders a PostgreSQL connection URL from setup config without logging secrets.
// It bridges setup flags and lib/pq's connection string format.
func (cfg initialAdminConfig) dsn() string {
	dsn := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(cfg.dbUser, cfg.dbPassword),
		Host:   net.JoinHostPort(cfg.host, cfg.port),
		Path:   cfg.dbName,
	}
	query := dsn.Query()
	query.Set("sslmode", cfg.sslMode)
	dsn.RawQuery = query.Encode()
	return dsn.String()
}

type initialAdminResult struct {
	status    string
	username  string
	password  string
	email     string
	createdAt time.Time
}

// ensureInitialAdmin creates the first login-ready admin only when none already exists.
// It bridges public system user rows, restricted credentials, and admin-group membership.
func ensureInitialAdmin(ctx context.Context, db *sql.DB, cfg initialAdminConfig) (initialAdminResult, error) {
	if state, found, err := findAnyLoginReadyAdmin(ctx, db); err != nil {
		return initialAdminResult{}, err
	} else if found {
		return initialAdminResult{status: "exists", username: state.username}, nil
	}

	username := cfg.username()
	if state, found, err := inspectAdminUsername(ctx, db, username); err != nil {
		return initialAdminResult{}, err
	} else if found {
		return initialAdminResult{}, fmt.Errorf(
			"target admin username %q exists but is not login-ready (enabled=%t admin_access_allowed=%t admin_group=%t restricted_credentials=%t)",
			username,
			state.enabled,
			state.adminAccessAllowed,
			state.hasAdminGroup,
			state.hasRestrictedCreds,
		)
	}

	password, err := generatePassword()
	if err != nil {
		return initialAdminResult{}, err
	}
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return initialAdminResult{}, fmt.Errorf("hash password: %w", err)
	}
	previewPIN := strings.TrimSpace(os.Getenv("LOGIN_OTP_CODE"))
	if len(previewPIN) < 4 || len(previewPIN) > 8 || strings.Trim(previewPIN, "0123456789") != "" {
		return initialAdminResult{}, errors.New("automated preview LOGIN_OTP_CODE must contain 4-8 digits")
	}
	hashedPIN, err := bcrypt.GenerateFromPassword([]byte(previewPIN), bcrypt.DefaultCost)
	if err != nil {
		return initialAdminResult{}, fmt.Errorf("hash preview PIN: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return initialAdminResult{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	groupID, err := lookupAdminGroupID(ctx, tx)
	if err != nil {
		return initialAdminResult{}, err
	}

	var userID int64
	err = tx.QueryRowContext(ctx, `
		INSERT INTO system_users (
			username,
			full_name,
			created,
			updated,
			enabled,
			privileged,
			main_group_id,
			creation_spec,
			admin_access_allowed
		)
		VALUES ($1, $2, NOW(), NOW(), TRUE, FALSE, $3, $4, TRUE)
		RETURNING id
	`, username, "Initial Filterest Admin", groupID, creationSpec).Scan(&userID)
	if err != nil {
		return initialAdminResult{}, fmt.Errorf("insert admin user: %w", err)
	}

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO system_user_group_memberships (
			user_id,
			group_id,
			created,
			updated,
			creation_spec
		)
		VALUES ($1, $2, NOW(), NOW(), $3)
	`, userID, groupID, creationSpec); err != nil {
		return initialAdminResult{}, fmt.Errorf("insert admin group membership: %w", err)
	}

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO restricted.users_restricted (
			id, password, email, login_verification_method, fixed_pin_hash
		)
		VALUES ($1, $2, $3, 'fixed_pin', $4)
	`, userID, string(hashedPassword), cfg.email, string(hashedPIN)); err != nil {
		return initialAdminResult{}, fmt.Errorf("insert restricted credentials: %w", err)
	}

	if _, err = tx.ExecContext(ctx, `
		UPDATE system_config
		SET boolean_value = FALSE,
		    json_value = jsonb_set(COALESCE(json_value, '{}'::jsonb), '{value}', 'false'::jsonb, TRUE),
		    updated = NOW()
		WHERE key = 'first_run'
	`); err != nil {
		return initialAdminResult{}, fmt.Errorf("close first-run state for automated preview: %w", err)
	}

	if err = tx.Commit(); err != nil {
		return initialAdminResult{}, fmt.Errorf("commit initial admin: %w", err)
	}

	return initialAdminResult{
		status:    "created",
		username:  username,
		password:  password,
		email:     cfg.email,
		createdAt: time.Now().UTC(),
	}, nil
}

// findAnyLoginReadyAdmin detects whether setup should skip password generation.
// It exists so one-time credentials are never reprinted after a usable admin exists.
func findAnyLoginReadyAdmin(ctx context.Context, db *sql.DB) (existingAdminState, bool, error) {
	var state existingAdminState
	err := db.QueryRowContext(ctx, `
		SELECT u.username
		FROM system_users u
		JOIN system_user_group_memberships ug ON ug.user_id = u.id
		JOIN system_user_groups g ON g.id = ug.group_id AND g.name = 'admins'
		JOIN restricted.users_restricted ur ON ur.id = u.id
		WHERE u.enabled IS TRUE
		  AND u.admin_access_allowed IS TRUE
		ORDER BY u.id
		LIMIT 1
	`).Scan(&state.username)
	if errors.Is(err, sql.ErrNoRows) {
		return state, false, nil
	}
	if err != nil {
		return state, false, fmt.Errorf("inspect existing login-ready admins: %w", err)
	}
	state.loginReady = true
	return state, true, nil
}

// inspectAdminUsername checks whether the target username is occupied but incomplete.
// It exists to fail closed instead of overwriting or silently repairing ambiguous accounts.
func inspectAdminUsername(ctx context.Context, db *sql.DB, username string) (existingAdminState, bool, error) {
	var state existingAdminState
	err := db.QueryRowContext(ctx, `
		SELECT
			u.username,
			COALESCE(u.enabled, FALSE),
			COALESCE(u.admin_access_allowed, FALSE),
			EXISTS (
				SELECT 1
				FROM system_user_group_memberships ug
				JOIN system_user_groups g ON g.id = ug.group_id
				WHERE ug.user_id = u.id
				  AND g.name = 'admins'
			),
			EXISTS (
				SELECT 1
				FROM restricted.users_restricted ur
				WHERE ur.id = u.id
			)
		FROM system_users u
		WHERE u.username = $1
	`, username).Scan(
		&state.username,
		&state.enabled,
		&state.adminAccessAllowed,
		&state.hasAdminGroup,
		&state.hasRestrictedCreds,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return state, false, nil
	}
	if err != nil {
		return state, false, fmt.Errorf("inspect admin username: %w", err)
	}
	state.loginReady = state.enabled && state.adminAccessAllowed && state.hasAdminGroup && state.hasRestrictedCreds
	return state, true, nil
}

// lookupAdminGroupID resolves the canonical admins group inside the creation transaction.
// It bridges the public group catalog and the new admin user's membership row.
func lookupAdminGroupID(ctx context.Context, tx *sql.Tx) (int64, error) {
	var groupID int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM system_user_groups WHERE name = 'admins'`).Scan(&groupID)
	if err != nil {
		return 0, fmt.Errorf("lookup admins group: %w", err)
	}
	return groupID, nil
}

// generatePassword creates the one-time initial admin password from cryptographic randomness.
// It exists so the public bootstrap seed never stores a reusable static password.
func generatePassword() (string, error) {
	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("generate password bytes: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(randomBytes), nil
}

// writeCredentialHandoff writes the one-time credential file with owner-only permissions.
// It bridges setup stdout and the local handoff artifact that must be deleted after rotation.
func writeCredentialHandoff(path string, result initialAdminResult) error {
	absolutePath := filepath.Clean(path)
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o700); err != nil {
		return fmt.Errorf("create handoff directory: %w", err)
	}

	content := fmt.Sprintf(`# Filterest initial admin credentials

These credentials are generated once during local setup.
Delete this file after the first login and password rotation.

Username: %s
Password: %s
Email: %s
Generated at: %s

After logging in, rotate the password and confirm the admin email/OTP setup.
The public bootstrap seed does not contain reusable admin credentials.
`, result.username, result.password, result.email, result.createdAt.Format(time.RFC3339))

	if err := os.WriteFile(absolutePath, []byte(content), 0o600); err != nil {
		return fmt.Errorf("write handoff file: %w", err)
	}
	return os.Chmod(absolutePath, 0o600)
}
