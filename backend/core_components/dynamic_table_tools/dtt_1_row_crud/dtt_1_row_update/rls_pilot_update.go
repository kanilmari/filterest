// rls_pilot_update.go
// Enforces owner-safe update rules for the app_service_catalog RLS pilot.
// Bridges row update handlers, request actor roles, and column allowlist validation.
// Exists to keep non-admin updates constrained while the RLS pilot is being hardened.
package dtt_1_row_update

import (
	"database/sql"
	"fmt"
)

const updateRLSPilotTableName = "app_service_catalog"

type forbiddenError struct{ msg string }

func (e *forbiddenError) Error() string { return e.msg }

var ownerSafePilotUpdateColumns = map[string]struct{}{
	"header":                          {},
	"description":                     {},
	"website":                         {},
	"contact_details":                 {},
	"locality":                        {},
	"keywords_static":                 {},
	"type_of_operation":               {},
	"national_corporation_identifier": {},
	"published":                       {},
	"enabled":                         {},
}

func shouldEnforceOwnerSafePilotUpdateAllowlist(tableName, userRole string) bool {
	return tableName == updateRLSPilotTableName && userRole != "admin"
}

func isOwnerSafePilotUpdateColumn(columnName string) bool {
	_, ok := ownerSafePilotUpdateColumns[columnName]
	return ok
}

func enforcePilotUpdateColumn(tableName, userRole, columnName string) error {
	if !shouldEnforceOwnerSafePilotUpdateAllowlist(tableName, userRole) {
		return nil
	}
	if isOwnerSafePilotUpdateColumn(columnName) {
		return nil
	}
	return &forbiddenError{msg: "column is not editable by the current actor in the RLS update pilot"}
}

// enforcePilotUpdatedRows retains its historical name, but exact row-count
// verification now protects every generic update after the shared mutation
// visibility lock has admitted the target row.
func enforcePilotUpdatedRows(tableName string, result sql.Result) error {
	updatedRows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("error verifying updated rows for table %s: %w", tableName, err)
	}
	if updatedRows != 1 {
		return &forbiddenError{msg: "requested row was not updatable by the current actor or no longer exists"}
	}
	return nil
}
