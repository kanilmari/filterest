// ui_language_settings.go
// Reads public UI-language availability and saves the administrator's site-language choices.
// Bridges the canonical system_languages registry with public selectors and the site settings UI.
// Exists so language availability, fallback, and publication gates have one validated DB authority.
package lang

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

type uiLanguageSetting struct {
	LanguageCode         string  `json:"language_code"`
	EnglishName          string  `json:"english_name"`
	NativeName           string  `json:"native_name"`
	ScriptCode           string  `json:"script_code"`
	RegionCode           *string `json:"region_code"`
	IsEnabled            bool    `json:"is_enabled"`
	IsDefault            bool    `json:"is_default"`
	FallbackLanguageCode *string `json:"fallback_language_code"`
	CoverageStatus       string  `json:"coverage_status"`
	ReviewStatus         string  `json:"review_status"`
	PublicSelectorReady  bool    `json:"public_selector_ready"`
	SortOrder            int     `json:"sort_order"`
}

type uiLanguageSettingsResponse struct {
	Languages []uiLanguageSetting `json:"languages"`
}

type uiLanguageSettingsSaveRequest struct {
	Languages []uiLanguageSetting `json:"languages"`
}

type uiLanguageQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

const uiLanguageSettingsUpdateSQL = `
	WITH requested AS (
		SELECT *
		FROM jsonb_to_recordset($1::jsonb) AS item(
			language_code TEXT,
			is_enabled BOOLEAN,
			is_default BOOLEAN,
			fallback_language_code TEXT,
			public_selector_ready BOOLEAN
		)
	)
	UPDATE system_languages AS target
	SET is_enabled = requested.is_enabled,
	    is_default = requested.is_default,
	    fallback_language_code = requested.fallback_language_code,
	    public_selector_ready = requested.public_selector_ready,
	    updated = NOW()
	FROM requested
	WHERE target.language_code = requested.language_code
`

// GetPublicUILanguagesHandler returns only fully approved languages that may appear in public selectors.
// GET /api/ui-languages
func GetPublicUILanguagesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	languages, err := readUILanguageSettings(r.Context(), backend.Db)
	if err != nil {
		log.Printf("\033[31merror: [GetPublicUILanguagesHandler] read failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error reading UI languages")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, uiLanguageSettingsResponse{
		Languages: filterPublicUILanguages(languages),
	})
}

// AdminUILanguagesHandler returns or saves the complete canonical site-language registry.
// GET/POST /api/admin/ui-languages
func AdminUILanguagesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		languages, err := readUILanguageSettings(r.Context(), backend.Db)
		if err != nil {
			log.Printf("\033[31merror: [AdminUILanguagesHandler] read failed: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error reading UI language settings")
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, uiLanguageSettingsResponse{Languages: languages})
	case http.MethodPost:
		saveAdminUILanguageSettings(w, r)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func saveAdminUILanguageSettings(w http.ResponseWriter, r *http.Request) {
	var request uiLanguageSettingsSaveRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}

	current, err := readUILanguageSettings(r.Context(), tx)
	if err != nil {
		log.Printf("\033[31merror: [AdminUILanguagesHandler] locked read failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error reading UI language settings")
		return
	}

	normalized, err := validateAndNormalizeUILanguageSettings(request.Languages, current)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	payload, err := json.Marshal(normalized)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to encode UI language settings")
		return
	}
	if _, err := tx.ExecContext(r.Context(), uiLanguageSettingsUpdateSQL, payload); err != nil {
		log.Printf("\033[31merror: [AdminUILanguagesHandler] update failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to save UI language settings")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, uiLanguageSettingsResponse{Languages: normalized})
}

