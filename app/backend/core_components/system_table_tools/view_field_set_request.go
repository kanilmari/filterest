// view_field_set_request.go
// Validates field-set identities, dataset/view targets, and client-visible column names.
// Bridges session identity and untrusted request values with registered database metadata.
// Exists so read and mutation handlers share one fail-closed target contract.
package system_table_tools

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"
	e_sessions "easelect/backend/core_components/sessions"
)

func authenticatedViewFieldSetUserID(r *http.Request) (int, error) {
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 1 {
		return 0, fmt.Errorf("authenticated user required")
	}
	return userID, nil
}

func readableViewFieldSetUserID(r *http.Request) (int, error) {
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID < 1 {
		return 0, fmt.Errorf("active user session required")
	}
	return userID, nil
}

func validateViewFieldSetTarget(rawDataset, rawViewKey string) (string, string, error) {
	dataset, err := security.SanitizeIdentifier(strings.TrimSpace(rawDataset))
	if err != nil {
		return "", "", fmt.Errorf("invalid dataset")
	}
	viewKey := strings.ToLower(strings.TrimSpace(rawViewKey))
	if !stableViewKeyPattern.MatchString(viewKey) {
		return "", "", fmt.Errorf("invalid view_key")
	}
	return dataset, viewKey, nil
}

func resolveViewFieldSetTarget(q dbutils.Querier, dataset, viewKey string) (int, int, error) {
	var tableUID, viewID int
	err := q.QueryRow(`
		SELECT tables.table_uid, views.id
		FROM public.system_db_tables AS tables
		CROSS JOIN public.system_table_views AS views
		WHERE tables.table_name = $1
		  AND COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
		  AND views.view_key = $2
		LIMIT 1`, dataset, viewKey).Scan(&tableUID, &viewID)
	return tableUID, viewID, err
}

func respondViewFieldSetLookupError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		httpresponse.RespondWithError(w, http.StatusNotFound, "dataset or view not found")
		return
	}
	httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset/view lookup failed")
}

func normalizeVisibleColumnNames(columns []string) ([]string, error) {
	seen := make(map[string]bool, len(columns))
	result := make([]string, 0, len(columns))
	for _, raw := range columns {
		column, err := security.SanitizeIdentifier(strings.TrimSpace(raw))
		if err != nil {
			return nil, fmt.Errorf("invalid visible column")
		}
		if !seen[column] {
			seen[column] = true
			result = append(result, column)
		}
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("at least one visible column is required")
	}
	return result, nil
}

func resolveVisibleColumnUIDs(q dbutils.Querier, tableUID int, columns []string) ([]int, error) {
	columnUIDs := make([]int, 0, len(columns))
	for _, column := range columns {
		var columnUID int
		err := q.QueryRow(`
			SELECT column_uid
			FROM public.system_column_details
			WHERE table_uid = $1 AND column_name = $2
			  AND COALESCE(hide_everywhere, false) = false
			  AND COALESCE(client_delivery_mode, 'include') = 'include'`, tableUID, column).Scan(&columnUID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("visible column is unavailable")
		}
		if err != nil {
			return nil, fmt.Errorf("visible column validation failed")
		}
		columnUIDs = append(columnUIDs, columnUID)
	}
	return columnUIDs, nil
}
