// startup_preflight.go
// Checks role safety before migrations can change privileges.
// Reuses the snapshot loader's exact identity checks without requiring registries.
package runtime_grants

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

func loadRuntimeRoleIdentities(ctx context.Context, tx *sql.Tx, config RoleConfiguration, snapshot *GrantSnapshot) error {
	for _, label := range []string{"basic", "guest", "readonly", "confidential"} {
		name := config.Names[label]
		if name == "" || strings.ContainsRune(name, 0) {
			return fmt.Errorf("runtime role %s is not configured", label)
		}
		for _, protected := range config.ProtectedNames {
			if name == protected {
				return fmt.Errorf("runtime role %s equals a protected identity", label)
			}
		}
		var role Role
		role.Label, role.Name = label, name
		var unsafe bool
		err := tx.QueryRowContext(ctx, `SELECT oid, rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
		 OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=pg_roles.oid)
		 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid)
		 OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=pg_roles.oid AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_')
		 OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=pg_roles.oid AND nspname !~ '^pg_' AND nspname <> 'information_schema')
		 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proowner=pg_roles.oid AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
		 FROM pg_roles WHERE rolname=$1`, name).Scan(&role.OID, &unsafe)
		if err != nil {
			return fmt.Errorf("read runtime role %s identity: %w", label, err)
		}
		if unsafe {
			snapshot.Blockers = append(snapshot.Blockers, Finding{Role: label, Finding: "blocker", Reason: "runtime identity has ownership, inherited rights or elevated attributes"})
		}
		for _, previous := range snapshot.Roles {
			if previous.OID == role.OID {
				return fmt.Errorf("runtime roles %s and %s share an identity", previous.Label, label)
			}
		}
		snapshot.Roles = append(snapshot.Roles, role)
	}
	return nil
}
func ValidateStartupRoleConfiguration(ctx context.Context, db *sql.DB, config RoleConfiguration) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var snapshot GrantSnapshot
	if err := loadRuntimeRoleIdentities(ctx, tx, config, &snapshot); err != nil {
		return err
	}
	if len(snapshot.Blockers) > 0 {
		first := snapshot.Blockers[0]
		return fmt.Errorf("unsafe runtime role setup: %s: %s (configured role %q)", first.Role, first.Reason, config.Names[first.Role])
	}
	return nil
}
