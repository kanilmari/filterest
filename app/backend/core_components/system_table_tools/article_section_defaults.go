// article_section_defaults.go
// Reads and saves dataset-level initial disclosure states for article presentations.
// Connects the view-settings editor and article openers through a small typed API.
// Keeps user toggles transient and protects other presentations during concurrent edits.
package system_table_tools

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"

	"github.com/lib/pq"
)

type ArticleSectionDefaultsResponse struct {
	Dataset           string          `json:"dataset"`
	PresentationKey   string          `json:"presentation_key"`
	SupportedSections []string        `json:"supported_sections"`
	Overrides         map[string]bool `json:"overrides"`
	InitialOpen       map[string]bool `json:"initial_open"`
	CanEdit           bool            `json:"can_edit"`
}

type articleSectionDefaultsPatch struct {
	Dataset         string          `json:"dataset"`
	PresentationKey string          `json:"presentation_key"`
	InitialOpen     map[string]bool `json:"initial_open"`
	ResetToDefaults bool            `json:"reset_to_defaults"`
}

func articleSupportedSections(presentation string) []string {
	switch presentation {
	case "classic":
		return []string{"details", "images", "attachments", "related_rows", "task_progress"}
	case "image_first":
		return []string{"details"}
	default:
		return nil
	}
}

func validateArticleSectionTarget(dataset, presentation string) (string, error) {
	clean, err := security.SanitizeIdentifier(strings.TrimSpace(dataset))
	if err != nil || len(articleSupportedSections(presentation)) == 0 {
		return "", errors.New("valid dataset and classic or image_first presentation_key required")
	}
	return clean, nil
}

func decodeArticleSectionValues(raw json.RawMessage, presentation string) (map[string]bool, error) {
	var values map[string]json.RawMessage
	if err := json.Unmarshal(raw, &values); err != nil || values == nil {
		return nil, errors.New("initial_open must be an object")
	}
	supported := articleSupportedSections(presentation)
	result := make(map[string]bool, len(values))
	for key, value := range values {
		allowed := false
		for _, section := range supported {
			if key == section {
				allowed = true
				break
			}
		}
		value = bytes.TrimSpace(value)
		if !allowed || (!bytes.Equal(value, []byte("true")) && !bytes.Equal(value, []byte("false"))) {
			return nil, fmt.Errorf("unsupported section or nonboolean initial state: %s", key)
		}
		result[key] = bytes.Equal(value, []byte("true"))
	}
	return result, nil
}

func decodeArticleSectionPatch(reader io.Reader) (articleSectionDefaultsPatch, error) {
	var result articleSectionDefaultsPatch
	decoder := json.NewDecoder(io.LimitReader(reader, 65537))
	var fields map[string]json.RawMessage
	if err := decoder.Decode(&fields); err != nil || fields == nil {
		return result, errors.New("JSON object required")
	}
	var extra interface{}
	if err := decoder.Decode(&extra); err != io.EOF {
		return result, errors.New("one JSON object required")
	}
	for key := range fields {
		switch key {
		case "dataset", "presentation_key", "initial_open", "reset_to_defaults":
		default:
			return result, fmt.Errorf("unknown setting: %s", key)
		}
	}
	if err := json.Unmarshal(fields["dataset"], &result.Dataset); err != nil {
		return result, errors.New("dataset required")
	}
	if err := json.Unmarshal(fields["presentation_key"], &result.PresentationKey); err != nil {
		return result, errors.New("presentation_key required")
	}
	dataset, err := validateArticleSectionTarget(result.Dataset, result.PresentationKey)
	if err != nil {
		return result, err
	}
	result.Dataset = dataset
	values, hasValues := fields["initial_open"]
	reset, hasReset := fields["reset_to_defaults"]
	if hasValues == hasReset {
		return result, errors.New("provide initial_open patch or reset_to_defaults true")
	}
	if hasReset {
		if !bytes.Equal(bytes.TrimSpace(reset), []byte("true")) {
			return result, errors.New("reset_to_defaults must be true")
		}
		result.ResetToDefaults = true
		return result, nil
	}
	result.InitialOpen, err = decodeArticleSectionValues(values, result.PresentationKey)
	if err != nil {
		return result, err
	}
	if len(result.InitialOpen) == 0 {
		return result, errors.New("initial_open patch must not be empty")
	}
	return result, nil
}

func decodeStoredArticleSectionDefaults(raw []byte) (map[string]map[string]bool, error) {
	var presentations map[string]json.RawMessage
	if err := json.Unmarshal(raw, &presentations); err != nil || presentations == nil {
		return nil, errors.New("stored article defaults must be an object")
	}
	result := make(map[string]map[string]bool, len(presentations))
	for key, value := range presentations {
		if len(articleSupportedSections(key)) == 0 {
			return nil, errors.New("stored article presentation is unsupported")
		}
		sections, err := decodeArticleSectionValues(value, key)
		if err != nil {
			return nil, err
		}
		result[key] = sections
	}
	return result, nil
}

