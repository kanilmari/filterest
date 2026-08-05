// dataset_header_config.go
// Admin API handlers for managing dataset header copy overrides and the project hero banner.
// Bridges system_db_tables metadata, multipart logo uploads, and the admin editor workflow.
// Exists to keep dataset header configuration in one backend surface instead of generic CRUD routes.
package system_table_tools

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	filevalidation "easelect/backend/core_components/filevalidation"
	"easelect/backend/core_components/httpresponse"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var projectLogoExtensions = []string{".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"}

type datasetHeaderTextConfig struct {
	LangKey          string `json:"lang_key"`
	Fi               string `json:"fi"`
	En               string `json:"en"`
	Ch               string `json:"ch"`
	UsageExplanation string `json:"usage_explanation"`
}

type datasetHeaderConfigResponse struct {
	DatasetName       string                  `json:"dataset_name"`
	Title             datasetHeaderTextConfig `json:"title"`
	Slogan            datasetHeaderTextConfig `json:"slogan"`
	SearchPlaceholder datasetHeaderTextConfig `json:"search_placeholder"`
	ProjectLogoPath   string                  `json:"project_logo_path"`
}

// GetDatasetHeaderConfigHandler returns dataset header copy overrides for one dataset.
// GET /api/dataset-header-config/{datasetName}
func GetDatasetHeaderConfigHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	datasetName := strings.TrimPrefix(r.URL.Path, "/api/dataset-header-config/")
	if datasetName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset name is required")
		return
	}

	config, err := readDatasetHeaderConfig(datasetName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
			return
		}
		log.Printf("\033[31merror: [GetDatasetHeaderConfigHandler] read failed for %q: %v\033[0m", datasetName, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching dataset header config")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, config)
}

