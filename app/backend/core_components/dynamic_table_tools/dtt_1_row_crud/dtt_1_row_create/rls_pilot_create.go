// rls_pilot_create.go
// Defines owner-safe create rules for the first app_service_catalog RLS write pilot.
// Bridges add-row metadata, payload validation, and session identity without widening global create semantics.
// Exists so app_service_catalog can add an INSERT pilot while keeping non-admin create fields narrow and auditable.
package dtt_1_row_create

import (
	"net/http"
	"strings"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	e_sessions "easelect/backend/core_components/sessions"
)

const createRLSPilotTableName = "app_service_catalog"

type forbiddenError struct{ msg string }

func (e *forbiddenError) Error() string { return e.msg }

var ownerSafePilotCreateColumns = map[string]struct{}{
	"header":                          {},
	"description":                     {},
	"website":                         {},
	"contact_details":                 {},
	"locality":                        {},
	"keywords_static":                 {},
	"type_of_operation":               {},
	"national_corporation_identifier": {},
}

// shouldEnforceOwnerSafePilotCreateRules returns whether the non-admin owner-safe create pilot applies.
func shouldEnforceOwnerSafePilotCreateRules(tableName, userRole string) bool {
	return tableName == createRLSPilotTableName && userRole != "admin"
}

// isOwnerSafePilotCreateColumn returns whether the column belongs to the narrow owner-safe create slice.
func isOwnerSafePilotCreateColumn(columnName string) bool {
	_, ok := ownerSafePilotCreateColumns[columnName]
	return ok
}

// filterPilotCreateColumns removes non-owner-safe create fields from the add-row metadata for the pilot table.
func filterPilotCreateColumns(tableName, userRole string, columns []dtt_models.AddRowColumnInfo) []dtt_models.AddRowColumnInfo {
	if !shouldEnforceOwnerSafePilotCreateRules(tableName, userRole) {
		return columns
	}

	filtered := make([]dtt_models.AddRowColumnInfo, 0, len(columns))
	for _, col := range columns {
		if isOwnerSafePilotCreateColumn(col.ColumnName) {
			filtered = append(filtered, col)
		}
	}
	return filtered
}

// applyPilotCreatePayload validates the non-admin pilot payload and binds ownership to the current session user.
func applyPilotCreatePayload(tableName, userRole string, payload map[string]interface{}, currentUserID int, currentUsername string) (map[string]interface{}, error) {
	if !shouldEnforceOwnerSafePilotCreateRules(tableName, userRole) {
		return payload, nil
	}

	filtered := make(map[string]interface{}, len(payload)+2)
	for columnName, value := range payload {
		if !isOwnerSafePilotCreateColumn(columnName) {
			return nil, &forbiddenError{msg: "column is not insertable by the current actor in the RLS create pilot"}
		}
		filtered[columnName] = value
	}

	filtered["user_id"] = currentUserID
	filtered["cached_username"] = currentUsername
	return filtered, nil
}

// getSessionUserRoleOrGuest returns the current session role or a guest fallback for metadata filtering.
func getSessionUserRoleOrGuest(request *http.Request) string {
	session, err := e_sessions.GetOrCreateSession(nil, request)
	if err != nil || session == nil {
		return "guest"
	}
	userRole, _ := session.Values["user_role"].(string)
	if strings.TrimSpace(userRole) == "" {
		return "guest"
	}
	return userRole
}
