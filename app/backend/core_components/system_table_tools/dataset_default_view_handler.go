// dataset_default_view_handler.go
// Reads and changes only one dataset's saved default presentation.
// Connects the administrator filterbar control with registered views and dataset metadata.
// Keeps default selection separate from permissions and runtime database grants.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/permissions"
	"easelect/backend/core_components/runtimepaths"
	"easelect/backend/core_components/security"
)

type datasetDefaultViewResponse struct {
	Dataset         string   `json:"dataset"`
	DefaultViewID   *int     `json:"default_view_id"`
	DefaultViewName *string  `json:"default_view_name"`
	OfferedViews    []string `json:"offered_views"`
}

// decodeDefaultViewRequest distinguishes an omitted view from an explicit clear.
func decodeDefaultViewRequest(reader io.Reader) (string, *string, error) {
	var input struct {
		Dataset string          `json:"dataset"`
		View    json.RawMessage `json:"view_key"`
	}
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return "", nil, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return "", nil, errors.New("one JSON object required")
	}
	if len(input.View) == 0 {
		return "", nil, errors.New("view_key is required; use null to clear")
	}
	var view *string
	if err := json.Unmarshal(input.View, &view); err != nil {
		return "", nil, err
	}
	if view != nil && strings.TrimSpace(*view) == "" {
		return "", nil, errors.New("view_key must not be empty")
	}
	return input.Dataset, view, nil
}

// DatasetDefaultViewHandler serves GET and POST under the administrator pipeline.
// It also checks the administrator flag itself, so a route grant alone never authorizes a save.
func DatasetDefaultViewHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	userID, err := authenticatedViewFieldSetUserID(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "administrator required")
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction unavailable")
		return
	}
	// The middleware owns commit/rollback, using the original request context.
	// Bind every query (including legacy metadata/permission helpers) so a client
	// disconnect interrupts an in-flight query before database/sql rolls back.
	q := dbutils.BindQueryContext(r.Context(), tx)
	// Bound contention even while the client remains connected. These settings
	// are transaction-local and cannot leak into the pooled connection.
	if _, err = q.Exec(`SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '10s'`); err != nil {
		respondDefaultViewError(w, err)
		return
	}
	var admin bool
	err = q.QueryRow(`SELECT COALESCE(admin_access_allowed,false) FROM public.system_users WHERE id=$1`, userID).Scan(&admin)
	if err != nil {
		respondDefaultViewError(w, err)
		return
	}
	if !admin {
		httpresponse.RespondWithError(w, http.StatusForbidden, "administrator required")
		return
	}
	rawDataset := r.URL.Query().Get("dataset")
	var view *string
	if r.Method == http.MethodPost {
		rawDataset, view, err = decodeDefaultViewRequest(http.MaxBytesReader(w, r.Body, 4096))
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid default view request")
			return
		}
	}
	dataset, err := security.SanitizeIdentifier(strings.TrimSpace(rawDataset))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid dataset")
		return
	}
	var tableUID int
	query := `SELECT table_uid FROM public.system_db_tables WHERE table_name=$1
	 AND COALESCE(NULLIF(schema_name,''),'public')='public'`
	if r.Method == http.MethodPost {
		query += " FOR UPDATE"
	}
	if err = q.QueryRow(query, dataset).Scan(&tableUID); err != nil {
		respondDefaultViewError(w, err)
		return
	}
	response, ids, err := readDatasetDefaultView(q, dataset, tableUID, userID)
	if err != nil {
		respondDefaultViewError(w, err)
		return
	}
	if r.Method == http.MethodPost {
		var id any
		if view != nil {
			viewID, offered := ids[*view]
			if !offered {
				httpresponse.RespondWithError(w, http.StatusBadRequest, "view is not offered for this dataset")
				return
			}
			id = viewID
		}
		// Results retain table metadata in their schema cache. Invalidate only
		// after commit so another administrator immediately sees the new default.
		if !dbutils.RegisterAfterCommitHook(r.Context(), func() { read.InvalidateSchemaCache(dataset) }) {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction completion unavailable")
			return
		}
		// No generic metadata writer, grant reconciliation or other field update belongs here.
		if _, err = q.Exec(`UPDATE public.system_db_tables SET default_view_id=$1 WHERE table_uid=$2`, id, tableUID); err != nil {
			respondDefaultViewError(w, err)
			return
		}
		// Read the database's value, including SQL NULL, rather than echoing the request.
		response, _, err = readDatasetDefaultView(q, dataset, tableUID, userID)
		if err != nil {
			respondDefaultViewError(w, err)
			return
		}
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, response)
}

func respondDefaultViewError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
		return
	}
	httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset default view unavailable")
}

func readDatasetDefaultView(q dbutils.Querier, dataset string, tableUID, userID int) (datasetDefaultViewResponse, map[string]int, error) {
	result := datasetDefaultViewResponse{Dataset: dataset, OfferedViews: []string{}}
	err := q.QueryRow(`SELECT tables.default_view_id, views.name FROM public.system_db_tables tables
	 LEFT JOIN public.system_table_views views ON views.id=tables.default_view_id WHERE tables.table_uid=$1`, tableUID).
		Scan(&result.DefaultViewID, &result.DefaultViewName)
	if err != nil {
		return result, nil, err
	}
	shape, err := readDefaultViewDatasetShape(q, dataset, tableUID)
	if err != nil {
		return result, nil, err
	}
	views, err := q.Query(`SELECT id, COALESCE(name,''), COALESCE(NULLIF(view_key,''),name,'') FROM public.system_table_views ORDER BY id`)
	if err != nil {
		return result, nil, err
	}
	type candidate struct {
		id        int
		name, key string
	}
	var candidates []candidate
	for views.Next() {
		var item candidate
		if err = views.Scan(&item.id, &item.name, &item.key); err != nil {
			views.Close()
			return result, nil, err
		}
		candidates = append(candidates, item)
	}
	err = views.Err()
	views.Close()
	if err != nil {
		return result, nil, err
	}
	routes := []string{"/ui/view/price_chart"}
	for _, item := range candidates {
		if route := defaultViewPermissionRoute(item.key); route != "" {
			routes = append(routes, route)
		}
	}
	rights, err := permissions.QueryAllowedRoutes(q, routes, userID, permissions.RouteTableScope{}, permissions.StrictRouteTableOptions())
	if err != nil {
		return result, nil, err
	}
	effectiveDefault := defaultViewPermissionFallback(result.DefaultViewName,
		readSiteDefaultView(runtimepaths.Current().ApplicationRoot), rights["/ui/view/price_chart"])
	ids := map[string]int{}
	for _, item := range candidates {
		// get_results_metadata joins on name, so an unrelated display name is not a usable default.
		if item.name != item.key || !shape.offers(item.key) {
			continue
		}
		route := defaultViewPermissionRoute(item.key)
		if route != "" && !rights[route] && (item.key != effectiveDefault || item.key == "price_chart") {
			continue
		}
		ids[item.key] = item.id
		result.OfferedViews = append(result.OfferedViews, item.key)
	}
	return result, ids, nil
}