// SaveDatasetHeaderConfigHandler stores dataset header copy overrides and optionally replaces the shared project logo.
// POST /api/dataset-header-config/save
func SaveDatasetHeaderConfigHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	if err := r.ParseMultipartForm(20 << 20); err != nil {
		log.Printf("\033[31merror: [SaveDatasetHeaderConfigHandler] multipart parse failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "multipart parse error")
		return
	}

	datasetName := strings.TrimSpace(r.FormValue("dataset_name"))
	if datasetName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset_name is required")
		return
	}

	removeProjectBanner := strings.EqualFold(strings.TrimSpace(r.FormValue("remove_project_banner")), "true")

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		log.Printf("\033[31merror: [SaveDatasetHeaderConfigHandler] failed to acquire transaction\033[0m")
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}

	var datasetExists bool
	if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM system_db_tables WHERE table_name = $1)`, datasetName).Scan(&datasetExists); err != nil {
		log.Printf("\033[31merror: [SaveDatasetHeaderConfigHandler] dataset existence check failed for %q: %v\033[0m", datasetName, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error validating dataset")
		return
	}
	if !datasetExists {
		httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
		return
	}

	if err := saveDatasetHeaderLangKeyConfig(tx, datasetName, buildDatasetHeaderTextConfigs(r, datasetName)); err != nil {
		log.Printf("\033[31merror: [SaveDatasetHeaderConfigHandler] lang key update failed for %q: %v\033[0m", datasetName, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error saving dataset header translations")
		return
	}

	storageDir := resolveStorageDir()

	if removeProjectBanner {
		if err := removeExistingProjectLogoFiles(storageDir); err != nil {
			log.Printf("\033[31merror: [SaveDatasetHeaderConfigHandler] project logo removal failed: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error removing project banner")
			return
		}
	}

	if fileHeader, err := readOptionalMultipartFile(r, "project_banner_image"); err != nil {
		log.Printf("\033[31merror: [SaveDatasetHeaderConfigHandler] upload read failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	} else if fileHeader != nil {
		if err := saveProjectLogoFile(storageDir, fileHeader); err != nil {
			log.Printf("\033[31merror: [SaveDatasetHeaderConfigHandler] project logo save failed: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error saving project banner")
			return
		}
	}

	// NOTE: readDatasetHeaderConfig currently uses backend.Db, not this in-flight tx.
	// The response can therefore lag behind the just-written values until commit becomes visible.
	// Keep this caveat documented until readback is moved to the same transaction or post-commit path.
	config, err := readDatasetHeaderConfig(datasetName)
	if err != nil {
		log.Printf("\033[31merror: [SaveDatasetHeaderConfigHandler] read-after-write failed for %q: %v\033[0m", datasetName, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error reading saved dataset header config")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"message": "Dataset header config saved",
		"config":  config,
	})
}

func readDatasetHeaderConfig(datasetName string) (datasetHeaderConfigResponse, error) {
	config := datasetHeaderConfigResponse{DatasetName: datasetName}

	var exists bool
	if err := backend.Db.QueryRow(`SELECT EXISTS (SELECT 1 FROM system_db_tables WHERE table_name = $1)`, datasetName).Scan(&exists); err != nil {
		return datasetHeaderConfigResponse{}, err
	}
	if !exists {
		return datasetHeaderConfigResponse{}, sql.ErrNoRows
	}

	var err error
	langKeys := datasetHeaderLangKeys(datasetName)
	config.Title, err = readDatasetHeaderTextConfig(langKeys.Title, datasetName, "title")
	if err != nil {
		return datasetHeaderConfigResponse{}, err
	}
	config.Slogan, err = readDatasetHeaderTextConfig(langKeys.Slogan, datasetName, "slogan")
	if err != nil {
		return datasetHeaderConfigResponse{}, err
	}
	config.SearchPlaceholder, err = readDatasetHeaderTextConfig(langKeys.SearchPlaceholder, datasetName, "search_placeholder")
	if err != nil {
		return datasetHeaderConfigResponse{}, err
	}
	config.ProjectLogoPath = findProjectLogoPublicPath(resolveStorageDir())
	return config, nil
}

type datasetHeaderLangKeySet struct {
	Title             string
	Slogan            string
	SearchPlaceholder string
}

type datasetHeaderTextSaveRequest struct {
	FieldName        string
	LangKey          string
	Fi               string
	En               string
	Ch               string
	UsageExplanation string
}

func datasetHeaderLangKeys(datasetName string) datasetHeaderLangKeySet {
	return datasetHeaderLangKeySet{
		Title:             datasetName + "_front_page",
		Slogan:            "search_slogan_" + datasetName,
		SearchPlaceholder: "search_for_" + datasetName,
	}
}

func datasetHeaderSourceHigh(datasetName, fieldName string) string {
	return datasetName
}

func legacyDatasetHeaderSourceHigh(datasetName, fieldName string) string {
	return fmt.Sprintf("%s:%s", datasetName, fieldName)
}

func buildDatasetHeaderTextConfigs(r *http.Request, datasetName string) []datasetHeaderTextSaveRequest {
	langKeys := datasetHeaderLangKeys(datasetName)
	return []datasetHeaderTextSaveRequest{
		{
			FieldName:        "title",
			LangKey:          langKeys.Title,
			Fi:               strings.TrimSpace(r.FormValue("title_fi")),
			En:               strings.TrimSpace(r.FormValue("title_en")),
			Ch:               strings.TrimSpace(r.FormValue("title_ch")),
			UsageExplanation: strings.TrimSpace(r.FormValue("title_usage_explanation")),
		},
		{
			FieldName:        "slogan",
			LangKey:          langKeys.Slogan,
			Fi:               strings.TrimSpace(r.FormValue("slogan_fi")),
			En:               strings.TrimSpace(r.FormValue("slogan_en")),
			Ch:               strings.TrimSpace(r.FormValue("slogan_ch")),
			UsageExplanation: strings.TrimSpace(r.FormValue("slogan_usage_explanation")),
		},
		{
			FieldName:        "search_placeholder",
			LangKey:          langKeys.SearchPlaceholder,
			Fi:               strings.TrimSpace(r.FormValue("placeholder_fi")),
			En:               strings.TrimSpace(r.FormValue("placeholder_en")),
			Ch:               strings.TrimSpace(r.FormValue("placeholder_ch")),
			UsageExplanation: strings.TrimSpace(r.FormValue("placeholder_usage_explanation")),
		},
	}
}

func readDatasetHeaderTextConfig(langKey, datasetName, fieldName string) (datasetHeaderTextConfig, error) {
	config := datasetHeaderTextConfig{LangKey: langKey}
	var fi, en, ch, usageExplanation sql.NullString
	preferredSourceHigh := datasetHeaderSourceHigh(datasetName, fieldName)
	legacySourceHigh := legacyDatasetHeaderSourceHigh(datasetName, fieldName)
	err := backend.Db.QueryRow(`
		SELECT COALESCE(k.fi, ''),
		       COALESCE(k.en, ''),
		       COALESCE(k.ch, ''),
		       COALESCE(
		           (
		               SELECT s.usage_explanation
		               FROM system_lang_key_sources s
		               WHERE s.lang_key_id = k.id
		                 AND s.source_type = 'dataset_header'
		                 AND (
		                      (s.source_high = $2 AND s.source_low = $3)
		                      OR s.source_high = $4
		                 )
		                 AND s.usage_explanation != ''
		               ORDER BY s.id
		               LIMIT 1
		           ),
		           (
		               SELECT s.usage_explanation
		               FROM system_lang_key_sources s
		               WHERE s.lang_key_id = k.id
		                 AND s.usage_explanation != ''
		               ORDER BY CASE WHEN s.source_type = 'code' THEN 0 ELSE 1 END, s.id
		               LIMIT 1
		           ),
		           ''
		       )
		FROM system_lang_keys k
		WHERE k.lang_key = $1
	`, langKey, preferredSourceHigh, fieldName, legacySourceHigh).Scan(&fi, &en, &ch, &usageExplanation)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return config, nil
		}
		return datasetHeaderTextConfig{}, err
	}
	config.Fi = fi.String
	config.En = en.String
	config.Ch = ch.String
	config.UsageExplanation = usageExplanation.String
	return config, nil
}

func saveDatasetHeaderLangKeyConfig(tx *sql.Tx, datasetName string, configs []datasetHeaderTextSaveRequest) error {
	for _, config := range configs {
		if err := upsertDatasetHeaderLangKey(tx, config); err != nil {
			return fmt.Errorf("upsert %s: %w", config.FieldName, err)
		}
		if err := upsertDatasetHeaderSource(tx, datasetName, config); err != nil {
			return fmt.Errorf("upsert source %s: %w", config.FieldName, err)
		}
	}
	return nil
}

func upsertDatasetHeaderLangKey(tx *sql.Tx, config datasetHeaderTextSaveRequest) error {
	if config.LangKey == "" {
		return fmt.Errorf("lang key is required")
	}

	_, err := tx.Exec(`
		INSERT INTO system_lang_keys (lang_key, fi, en, ch, created, updated)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (lang_key) DO UPDATE
		  SET fi = EXCLUDED.fi,
		      en = EXCLUDED.en,
		      ch = EXCLUDED.ch,
		      updated = NOW()
	`, config.LangKey, config.Fi, config.En, config.Ch)
	return err
}

func upsertDatasetHeaderSource(tx *sql.Tx, datasetName string, config datasetHeaderTextSaveRequest) error {
	var langKeyID int64
	if err := tx.QueryRow(`SELECT id FROM system_lang_keys WHERE lang_key = $1`, config.LangKey).Scan(&langKeyID); err != nil {
		return err
	}

	_, err := tx.Exec(`
		INSERT INTO system_lang_key_sources (lang_key_id, source_type, source_high, source_low, last_seen, usage_explanation)
		VALUES ($1, 'dataset_header', $2, $3, CURRENT_DATE, $4)
		ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
		  SET source_low = EXCLUDED.source_low,
		      last_seen = CURRENT_DATE,
		      usage_explanation = EXCLUDED.usage_explanation
	`, langKeyID, datasetHeaderSourceHigh(datasetName, config.FieldName), config.FieldName, config.UsageExplanation)
	if err != nil {
		return err
	}

	_, err = tx.Exec(`
		DELETE FROM system_lang_key_sources
		WHERE lang_key_id = $1
		  AND source_type = 'dataset_header'
		  AND source_high = $2
	`, langKeyID, legacyDatasetHeaderSourceHigh(datasetName, config.FieldName))
	return err
}

func resolveStorageDir() string {
	if execPath, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(execPath), "storage")
		if _, statErr := os.Stat(candidate); statErr == nil {
			return candidate
		}
	}

	if cwd, err := os.Getwd(); err == nil {
		return filepath.Join(cwd, "storage")
	}

	return "storage"
}

func findProjectLogoPublicPath(storageDir string) string {
	for _, ext := range projectLogoExtensions {
		fileName := fmt.Sprintf("project_logo%s", ext)
		if _, err := os.Stat(filepath.Join(storageDir, fileName)); err == nil {
			return "/storage/" + fileName
		}
	}
	return ""
}

func readOptionalMultipartFile(r *http.Request, fieldName string) (*multipart.FileHeader, error) {
	if r.MultipartForm == nil || r.MultipartForm.File == nil {
		return nil, nil
	}
	fileHeaders := r.MultipartForm.File[fieldName]
	if len(fileHeaders) == 0 {
		return nil, nil
	}
	return fileHeaders[0], nil
}

func saveProjectLogoFile(storageDir string, fileHeader *multipart.FileHeader) error {
	if fileHeader == nil {
		return nil
	}

	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	if !isAllowedProjectLogoExtension(ext) {
		return fmt.Errorf("unsupported project banner file type: %s", ext)
	}

	if err := os.MkdirAll(storageDir, 0o755); err != nil {
		return err
	}
	if err := removeExistingProjectLogoFiles(storageDir); err != nil {
		return err
	}

	src, err := fileHeader.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	if err := filevalidation.ValidateExtensionSignature(src, ext); err != nil {
		return fmt.Errorf("unsupported project banner file type: %w", err)
	}

	dstPath := filepath.Join(storageDir, fmt.Sprintf("project_logo%s", ext))
	dst, err := os.Create(dstPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return err
	}

	return dst.Chmod(0o644)
}

func removeExistingProjectLogoFiles(storageDir string) error {
	for _, ext := range projectLogoExtensions {
		candidate := filepath.Join(storageDir, fmt.Sprintf("project_logo%s", ext))
		if err := os.Remove(candidate); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func isAllowedProjectLogoExtension(ext string) bool {
	for _, allowed := range projectLogoExtensions {
		if ext == allowed {
			return true
		}
	}
	return false
}
