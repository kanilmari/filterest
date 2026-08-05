// column_view_preset.go
// Admin API handlers for named column-view presets per table.
// Bridges the system_column_view_presets table and the admin column-configuration UI.
// Exists to let users save, load, and delete column visibility configurations.
package system_table_tools

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/lib/pq"
)

type columnViewPreset struct {
	ID            int             `json:"id"`
	TableName     string          `json:"table_name"`
	PresetName    string          `json:"preset_name"`
	HiddenColumns map[string]bool `json:"hidden_columns"`
	CreatedBy     *int            `json:"created_by,omitempty"`
	Created       string          `json:"created"`
}

// ListColumnViewPresetsHandler returns all presets for a given table.
// GET /api/column-view-presets/{tableName}
func ListColumnViewPresetsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	tableName := strings.TrimPrefix(r.URL.Path, "/api/column-view-presets/")
	if tableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "table name is required")
		return
	}

	rows, err := backend.Db.Query(`
		SELECT id, table_name, preset_name, hidden_columns, created_by, created
		FROM system_column_view_presets
		WHERE table_name = $1
		ORDER BY preset_name
	`, tableName)
	if err != nil {
		// Older generated Filterest databases predate this optional preset table.
		// Treat that compatibility gap as an empty preset list so opening the
		// column controls remains usable while the current bootstrap/migration
		// supplies the table for new and upgraded installations.
		if isMissingColumnViewPresetsTableError(err) {
			httpresponse.RespondWithJSON(w, http.StatusOK, []columnViewPreset{})
			return
		}
		log.Printf("\033[31merror: [ListColumnViewPresets] query: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to list presets")
		return
	}
	defer rows.Close()

	presets := []columnViewPreset{}
	for rows.Next() {
		var p columnViewPreset
		var hiddenJSON []byte
		if err := rows.Scan(&p.ID, &p.TableName, &p.PresetName, &hiddenJSON, &p.CreatedBy, &p.Created); err != nil {
			log.Printf("\033[31merror: [ListColumnViewPresets] scan: %v\033[0m", err)
			continue
		}
		if err := json.Unmarshal(hiddenJSON, &p.HiddenColumns); err != nil {
			p.HiddenColumns = map[string]bool{}
		}
		presets = append(presets, p)
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, presets)
}

func isMissingColumnViewPresetsTableError(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == "42P01"
}

type savePresetRequest struct {
	TableName     string          `json:"table_name"`
	PresetName    string          `json:"preset_name"`
	HiddenColumns map[string]bool `json:"hidden_columns"`
}

// SaveColumnViewPresetHandler creates or updates a named preset.
// POST /api/column-view-presets/save
func SaveColumnViewPresetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req savePresetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.TableName == "" || req.PresetName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "table_name and preset_name are required")
		return
	}

	hiddenJSON, err := json.Marshal(req.HiddenColumns)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to encode hidden columns")
		return
	}

	userID, _ := e_sessions.GetUserIDFromSession(r)

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		log.Printf("\033[31merror: [SaveColumnViewPreset] failed to acquire transaction\033[0m")
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}

	_, err = tx.Exec(`
		INSERT INTO system_column_view_presets (table_name, preset_name, hidden_columns, created_by)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (table_name, preset_name)
		DO UPDATE SET hidden_columns = $3
	`, req.TableName, req.PresetName, hiddenJSON, userID)
	if err != nil {
		log.Printf("\033[31merror: [SaveColumnViewPreset] upsert: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to save preset")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"message": "Preset saved",
	})
}

type deletePresetRequest struct {
	ID int `json:"id"`
}

// DeleteColumnViewPresetHandler removes a preset by ID.
// POST /api/column-view-presets/delete
func DeleteColumnViewPresetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req deletePresetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.ID == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "id is required")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		log.Printf("\033[31merror: [DeleteColumnViewPreset] failed to acquire transaction\033[0m")
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}

	_, err := tx.Exec(`DELETE FROM system_column_view_presets WHERE id = $1`, req.ID)
	if err != nil {
		log.Printf("\033[31merror: [DeleteColumnViewPreset] delete: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to delete preset")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"message": "Preset deleted",
	})
}
