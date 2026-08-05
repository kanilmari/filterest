// child_tab_config.go
// Admin API handlers for managing reverse-FK tab ordering and visibility per parent table.
// Bridges system_child_tab_config rows and the admin tab-configuration UI.
// Exists to let admins reorder and toggle referring-record tabs via GET/POST endpoints.
//
// Note: the persisted/internal "child tab" naming is legacy compatibility
// vocabulary for the route, system table, and helper functions. User-facing
// copy may prefer "referring tabs" unless the relation is a true same-table
// parent/child hierarchy.
package system_table_tools

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

type childTabConfigRow struct {
	ID          int    `json:"id"`
	ParentTable string `json:"parent_table"`
	TabKey      string `json:"tab_key"`
	TabOrder    int    `json:"tab_order"`
	Hidden      bool   `json:"hidden"`
}

// GetChildTabConfigHandler returns all legacy-named child-tab config rows for a parent table.
// GET /api/child-tab-config/{parentTable}
func GetChildTabConfigHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	parentTable := strings.TrimPrefix(r.URL.Path, "/api/child-tab-config/")
	if parentTable == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "parent table name is required")
		return
	}

	rows, err := backend.Db.Query(`
		SELECT id, parent_table, tab_key, tab_order, hidden
		FROM system_child_tab_config
		WHERE parent_table = $1
		ORDER BY tab_order, tab_key
	`, parentTable)
	if err != nil {
		log.Printf("\033[31merror: [GetChildTabConfig] query failed for %q: %v\033[0m", parentTable, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching child tab config")
		return
	}
	defer rows.Close()

	configs := []childTabConfigRow{}
	for rows.Next() {
		var c childTabConfigRow
		if err := rows.Scan(&c.ID, &c.ParentTable, &c.TabKey, &c.TabOrder, &c.Hidden); err != nil {
			log.Printf("\033[31merror: [GetChildTabConfig] scan failed: %v\033[0m", err)
			continue
		}
		configs = append(configs, c)
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, configs)
}

type saveChildTabConfigRequest struct {
	ParentTable string              `json:"parent_table"`
	Tabs        []childTabConfigRow `json:"tabs"`
}

// SaveChildTabConfigHandler bulk-upserts the legacy-named child-tab config rows for a parent table.
// POST /api/child-tab-config/save
func SaveChildTabConfigHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req saveChildTabConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.ParentTable == "" || len(req.Tabs) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "parent_table and tabs are required")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		log.Printf("\033[31merror: [SaveChildTabConfig] failed to acquire transaction\033[0m")
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}

	for _, tab := range req.Tabs {
		_, err := tx.Exec(`
			INSERT INTO system_child_tab_config (parent_table, tab_key, tab_order, hidden)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (parent_table, tab_key)
			DO UPDATE SET tab_order = $3, hidden = $4
		`, req.ParentTable, tab.TabKey, tab.TabOrder, tab.Hidden)
		if err != nil {
			log.Printf("\033[31merror: [SaveChildTabConfig] upsert for %q/%q: %v\033[0m", req.ParentTable, tab.TabKey, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error saving child tab config")
			return
		}
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"message": "Child tab config saved",
	})
}