func readUILanguageSettings(ctx context.Context, queryer uiLanguageQueryer) ([]uiLanguageSetting, error) {
	if queryer == nil {
		return nil, errors.New("UI language database is unavailable")
	}

	rows, err := queryer.QueryContext(ctx, `
		SELECT language_code,
		       english_name,
		       native_name,
		       script_code,
		       region_code,
		       is_enabled,
		       is_default,
		       fallback_language_code,
		       coverage_status,
		       review_status,
		       public_selector_ready,
		       sort_order
		FROM system_languages
		ORDER BY sort_order, language_code
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	languages := make([]uiLanguageSetting, 0, 5)
	for rows.Next() {
		var setting uiLanguageSetting
		var regionCode sql.NullString
		var fallbackCode sql.NullString
		if err := rows.Scan(
			&setting.LanguageCode,
			&setting.EnglishName,
			&setting.NativeName,
			&setting.ScriptCode,
			&regionCode,
			&setting.IsEnabled,
			&setting.IsDefault,
			&fallbackCode,
			&setting.CoverageStatus,
			&setting.ReviewStatus,
			&setting.PublicSelectorReady,
			&setting.SortOrder,
		); err != nil {
			return nil, err
		}
		if regionCode.Valid {
			setting.RegionCode = stringPointer(regionCode.String)
		}
		if fallbackCode.Valid {
			setting.FallbackLanguageCode = stringPointer(fallbackCode.String)
		}
		languages = append(languages, setting)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return languages, nil
}

func validateAndNormalizeUILanguageSettings(requested, current []uiLanguageSetting) ([]uiLanguageSetting, error) {
	if len(requested) != len(current) || len(current) == 0 {
		return nil, errors.New("language settings must include the complete registry")
	}

	currentByCode := make(map[string]uiLanguageSetting, len(current))
	for _, setting := range current {
		currentByCode[setting.LanguageCode] = setting
	}

	normalized := make([]uiLanguageSetting, 0, len(current))
	seen := make(map[string]bool, len(current))
	for _, requestedSetting := range requested {
		code := strings.TrimSpace(requestedSetting.LanguageCode)
		currentSetting, exists := currentByCode[code]
		if !exists || seen[code] {
			return nil, fmt.Errorf("unknown or duplicate language code %q", code)
		}
		seen[code] = true
		currentSetting.IsEnabled = requestedSetting.IsEnabled
		currentSetting.IsDefault = requestedSetting.IsDefault
		currentSetting.PublicSelectorReady = requestedSetting.PublicSelectorReady
		currentSetting.FallbackLanguageCode = normalizeOptionalLanguageCode(requestedSetting.FallbackLanguageCode)
		normalized = append(normalized, currentSetting)
	}

	defaultCount := 0
	normalizedByCode := make(map[string]uiLanguageSetting, len(normalized))
	for index := range normalized {
		setting := &normalized[index]
		if setting.IsDefault {
			defaultCount++
			setting.FallbackLanguageCode = nil
			if !setting.IsEnabled {
				return nil, errors.New("the default language must be enabled")
			}
		} else if setting.FallbackLanguageCode == nil {
			return nil, fmt.Errorf("language %s requires a fallback language", setting.LanguageCode)
		}
		if setting.PublicSelectorReady && (!setting.IsEnabled || setting.CoverageStatus != "complete" || setting.ReviewStatus != "approved") {
			return nil, fmt.Errorf("language %s is not complete and approved for the public selector", setting.LanguageCode)
		}
		normalizedByCode[setting.LanguageCode] = *setting
	}
	if defaultCount != 1 {
		return nil, errors.New("exactly one enabled default language is required")
	}

	for _, setting := range normalized {
		if setting.IsDefault {
			continue
		}
		fallbackCode := *setting.FallbackLanguageCode
		fallback, exists := normalizedByCode[fallbackCode]
		if !exists || fallbackCode == setting.LanguageCode {
			return nil, fmt.Errorf("language %s has an invalid fallback", setting.LanguageCode)
		}
		if setting.IsEnabled && !fallback.IsEnabled {
			return nil, fmt.Errorf("enabled language %s requires an enabled fallback", setting.LanguageCode)
		}
		if uiLanguageFallbackHasCycle(setting.LanguageCode, normalizedByCode) {
			return nil, fmt.Errorf("language %s creates a fallback cycle", setting.LanguageCode)
		}
	}

	sort.Slice(normalized, func(left, right int) bool {
		if normalized[left].SortOrder == normalized[right].SortOrder {
			return normalized[left].LanguageCode < normalized[right].LanguageCode
		}
		return normalized[left].SortOrder < normalized[right].SortOrder
	})
	return normalized, nil
}

func uiLanguageFallbackHasCycle(startCode string, settings map[string]uiLanguageSetting) bool {
	seen := map[string]bool{}
	currentCode := startCode
	for {
		if seen[currentCode] {
			return true
		}
		seen[currentCode] = true
		setting, exists := settings[currentCode]
		if !exists || setting.IsDefault || setting.FallbackLanguageCode == nil {
			return false
		}
		currentCode = *setting.FallbackLanguageCode
	}
}

func filterPublicUILanguages(languages []uiLanguageSetting) []uiLanguageSetting {
	publicLanguages := make([]uiLanguageSetting, 0, len(languages))
	for _, setting := range languages {
		if setting.IsEnabled && setting.PublicSelectorReady && setting.CoverageStatus == "complete" && setting.ReviewStatus == "approved" {
			publicLanguages = append(publicLanguages, setting)
		}
	}
	return publicLanguages
}

func normalizeOptionalLanguageCode(value *string) *string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return stringPointer(strings.TrimSpace(*value))
}

func stringPointer(value string) *string {
	return &value
}
