// permissions_reader.go
// Provides shared types and query helpers for permission management operations.
// Bridges permission handlers, cleanup routines, and the underlying rights tables.
// Exists to centralise reusable permission lookups so permission flows share one helper layer.

package backend

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"

	"easelect/backend/core_components/security"
)

type rowQueryer interface {
	QueryRow(query string, args ...interface{}) *sql.Row
}

type Permission struct {
	AuthUserGroupID  int    `json:"user_group_id"`
	FunctionID       int    `json:"function_id"`
	TargetSchemaName string `json:"target_schema_name"`
	TargetTableName  string `json:"target_dataset_name"`
	TargetTableUID   int    `json:"target_table_uid"`
}

// getTableUIDByName returns the table_uid for a given table name.
func getTableUIDByName(name string, q rowQueryer) (int, error) {
	var uid int
	err := q.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name = $1`, name).Scan(&uid)
	if err != nil {
		return 0, err
	}
	return uid, nil
}

func insertPermission(p Permission) (bool, error) {
	query := `
    INSERT INTO system_group_table_func_rights
        (user_group_id,
         function_id,
         target_schema_name,
         target_table_uid)
    SELECT $1, $2, $3,
           $4
    WHERE NOT EXISTS (
        SELECT 1
        FROM system_group_table_func_rights
        WHERE user_group_id = $1
          AND function_id = $2
          AND COALESCE(target_schema_name, '') = COALESCE($3, '')
          AND COALESCE(target_table_uid, 0) = COALESCE($4, 0)
    )
    `

	var uid sql.NullInt64
	if p.TargetTableUID != 0 {
		uid = sql.NullInt64{Int64: int64(p.TargetTableUID), Valid: true}
	}

	res, err := Db.Exec(query,
		p.AuthUserGroupID,
		p.FunctionID,
		sql.NullString{String: p.TargetSchemaName, Valid: p.TargetSchemaName != ""},
		uid,
	)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return false, fmt.Errorf("insert error: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return false, fmt.Errorf("rows affected error: %w", err)
	}
	return rows > 0, nil
}

// EnsureAdminPermissions grants admin group (user_group_id=1, schema='public')
// access to every non-table-specific (tableless) function that they do not
// already have. This is an idempotent startup hook ensuring that newly
// registered routes are immediately accessible to admins without manual
// permission grants through the UI.
func EnsureAdminPermissions(db *sql.DB) error {
	const adminGroupID = 1

	result, err := db.Exec(`
		INSERT INTO system_group_table_func_rights
		       (user_group_id, function_id, target_schema_name, target_table_uid)
		SELECT $1, sf.id, 'public', NULL
		  FROM system_functions sf
		 WHERE sf.disabled = false
		   AND sf.specific_table_related = false
		   AND NOT EXISTS (
		       SELECT 1
		         FROM system_group_table_func_rights gf
		        WHERE gf.user_group_id  = $1
		          AND gf.function_id    = sf.id
		          AND gf.target_schema_name = 'public'
		          AND gf.target_table_uid IS NULL
		   )
	`, adminGroupID)
	if err != nil {
		return fmt.Errorf("EnsureAdminPermissions: %w", err)
	}
	if n, _ := result.RowsAffected(); n > 0 {
		log.Printf("EnsureAdminPermissions: granted %d new tableless permission(s) to admin group", n)
	}
	return nil
}

// EnsureAdminTablePermissions grants the admin group table-specific access to
// every registered dataset/function pair that is missing a permission row.
// This acts as a startup safety net for tables introduced by migrations or
// other metadata registration flows outside the runtime create-table handlers.
func EnsureAdminTablePermissions(db *sql.DB) error {
	const adminGroupID = 1

	result, err := db.Exec(`
		INSERT INTO system_group_table_func_rights
		       (user_group_id, function_id, target_schema_name, target_table_uid)
		SELECT $1,
		       sf.id,
		       COALESCE(sdt.schema_name, 'public'),
		       sdt.table_uid
		  FROM system_functions sf
		  JOIN system_db_tables sdt ON true
		 WHERE sf.disabled = false
		   AND COALESCE(sf.specific_table_related, true) = true
		   AND NOT EXISTS (
		       SELECT 1
		         FROM system_group_table_func_rights gf
		        WHERE gf.user_group_id = $1
		          AND gf.function_id = sf.id
		          AND COALESCE(gf.target_schema_name, 'public') = COALESCE(sdt.schema_name, 'public')
		          AND gf.target_table_uid = sdt.table_uid
		   )
	`, adminGroupID)
	if err != nil {
		return fmt.Errorf("EnsureAdminTablePermissions: %w", err)
	}
	if n, _ := result.RowsAffected(); n > 0 {
		log.Printf("EnsureAdminTablePermissions: granted %d new table-specific permission(s) to admin group", n)
	}
	return nil
}

// EnsureConfidentialRolePermissions grants the configured confidential DB role
// the restricted-schema access required by login, profile, and OTP helpers.
// This is a startup reconciliation hook so Docker/local instances do not drift
// into "wrong_credentials" failures when role grants were created incompletely.
func EnsureConfidentialRolePermissions(db *sql.DB) error {
	confidentialUser := strings.TrimSpace(os.Getenv("DB_CONFIDENTIAL_USER"))
	if confidentialUser == "" {
		return nil
	}

	safeRoleName, err := security.SanitizeIdentifier(confidentialUser)
	if err != nil {
		return fmt.Errorf("EnsureConfidentialRolePermissions: %w", err)
	}

	result, err := db.Exec(`
		DO $$
		DECLARE
			role_name text := '` + safeRoleName + `';
		BEGIN
			IF role_name IS NULL OR btrim(role_name) = '' THEN
				RETURN;
			END IF;

			IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted') THEN
				EXECUTE format('GRANT USAGE ON SCHEMA restricted TO %I', role_name);
				EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA restricted TO %I', role_name);
				EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA restricted GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', role_name);
				EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA restricted TO %I', role_name);
				EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA restricted GRANT USAGE, SELECT ON SEQUENCES TO %I', role_name);
			END IF;
		END $$;
	`)
	if err != nil {
		return fmt.Errorf("EnsureConfidentialRolePermissions: %w", err)
	}
	if n, _ := result.RowsAffected(); n > 0 {
		log.Printf("EnsureConfidentialRolePermissions: reconciled restricted grants for %s", confidentialUser)
	}
	return nil
}
