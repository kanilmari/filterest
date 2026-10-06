// privilege_deletions.go
// Implements existing privilege-view deletion and the runtime policy boundary.
// Connects administrator view requests to validated, quoted REVOKE statements.
// Keeps application-managed runtime roles under the shared grant policy.
package dtt_1_row_delete

import (
	"database/sql"
	"easelect/backend/core_components/runtime_grant_mutations"
	"fmt"
	"github.com/lib/pq"
	"strings"
)

// canonicalizeRevokePrivilege converts one privilege emitted by PostgreSQL's
// information_schema column/table privilege views to its SQL keyword. The
// closed allowlist prevents request or view data from introducing extra tokens
// or statements into a REVOKE command.
func canonicalizeRevokePrivilege(rawPrivilege string, scope revokePrivilegeScope) (string, error) {
	privilegeTokens := strings.Fields(rawPrivilege)
	if len(privilegeTokens) != 1 {
		return "", fmt.Errorf("invalid %s privilege %q", scope, rawPrivilege)
	}

	canonicalPrivilege := strings.ToUpper(privilegeTokens[0])
	switch scope {
	case revokeColumnPrivilegeScope:
		switch canonicalPrivilege {
		case "SELECT", "INSERT", "UPDATE", "REFERENCES":
			return canonicalPrivilege, nil
		}
	case revokeTablePrivilegeScope:
		switch canonicalPrivilege {
		case "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER":
			return canonicalPrivilege, nil
		}
	default:
		return "", fmt.Errorf("invalid privilege scope %q", scope)
	}

	return "", fmt.Errorf("unsupported %s privilege %q", scope, rawPrivilege)
}

// revokeColumnPrivileges revokes column-level privileges by ID or by row data.
func revokeColumnPrivileges(tx *sql.Tx, ids []int, rows []map[string]string) error {
	if len(ids) > 0 {
		for _, oneID := range ids {
			var roleName, tableSchema, tableName, columnName, privilege string
			err := tx.QueryRow(
				"SELECT role_name, table_schema, table_name, column_name, privilege FROM systemview_role_column_privileges WHERE id = $1",
				oneID,
			).Scan(&roleName, &tableSchema, &tableName, &columnName, &privilege)
			if err != nil {
				return fmt.Errorf("error fetching row: %w", err)
			}
			canonicalPrivilege, err := canonicalizeRevokePrivilege(privilege, revokeColumnPrivilegeScope)
			if err != nil {
				return err
			}

			revokeStmt := fmt.Sprintf(
				"REVOKE %s (%s) ON %s.%s FROM %s",
				canonicalPrivilege,
				pq.QuoteIdentifier(columnName),
				pq.QuoteIdentifier(tableSchema),
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(roleName),
			)
			if _, err := tx.Exec(revokeStmt); err != nil {
				return fmt.Errorf("error revoking privilege: %w", err)
			}
		}
	} else {
		for _, row := range rows {
			canonicalPrivilege, err := canonicalizeRevokePrivilege(row["privilege"], revokeColumnPrivilegeScope)
			if err != nil {
				return err
			}
			revokeStmt := fmt.Sprintf(
				"REVOKE %s (%s) ON %s.%s FROM %s",
				canonicalPrivilege,
				pq.QuoteIdentifier(row["column_name"]),
				pq.QuoteIdentifier(row["table_schema"]),
				pq.QuoteIdentifier(row["table_name"]),
				pq.QuoteIdentifier(row["role_name"]),
			)
			if _, err := tx.Exec(revokeStmt); err != nil {
				return fmt.Errorf("error revoking privilege: %w", err)
			}
		}
	}
	return nil
}

// revokeTablePrivileges revokes table-level privileges by ID or by row data.
func revokeTablePrivileges(tx *sql.Tx, ids []int, rows []map[string]string) error {
	if len(ids) > 0 {
		for _, oneID := range ids {
			var roleName, tableSchema, tableName, privilege string
			err := tx.QueryRow(
				"SELECT role_name, table_schema, table_name, privilege FROM systemview_role_table_privileges WHERE id = $1",
				oneID,
			).Scan(&roleName, &tableSchema, &tableName, &privilege)
			if err != nil {
				return fmt.Errorf("error fetching row: %w", err)
			}
			canonicalPrivilege, err := canonicalizeRevokePrivilege(privilege, revokeTablePrivilegeScope)
			if err != nil {
				return err
			}

			revokeStmt := fmt.Sprintf(
				"REVOKE %s ON %s.%s FROM %s",
				canonicalPrivilege,
				pq.QuoteIdentifier(tableSchema),
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(roleName),
			)
			if _, err := tx.Exec(revokeStmt); err != nil {
				return fmt.Errorf("error revoking privilege: %w", err)
			}
		}
	} else {
		for _, row := range rows {
			canonicalPrivilege, err := canonicalizeRevokePrivilege(row["privilege"], revokeTablePrivilegeScope)
			if err != nil {
				return err
			}
			revokeStmt := fmt.Sprintf(
				"REVOKE %s ON %s.%s FROM %s",
				canonicalPrivilege,
				pq.QuoteIdentifier(row["table_schema"]),
				pq.QuoteIdentifier(row["table_name"]),
				pq.QuoteIdentifier(row["role_name"]),
			)
			if _, err := tx.Exec(revokeStmt); err != nil {
				return fmt.Errorf("error revoking privilege: %w", err)
			}
		}
	}
	return nil
}

// Resolve the whole requested batch before the first REVOKE. The application
// policy is the only editor for configured runtime roles, including read-only
// and confidential contracts; unrelated role deletion keeps its existing path.
func refuseManagedPrivilegeDeletion(tx *sql.Tx, table string, ids []int, rows []map[string]string) error {
	if table != "systemview_role_column_privileges" && table != "systemview_role_table_privileges" {
		return nil
	}
	for _, id := range ids {
		var role string
		if err := tx.QueryRow("SELECT role_name FROM "+pq.QuoteIdentifier(table)+" WHERE id=$1", id).Scan(&role); err != nil {
			return err
		}
		if err := runtime_grant_mutations.RefuseManagedPrivilegeRole(role); err != nil {
			return err
		}
	}
	for _, row := range rows {
		if err := runtime_grant_mutations.RefuseManagedPrivilegeRole(row["role_name"]); err != nil {
			return err
		}
	}
	return nil
}