func articleSectionDefaultsResponse(dataset, presentation string, stored map[string]map[string]bool, canEdit bool) ArticleSectionDefaultsResponse {
	result := ArticleSectionDefaultsResponse{
		Dataset: dataset, PresentationKey: presentation, SupportedSections: articleSupportedSections(presentation),
		Overrides: map[string]bool{}, InitialOpen: map[string]bool{}, CanEdit: canEdit,
	}
	for _, section := range result.SupportedSections {
		result.InitialOpen[section] = true
		if value, exists := stored[presentation][section]; exists {
			result.Overrides[section] = value
			result.InitialOpen[section] = value
		}
	}
	return result
}

func lookupArticleSectionDataset(q dbutils.Querier, dataset string) (int, error) {
	var tableUID int
	err := q.QueryRow(`SELECT table_uid FROM public.system_db_tables
 WHERE table_name=$1 AND COALESCE(NULLIF(schema_name,''),'public')='public' LIMIT 1`, dataset).Scan(&tableUID)
	return tableUID, err
}

func readArticleSectionDefaults(q dbutils.Querier, tableUID int, lock bool) (map[string]map[string]bool, error) {
	query := "SELECT article_section_initial_open FROM public.system_db_tables WHERE table_uid=$1"
	if lock {
		query += " FOR UPDATE"
	}
	var raw []byte
	if err := q.QueryRow(query, tableUID).Scan(&raw); err != nil {
		return nil, err
	}
	return decodeStoredArticleSectionDefaults(raw)
}

// The request transaction owns the row lock and commit; failures leave all settings unchanged.
func persistArticleSectionDefaults(tx *sql.Tx, tableUID int, input articleSectionDefaultsPatch) (ArticleSectionDefaultsResponse, error) {
	stored, err := readArticleSectionDefaults(tx, tableUID, true)
	if err != nil {
		return ArticleSectionDefaultsResponse{}, err
	}
	if input.ResetToDefaults {
		delete(stored, input.PresentationKey)
	} else {
		if stored[input.PresentationKey] == nil {
			stored[input.PresentationKey] = map[string]bool{}
		}
		for section, value := range input.InitialOpen {
			stored[input.PresentationKey][section] = value
		}
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		return ArticleSectionDefaultsResponse{}, err
	}
	var saved []byte
	err = tx.QueryRow(`UPDATE public.system_db_tables SET article_section_initial_open=$1::jsonb
 WHERE table_uid=$2 RETURNING article_section_initial_open`, string(raw), tableUID).Scan(&saved)
	if err != nil {
		return ArticleSectionDefaultsResponse{}, err
	}
	stored, err = decodeStoredArticleSectionDefaults(saved)
	if err != nil {
		return ArticleSectionDefaultsResponse{}, err
	}
	return articleSectionDefaultsResponse(input.Dataset, input.PresentationKey, stored, true), nil
}

func respondArticleSectionDefaultsError(w http.ResponseWriter, err error) {
	var postgresError *pq.Error
	switch {
	case errors.Is(err, sql.ErrNoRows):
		httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
	case errors.As(err, &postgresError) && postgresError.Code == "42703":
		httpresponse.RespondWithError(w, http.StatusConflict, "article section defaults migration required")
	default:
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "article section defaults unavailable")
	}
}

// GetArticleSectionDefaultsHandler returns one presentation's effective initial states.
// GET /api/view-field-settings/article-section-defaults?dataset=...&presentation_key=...
func GetArticleSectionDefaultsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	presentation := r.URL.Query().Get("presentation_key")
	dataset, err := validateArticleSectionTarget(r.URL.Query().Get("dataset"), presentation)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	userID, err := readableViewFieldSetUserID(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, err.Error())
		return
	}
	tableUID, err := lookupArticleSectionDataset(backend.Db, dataset)
	if err != nil {
		respondArticleSectionDefaultsError(w, err)
		return
	}
	if err = authorizeViewFieldSetDatasetRead(tableUID, userID); err != nil {
		respondViewFieldSetAuthorizationError(w, err)
		return
	}
	canEdit, err := viewFieldSetUserIsAdmin(backend.Db, int64(userID))
	if err != nil {
		respondArticleSectionDefaultsError(w, err)
		return
	}
	stored, err := readArticleSectionDefaults(backend.Db, tableUID, false)
	if err != nil {
		respondArticleSectionDefaultsError(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, articleSectionDefaultsResponse(dataset, presentation, stored, canEdit))
}

// SaveArticleSectionDefaultsHandler patches or resets the administrator's site default.
// POST /api/admin/view-field-settings/article-section-defaults
func SaveArticleSectionDefaultsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	input, err := decodeArticleSectionPatch(r.Body)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	userID, err := authenticatedViewFieldSetUserID(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, err.Error())
		return
	}
	canEdit, err := viewFieldSetUserIsAdmin(backend.Db, int64(userID))
	if err != nil {
		respondArticleSectionDefaultsError(w, err)
		return
	}
	if !canEdit {
		httpresponse.RespondWithError(w, http.StatusForbidden, "administrator required")
		return
	}
	tableUID, err := lookupArticleSectionDataset(backend.Db, input.Dataset)
	if err != nil {
		respondArticleSectionDefaultsError(w, err)
		return
	}
	if err = authorizeViewFieldSetDatasetRead(tableUID, userID); err != nil {
		respondViewFieldSetAuthorizationError(w, err)
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}
	response, err := persistArticleSectionDefaults(tx, tableUID, input)
	if err != nil {
		respondArticleSectionDefaultsError(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, response)
}
