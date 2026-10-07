// account_name_allocator.go
// Allocates public administrator, automation and reserved-user names with one SQL rule.
// Bridges trusted account creators and K1's case-insensitive namespace checks.
// Keeps numbering and site-slug suggestions consistent across browser and operator tools.
package credentials

import (
	"context"
	"database/sql"
	"github.com/lib/pq"
	"os"
	"regexp"
	"strings"
)

// NextAccountDisplayName uses the migration-owned smallest-free numbering rule.
// The advisory lock serializes cooperating creators until the caller commits.
func NextAccountDisplayName(ctx context.Context, tx *sql.Tx, prefix string, alsoTaken ...string) (string, error) {
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('account display allocation',0))`); err != nil {
		return "", err
	}
	var name string
	err := tx.QueryRowContext(ctx, `SELECT public.app_next_admin_display_name($1,$2::text[])`, prefix, pq.Array(alsoTaken)).Scan(&name)
	return name, err
}

var invalidSiteSlugRunes = regexp.MustCompile(`[^a-z0-9]+`)

// AdministratorSiteSlug owns the setup environment order and normalization.
// An explicit slug remains supported for existing command-line callers.
func AdministratorSiteSlug(explicit string) string {
	value := strings.TrimSpace(explicit)
	for _, key := range []string{"FILTEREST_SITE_SLUG", "SITE_SLUG"} {
		if value == "" {
			value = strings.TrimSpace(os.Getenv(key))
		}
	}
	value = strings.Trim(invalidSiteSlugRunes.ReplaceAllString(strings.ToLower(value), "_"), "_")
	if value == "" {
		value = "filterest"
	}
	return value
}

// SuggestedAdministratorLoginName returns empty when the proposal is reserved or invalid.
func SuggestedAdministratorLoginName(explicit ...string) string {
	slug := ""
	if len(explicit) > 0 {
		slug = explicit[0]
	}
	name := "admin_" + AdministratorSiteSlug(slug)
	if ValidateLoginName(name) != nil {
		return ""
	}
	return name
}

// ValidateReservedLoginName admits only trusted system fixtures to the reserved namespace.
// It still uses ValidateLoginName for the shared format and all other reservations.
func ValidateReservedLoginName(name string) error {
	err := ValidateLoginName(name)
	if err == nil {
		return nil
	}
	if len(name) < 3 || len(name) > 64 || !administratorUsernamePattern.MatchString(name) {
		return err
	}
	// Only the explicitly configured local development administrator may use admin_<n>.
	// The allocator excludes login names, so its public name cannot collide.
	if reservedLoginPattern.MatchString(name) {
		if strings.EqualFold(os.Getenv("ENVIRONMENT_TYPE"), "dev") && strings.HasPrefix(strings.ToLower(name), "admin_") && strings.EqualFold(name, strings.TrimSpace(os.Getenv("FILTEREST_DEV_ADMIN_USERNAME"))) {
			return nil
		}
		return err
	}
	for _, reserved := range ReservedLoginNames() {
		if strings.EqualFold(name, reserved) {
			return nil
		}
	}
	return err
}
