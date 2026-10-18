// filterbar_section_layout.go
// Public safe reads and permission-checked writes for the shared filterbar layout.
// Bridges the draggable filterbar section UI and DB-backed application configuration.
// Lets signed-in route grantees edit shared settings without a table-shaped route.
package system_table_tools

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
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
	"style",
	"chat",
}

var allowedFilterbarSectionKeys = map[string]bool{
	"filters":         true,
	"search_overview": true,
	"search_controls": true,
	"tools":           true,
	"views":           true,
	"field_sets":      true,
	"style":           true,
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
	SectionCollapsed map[string]bool `json:"section_collapsed"`
	AllowOwnOrder    bool            `json:"allow_own_order"`
}

// Only these UI fields leave the public endpoint, even if the stored object
// contains unrelated or legacy configuration. Reading never requires edit rights.
var filterbarLayoutReader = readFilterbarSectionLayout

type saveFilterbarLayoutRequest struct {
	SectionOrder     []string         `json:"section_order,omitempty"`
	SectionCollapsed map[string]*bool `json:"section_collapsed,omitempty"`
	AllowOwnOrder    *bool            `json:"allow_own_order,omitempty"`
}

// GetFilterbarSectionLayoutHandler returns only safe shared UI settings for every role.
// GET /api/filterbar-section-layout
func GetFilterbarSectionLayoutHandler(w http.ResponseWriter, r *http.Request) {

	w.Header().Set("Cache-Control", "no-store")
	config, err := filterbarLayoutReader()
	if err != nil {
		log.Printf("\033[31merror: [GetFilterbarSectionLayoutHandler] read failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error reading filterbar section layout")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, config)
}

// SaveFilterbarSectionLayoutHandler patches the shared layout for signed-in route grantees.
// Optional section_order, section_collapsed deltas (null removes a default), and
// allow_own_order preserve all omitted fields, including other datasets' defaults.
// Access control enforces the route grant; this handler refuses guests before any write.
// POST /api/filterbar-section-layout/save
func SaveFilterbarSectionLayoutHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 1 {
		httpresponse.RespondWithError(w, http.StatusForbidden, "authenticated user required")
		return
	}

	var req saveFilterbarLayoutRequest
	if err := decodeFilterbarRequest(w, r, &req); err != nil || !validFilterbarLayoutRequest(req) {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}
	// Serialize partial edits, preserving the collapse defaults and site policy
	// when another bar changes only its order. No old dataset snapshot is written.
	if _, err := tx.ExecContext(r.Context(), `SELECT pg_advisory_xact_lock(770077)`); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "layout lock failed")
		return
	}
	config, err := readFilterbarLayoutFrom(dbutils.BindQueryContext(r.Context(), tx))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "layout unavailable")
		return
	}
	if req.SectionOrder != nil {
		config.SectionOrder = normalizeFilterbarSectionOrder(req.SectionOrder)
	}
	for key, value := range req.SectionCollapsed {
		if value == nil {
			delete(config.SectionCollapsed, key)
		} else {
			config.SectionCollapsed[key] = *value
		}
	}
	if req.AllowOwnOrder != nil {
		config.AllowOwnOrder = *req.AllowOwnOrder
	}
	configJSON, err := json.Marshal(config)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to encode filterbar section layout")
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
	return readFilterbarLayoutFrom(backend.Db)
}

func readFilterbarLayoutFrom(q interface {
	QueryRow(string, ...interface{}) *sql.Row
}) (filterbarSectionLayoutConfig, error) {
	var raw []byte
	err := q.QueryRow(`
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

func decodeFilterbarRequest(w http.ResponseWriter, r *http.Request, target interface{}) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		return err
	}
	if len(raw) == 0 || raw[0] != '{' {
		return errors.New("JSON object required")
	}
	if err := decoder.Decode(new(interface{})); !errors.Is(err, io.EOF) {
		return errors.New("one JSON object required")
	}
	fields := json.NewDecoder(bytes.NewReader(raw))
	fields.DisallowUnknownFields()
	return fields.Decode(target)
}

func validFilterbarLayoutRequest(req saveFilterbarLayoutRequest) bool {
	if req.SectionOrder != nil && !validFilterbarOrder(req.SectionOrder) {
		return false
	}
	for key := range req.SectionCollapsed {
		if !allowedFilterbarSectionKeys[key] {
			return false
		}
	}
	return true
}

func validFilterbarOrder(order []string) bool {
	if len(order) == 0 || len(order) > len(defaultFilterbarSectionOrder) {
		return false
	}
	seen := map[string]bool{}
	for _, key := range order {
		if !allowedFilterbarSectionKeys[key] || seen[key] {
			return false
		}
		seen[key] = true
	}
	return true
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
		if value, exists := input[key]; exists {
			normalized[key] = value
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
