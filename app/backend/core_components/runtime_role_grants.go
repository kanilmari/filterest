// runtime_role_grants.go
// Connects actual application pool identities to the shared startup grant policy.
// Replaces the four independent startup grant producers with one transaction.
// Logs bounded counts only; the read-only auditor owns full catalogue output.
package backend

import (
	"context"
	"database/sql"
	"fmt"
	"os"

	"easelect/backend/core_components/runtime_grants"
)

func EnsureRuntimeRoleGrants(ctx context.Context, db *sql.DB) error {
	roles := runtime_grants.ConfiguredRoles(os.Getenv)
	if err := ValidateRuntimeRolePools(ctx); err != nil {
		return err
	}
	result, err := runtime_grants.EnsureRuntimeRoleGrants(ctx, db, roles)
	if err != nil {
		return err
	}
	runtime_grants.LogStartupGrantSummary(result)
	return nil
}

func ValidateRuntimeRolePools(ctx context.Context) error {
	roles := runtime_grants.ConfiguredRoles(os.Getenv)
	for _, pool := range []struct {
		label string
		db    *sql.DB
	}{{"basic", DbBasic}, {"guest", DbGuest}, {"readonly", DbReaderOnly}, {"confidential", DbConfidential}} {
		if pool.db == nil {
			return fmt.Errorf("runtime pool %s is missing; no ACL changes", pool.label)
		}
		var identity string
		if err := pool.db.QueryRowContext(ctx, `SELECT current_user`).Scan(&identity); err != nil {
			return fmt.Errorf("read runtime pool %s identity: %w", pool.label, err)
		}
		if identity != roles.Names[pool.label] {
			return fmt.Errorf("runtime pool %s does not match its configured identity; no ACL changes", pool.label)
		}
	}
	return nil
}
