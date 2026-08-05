// filterbar_section_layout.go
// Admin API handlers for the compact filterbar section layout stored in system_config.
// Bridges the draggable filterbar section UI and DB-backed application configuration.
// Exists so admins can reorder filterbar sections without adding a table-shaped route.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

const filterbarSectionLayoutConfigKey = "filterbar_section_layout"

const filterbarSectionLayoutUpsertSQL = `
	INSERT INTO system_config (key, json_value, creation_spec)
	VALUES (
		$1,
		$2::jsonb,
		'Global admin-managed compact filterbar section order and collapsed state.'
	)
	ON CONFLICT (key) DO UPDATE
	SET json_value = EXCLUDED.json_value,
	    creation_spec = COALESCE(NULLIF(system_config.creation_spec, ''), EXCLUDED.creation_spec),
	    updated = NOW()
`

var defaultFilterbarSectionOrder = []string{
	"filters",
	"search_overview",
	"search_controls",
	"tools",
	"views",
	"field_sets",
	"chat",
}

var allowedFilterbarSectionKeys = map[string]bool{
	"filters":         true,
	"search_overview": true,
	"search_controls": true,
	"tools":           true,
	"views":           true,
	"field_sets":      true,
	"chat":            true,
}

var legacyFilterbarSectionOrder = []string{
	"search_controls",
	"tools",
	"views",
	"field_sets",
	"filters",
	"chat",
}

type filterbarSectionLayoutConfig struct {
	SectionOrder     []string        `json:"section_order"`
	SectionCollapsed map[string]bool `json:"section_collapsed,omitempty"`
}

// GetFilterbarSectionLayoutHandler returns the global admin-managed compact filterbar section layout.
// GET /api/filterbar-section-layout
func GetFilterbarSectionLayoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	config, err := readFilterbarSectionLayout()
	if err != nil {
		log.Printf("\033[31merror: [GetFilterbarSectionLayoutHandler] read failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error reading filterbar section layout")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, config)
}

// SaveFilterbarSectionLayoutHandler stores the global admin-managed compact filterbar section layout.
// POST /api/filterbar-section-layout/save
func SaveFilterbarSectionLayoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req filterbarSectionLayoutConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	config := filterbarSectionLayoutConfig{
		SectionOrder:     normalizeFilterbarSectionOrder(req.SectionOrder),
		SectionCollapsed: normalizeFilterbarSectionCollapsed(req.SectionCollapsed),
	}
	configJSON, err := json.Marshal(config)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to encode filterbar section layout")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		log.Printf("\033[31merror: [SaveFilterbarSectionLayoutHandler] failed to acquire transaction\033[0m")
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}

	// value_type is optional metadata. The public Filterest runtime intentionally
	// carries system_config without the private value-type catalog, so saving this
	// JSON setting must not depend on that catalog being installed.
	_, err = tx.Exec(filterbarSectionLayoutUpsertSQL, filterbarSectionLayoutConfigKey, string(configJSON))
	if err != nil {
		log.Printf("\033[31merror: [SaveFilterbarSectionLayoutHandler] upsert failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to save filterbar section layout")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, config)
}

func readFilterbarSectionLayout() (filterbarSectionLayoutConfig, error) {
	var raw []byte
	err := backend.Db.QueryRow(`
		SELECT json_value
		FROM system_config
		WHERE key = $1
	`, filterbarSectionLayoutConfigKey).Scan(&raw)
	if err != nil {
		if err == sql.ErrNoRows {
			return filterbarSectionLayoutConfig{
				SectionOrder:     normalizeFilterbarSectionOrder(nil),
				SectionCollapsed: normalizeFilterbarSectionCollapsed(nil),
			}, nil
		}
		return filterbarSectionLayoutConfig{}, err
	}

	var config filterbarSectionLayoutConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &config); err != nil {
			return filterbarSectionLayoutConfig{}, err
		}
	}
	config.SectionOrder = normalizeFilterbarSectionOrder(config.SectionOrder)
	config.SectionCollapsed = normalizeFilterbarSectionCollapsed(config.SectionCollapsed)
	return config, nil
}

func normalizeFilterbarSectionOrder(input []string) []string {
	if filterbarSectionOrderEquals(input, legacyFilterbarSectionOrder) {
		return append([]string{}, defaultFilterbarSectionOrder...)
	}

	seen := map[string]bool{}
	normalized := make([]string, 0, len(defaultFilterbarSectionOrder))

	for _, key := range input {
		if !allowedFilterbarSectionKeys[key] || seen[key] {
			continue
		}
		seen[key] = true
		normalized = append(normalized, key)
	}

	for _, key := range defaultFilterbarSectionOrder {
		if seen[key] {
			continue
		}
		normalized = append(normalized, key)
	}

	return normalized
}

func normalizeFilterbarSectionCollapsed(input map[string]bool) map[string]bool {
	normalized := map[string]bool{}
	for _, key := range defaultFilterbarSectionOrder {
		if input[key] {
			normalized[key] = true
		}
	}
	return normalized
}

func filterbarSectionOrderEquals(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i, key := range left {
		if key != right[i] {
			return false
		}
	}
	return true
}
