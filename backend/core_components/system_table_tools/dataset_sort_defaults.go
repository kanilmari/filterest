// dataset_sort_defaults.go
// Serves persistent dataset sorting defaults without coupling them to one view.
// Bridges the shared filterbar sort control with site-wide and administrator-specific settings.
// Exists so every presentation of a dataset starts from one consistent sort unless the URL overrides it.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/lib/pq"
)

const imagesFirstSortColumn = "__images_first"
const searchRelevanceSortColumn = "__search_relevance"

type datasetSortDefaultResponse struct {
	Dataset    string `json:"dataset"`
	Value      string `json:"value"`
	Scope      string `json:"scope"`
	Configured bool   `json:"configured"`
}

type saveDatasetSortDefaultRequest struct {
	Dataset string `json:"dataset"`
	Value   string `json:"value"`
	Scope   string `json:"scope"`
}

// GetDatasetSortDefaultHandler returns the current user's override when one exists,
// otherwise the site-wide default. Anonymous visitors receive only the site default.
func GetDatasetSortDefaultHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	dataset, err := security.SanitizeIdentifier(strings.TrimSpace(r.URL.Query().Get("dataset")))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid dataset")
		return
	}

	userID := -1
	if sessionUserID, sessionErr := e_sessions.GetUserIDFromSession(r); sessionErr == nil {
		userID = sessionUserID
	}

	var sortColumn, sortDirection, scope string
	err = backend.Db.QueryRow(`
		SELECT defaults.sort_column,
		       defaults.sort_direction,
		       CASE WHEN defaults.user_id IS NULL THEN 'site' ELSE 'user' END AS scope
		FROM public.system_dataset_sort_defaults AS defaults
		JOIN public.system_db_tables AS tables
		  ON tables.table_uid = defaults.table_uid
		WHERE tables.table_name = $1
		  AND COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
		  AND (defaults.user_id = $2 OR defaults.user_id IS NULL)
		ORDER BY (defaults.user_id IS NOT NULL) DESC
		LIMIT 1`, dataset, userID).Scan(&sortColumn, &sortDirection, &scope)
	if errors.Is(err, sql.ErrNoRows) || isMissingDatasetSortDefaultsTableError(err) {
		httpresponse.RespondWithJSON(w, http.StatusOK, datasetSortDefaultResponse{
			Dataset: dataset,
		})
		return
	}
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset sorting default unavailable")
		return
	}

	value := sortColumn + ":" + sortDirection
	if sortColumn == searchRelevanceSortColumn {
		value = ""
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, datasetSortDefaultResponse{
		Dataset:    dataset,
		Value:      value,
		Scope:      scope,
		Configured: true,
	})
}

// SaveDatasetSortDefaultHandler saves or clears one administrator's own default
// or the site-wide default. The route uses the admin pipeline profile.
func SaveDatasetSortDefaultHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var request saveDatasetSortDefaultRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}

	dataset, err := security.SanitizeIdentifier(strings.TrimSpace(request.Dataset))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid dataset")
		return
	}
	request.Scope = strings.ToLower(strings.TrimSpace(request.Scope))
	if request.Scope != "user" && request.Scope != "site" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "scope must be user or site")
		return
	}
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 1 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "authenticated administrator required")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction unavailable")
		return
	}

	var tableUID int
	if err := tx.QueryRow(`
		SELECT table_uid
		FROM public.system_db_tables
		WHERE table_name = $1
		  AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
		LIMIT 1`, dataset).Scan(&tableUID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset lookup failed")
		return
	}

	sortColumn, sortDirection, err := parseDatasetSortValue(request.Value)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	valid, err := isAllowedDatasetSortColumn(tx, tableUID, dataset, sortColumn)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset sorting validation failed")
		return
	}
	if !valid {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "sort option is not available for this dataset")
		return
	}

	var scopedUserID interface{}
	if request.Scope == "user" {
		scopedUserID = userID
	}

	if _, err := tx.Exec(`
		INSERT INTO public.system_dataset_sort_defaults (
			table_uid, user_id, sort_column, sort_direction
		)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (table_uid, user_id)
		DO UPDATE SET sort_column = EXCLUDED.sort_column,
		              sort_direction = EXCLUDED.sort_direction,
		              updated = now()`, tableUID, scopedUserID, sortColumn, sortDirection); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset sorting default save failed")
		return
	}

	value := sortColumn + ":" + sortDirection
	if sortColumn == searchRelevanceSortColumn {
		value = ""
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, datasetSortDefaultResponse{
		Dataset:    dataset,
		Value:      value,
		Scope:      request.Scope,
		Configured: true,
	})
}

func parseDatasetSortValue(rawValue string) (column string, direction string, err error) {
	value := strings.TrimSpace(rawValue)
	if value == "" {
		return searchRelevanceSortColumn, "ASC", nil
	}
	separator := strings.LastIndex(value, ":")
	if separator <= 0 || separator == len(value)-1 {
		return "", "", fmt.Errorf("invalid sort option")
	}
	column = strings.TrimSpace(value[:separator])
	direction = strings.ToUpper(strings.TrimSpace(value[separator+1:]))
	if column == "" || (direction != "ASC" && direction != "DESC") {
		return "", "", fmt.Errorf("invalid sort option")
	}
	return column, direction, nil
}

func isAllowedDatasetSortColumn(
	q dbutils.Querier,
	tableUID int,
	dataset string,
	column string,
) (bool, error) {
	if column == imagesFirstSortColumn || column == searchRelevanceSortColumn {
		return true, nil
	}
	var allowed bool
	err := q.QueryRow(`
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.columns AS columns
			LEFT JOIN public.system_column_details AS details
			  ON details.table_uid = $1
			 AND details.column_name = columns.column_name
			WHERE columns.table_schema = 'public'
			  AND columns.table_name = $2
			  AND columns.column_name = $3
			  AND (
			      columns.column_name IN ('created', 'updated')
			      OR details.sco_number IS NOT NULL
			  )
		)`, tableUID, dataset, column).Scan(&allowed)
	return allowed, err
}

func isMissingDatasetSortDefaultsTableError(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == "42P01"
}
