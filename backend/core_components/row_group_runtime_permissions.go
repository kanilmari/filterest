// row_group_runtime_permissions.go
// Reconciles least-privilege runtime access to generic row-group metadata.
// Bridges instance-specific database role names with row-group facet and search reads.
// Exists because release migrations cannot know dynamically generated Filterest role names.
package backend

import (
	"database/sql"
	"fmt"
	"os"
	"strings"

	"easelect/backend/core_components/security"
	"github.com/lib/pq"
)

var rowGroupRuntimeRoleEnvironmentKeys = []string{
	"DB_BASIC_USER",
	"DB_GUEST_USER",
	"DB_READONLY_USER",
}

var rowGroupProtectedRoleEnvironmentKeys = []string{
	"DB_ADMIN_USER",
	"DB_USER",
	"DB_CONFIDENTIAL_USER",
}

type rowGroupRuntimeRoleTarget struct {
	environmentKey string
	roleName       string
}

func rowGroupRuntimeRoleGrantSQL(rawRoleName string) (string, error) {
	roleName, err := security.SanitizeIdentifier(strings.TrimSpace(rawRoleName))
	if err != nil {
		return "", err
	}
	quotedRole := pq.QuoteIdentifier(roleName)
	return fmt.Sprintf(`
		GRANT USAGE ON SCHEMA public TO %s;
		REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
			ON TABLE public.system_row_groups, public.system_row_group_memberships
			FROM %s;
		REVOKE USAGE, UPDATE
			ON SEQUENCE public.system_row_groups_id_seq, public.system_row_group_memberships_id_seq
			FROM %s;
		GRANT SELECT
			ON TABLE public.system_row_groups, public.system_row_group_memberships
			TO %s`, quotedRole, quotedRole, quotedRole, quotedRole), nil
}

func configuredRowGroupRuntimeRoles() ([]rowGroupRuntimeRoleTarget, error) {
	seenRoles := make(map[string]struct{}, len(rowGroupRuntimeRoleEnvironmentKeys))
	targets := make([]rowGroupRuntimeRoleTarget, 0, len(rowGroupRuntimeRoleEnvironmentKeys))
	for _, environmentKey := range rowGroupRuntimeRoleEnvironmentKeys {
		rawRoleName := strings.TrimSpace(os.Getenv(environmentKey))
		if rawRoleName == "" {
			continue
		}
		roleName, err := security.SanitizeIdentifier(rawRoleName)
		if err != nil {
			return nil, fmt.Errorf("EnsureRowGroupRuntimeRolePermissions %s: %w", environmentKey, err)
		}
		if _, duplicate := seenRoles[roleName]; duplicate {
			continue
		}
		seenRoles[roleName] = struct{}{}
		targets = append(targets, rowGroupRuntimeRoleTarget{
			environmentKey: environmentKey,
			roleName:       roleName,
		})
	}
	return targets, nil
}

func protectedRowGroupRuntimeRoles() map[string]string {
	protected := map[string]string{"postgres": "PostgreSQL superuser"}
	for _, environmentKey := range rowGroupProtectedRoleEnvironmentKeys {
		if roleName := strings.TrimSpace(os.Getenv(environmentKey)); roleName != "" {
			protected[roleName] = environmentKey
		}
	}
	return protected
}

// EnsureRowGroupRuntimeRolePermissions grants configured read roles only the
// row-group table access required by facets and row-group-aware searches.
// It runs after migrations so upgraded and freshly bootstrapped instances use
// the same contract even when their role names include an installation id.
func EnsureRowGroupRuntimeRolePermissions(db *sql.DB) error {
	targets, err := configuredRowGroupRuntimeRoles()
	if err != nil || len(targets) == 0 {
		return err
	}

	protectedRoles := protectedRowGroupRuntimeRoles()
	for _, target := range targets {
		if protectedBy, protected := protectedRoles[target.roleName]; protected {
			return fmt.Errorf(
				"EnsureRowGroupRuntimeRolePermissions: %s must not equal protected role %s (%s)",
				target.environmentKey,
				target.roleName,
				protectedBy,
			)
		}
	}

	var (
		currentDatabaseRole       string
		groupsTableExists         bool
		membershipsExists         bool
		groupsSequenceExists      bool
		membershipsSequenceExists bool
	)
	if err := db.QueryRow(`
		SELECT current_user,
		       to_regclass('public.system_row_groups') IS NOT NULL,
		       to_regclass('public.system_row_group_memberships') IS NOT NULL,
		       to_regclass('public.system_row_groups_id_seq') IS NOT NULL,
		       to_regclass('public.system_row_group_memberships_id_seq') IS NOT NULL
	`).Scan(
		&currentDatabaseRole,
		&groupsTableExists,
		&membershipsExists,
		&groupsSequenceExists,
		&membershipsSequenceExists,
	); err != nil {
		return fmt.Errorf("EnsureRowGroupRuntimeRolePermissions inspect database contract: %w", err)
	}
	if !groupsTableExists || !membershipsExists || !groupsSequenceExists || !membershipsSequenceExists {
		return fmt.Errorf("EnsureRowGroupRuntimeRolePermissions: row-group tables or identity sequences are missing")
	}
	for _, target := range targets {
		if target.roleName == currentDatabaseRole {
			return fmt.Errorf(
				"EnsureRowGroupRuntimeRolePermissions: %s must not equal current database role %s",
				target.environmentKey,
				target.roleName,
			)
		}
		var safeReadRole bool
		if err := db.QueryRow(`
			SELECT EXISTS (
				SELECT 1
				FROM pg_roles AS candidate
				WHERE candidate.rolname = $1
				  AND NOT candidate.rolsuper
				  AND NOT candidate.rolcreaterole
				  AND NOT candidate.rolcreatedb
				  AND NOT candidate.rolreplication
				  AND NOT candidate.rolbypassrls
				  AND NOT EXISTS (
				      SELECT 1
				      FROM pg_database AS owned_database
				      WHERE owned_database.datdba = candidate.oid
				  )
				  AND NOT EXISTS (
				      SELECT 1
				      FROM pg_class AS owned_relation
				      JOIN pg_namespace AS owned_schema
				        ON owned_schema.oid = owned_relation.relnamespace
				      WHERE owned_relation.relowner = candidate.oid
				        AND owned_schema.nspname IN ('public', 'restricted')
				  )
			)
		`, target.roleName).Scan(&safeReadRole); err != nil {
			return fmt.Errorf("EnsureRowGroupRuntimeRolePermissions check %s: %w", target.environmentKey, err)
		}
		if !safeReadRole {
			return fmt.Errorf(
				"EnsureRowGroupRuntimeRolePermissions: configured role %s is missing or has protected database privileges",
				target.roleName,
			)
		}
	}

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("EnsureRowGroupRuntimeRolePermissions begin: %w", err)
	}
	defer tx.Rollback()
	for _, target := range targets {
		grantSQL, buildErr := rowGroupRuntimeRoleGrantSQL(target.roleName)
		if buildErr != nil {
			return fmt.Errorf("EnsureRowGroupRuntimeRolePermissions %s: %w", target.environmentKey, buildErr)
		}
		if _, execErr := tx.Exec(grantSQL); execErr != nil {
			return fmt.Errorf("EnsureRowGroupRuntimeRolePermissions grant %s: %w", target.environmentKey, execErr)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("EnsureRowGroupRuntimeRolePermissions commit: %w", err)
	}
	return nil
}
