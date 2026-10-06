// row_groups.go
// Provides administrator heading, value and assignment management on the existing routes.
// Bridges bounded requests with transaction-owned catalogue and membership writers.
// Exists so multilingual row classifications are managed through one administrator boundary.
package system_table_tools

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"github.com/lib/pq"
)

const maxRowGroupRequestBytes = 64 * 1024

var (
	rowGroupSlugPattern     = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
	rowGroupLanguagePattern = regexp.MustCompile(`^[a-z]{2,3}(-[A-Z]{2})?$`)
	errRowGroupUnavailable  = errors.New("row group or classification does not exist or is disabled")
	errRowGroupConflict     = errors.New("a row group or classification with this slug already exists")
	errRowGroupTarget       = errors.New("target dataset or row does not exist")
	errRowGroupLanguages    = errors.New("row group languages must use the registered default language and known language codes")
)

// RowGroup is a global value or heading, with additive assignment readback.
type RowGroup struct {
	ID               int64             `json:"id"`
	Slug             string            `json:"slug"`
	Title            map[string]string `json:"title"`
	Description      map[string]string `json:"description,omitempty"`
	ClassificationID *int64            `json:"classification_id"`
	IsSingle         *bool             `json:"is_single,omitempty"`
	SortOrder        int               `json:"sort_order"`
	Enabled          bool              `json:"enabled"`
	Selected         bool              `json:"selected"`
	SelectedRows     []int64           `json:"selected_rows"`
}

type createRowGroupRequest struct {
	ID               int64                  `json:"id,omitempty"`
	Slug             string                 `json:"slug,omitempty"`
	Title            map[string]string      `json:"title,omitempty"`
	Description      map[string]string      `json:"description,omitempty"`
	ClassificationID *int64                 `json:"classification_id,omitempty"`
	IsSingle         *bool                  `json:"is_single,omitempty"`
	SortOrder        *int                   `json:"sort_order,omitempty"`
	Enabled          *bool                  `json:"enabled,omitempty"`
	Classification   *createRowGroupRequest `json:"classification,omitempty"`
}

type rowGroupMembershipRequest struct {
	GroupID  int64   `json:"group_id"`
	Dataset  string  `json:"dataset,omitempty"`
	RowIDs   []int64 `json:"row_ids,omitempty"`
	TableUID int64   `json:"table_uid,omitempty"`
	RowID    int64   `json:"row_id,omitempty"`
}

type rowGroupCatalogue struct {
	Groups          []RowGroup `json:"groups"`
	Classifications []RowGroup `json:"classifications"`
	Dataset         string     `json:"dataset,omitempty"`
	TableUID        int64      `json:"table_uid,omitempty"`
	RowIDs          []int64    `json:"row_ids"`
}

func requireRowGroupAdministrator(w http.ResponseWriter, r *http.Request) bool {
	actor := dbutils.RequestActorContextFromRequest(r)
	if actor.UserRole != "admin" || actor.UserID <= 1 {
		httpresponse.RespondWithError(w, http.StatusForbidden, "administrator access required")
		return false
	}
	return true
}

// AdminRowGroupsHandler lists headings and selected values, or creates/edits names.
// GET|POST /api/admin/row-groups; the target query deliberately avoids dataset routing.
func AdminRowGroupsHandler(w http.ResponseWriter, r *http.Request) {
	if !requireRowGroupAdministrator(w, r) {
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction unavailable")
		return
	}
	switch r.Method {
	case http.MethodGet:
		response, err := getRowGroupCatalogue(r.Context(), tx, r)
		if err != nil {
			respondWithRowGroupError(w, err)
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, response)
	case http.MethodPost:
		request, err := decodeCreateRowGroupRequest(r.Body)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		heading := request.Classification != nil
		if heading {
			request = *request.Classification
		}
		result, err := saveRowGroupInDB(r.Context(), tx, request, heading)
		if err != nil {
			respondWithRowGroupError(w, err)
			return
		}
		status := http.StatusCreated
		if request.ID > 0 {
			status = http.StatusOK
		}
		httpresponse.RespondWithJSON(w, status, result)
	}
}

// AdminRowGroupMembershipsHandler applies one value to 1–200 rows, retaining legacy bodies.
// POST|DELETE /api/admin/row-group-memberships
func AdminRowGroupMembershipsHandler(w http.ResponseWriter, r *http.Request) {
	if !requireRowGroupAdministrator(w, r) {
		return
	}
	request, err := decodeRowGroupMembershipRequest(r.Body)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction unavailable")
		return
	}
	if r.Method == http.MethodPost {
		err = assignRowGroupInDB(r.Context(), tx, request)
	} else {
		err = removeRowGroupInDB(r.Context(), tx, request)
	}
	if err != nil {
		respondWithRowGroupError(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func respondWithRowGroupError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errRowGroupConflict):
		httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
	case errors.Is(err, errRowGroupUnavailable), errors.Is(err, errRowGroupTarget), errors.Is(err, errRowGroupLanguages),
		errors.Is(err, errRowAccessRows), errors.Is(err, errRowAccessDataset):
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
	default:
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "row group operation failed")
	}
}

// Query validation errors remain 400 without disguising database failures.
func rowGroupQueryError(message string) error {
	return errors.Join(errRowGroupTarget, errors.New(strings.TrimSpace(message)))
}

func normalizeRowGroupTranslations(input map[string]string, required bool) (map[string]string, error) {
	if len(input) > 16 {
		return nil, errors.New("at most 16 language values are supported")
	}
	output := make(map[string]string, len(input))
	for languageCode, value := range input {
		if !rowGroupLanguagePattern.MatchString(languageCode) {
			return nil, fmt.Errorf("unsupported language code %q", languageCode)
		}
		value = strings.TrimSpace(value)
		if value == "" || len([]rune(value)) > 500 {
			return nil, fmt.Errorf("language %q must contain 1-500 characters", languageCode)
		}
		output[languageCode] = value
	}
	if required && len(output) == 0 {
		return nil, errors.New("at least one language value is required")
	}
	return output, nil
}

func optionalPositiveQueryValue(r *http.Request, key string) (int64, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return value, nil
}

func validateRowGroupLanguagesInDB(
	ctx context.Context,
	tx *sql.Tx,
	title map[string]string,
	description map[string]string,
) error {
	languageCodes := make([]string, 0, len(title)+len(description))
	seen := make(map[string]bool)
	for languageCode := range title {
		seen[languageCode] = true
	}
	for languageCode := range description {
		seen[languageCode] = true
	}
	for languageCode := range seen {
		languageCodes = append(languageCodes, languageCode)
	}
	sort.Strings(languageCodes)

	rows, err := tx.QueryContext(ctx, `
		SELECT language_code, is_default
		FROM public.system_languages
		WHERE language_code = ANY($1)
	`, pq.Array(languageCodes))
	if err != nil {
		return err
	}
	defer rows.Close()

	known := make(map[string]bool, len(languageCodes))
	defaultLanguage := ""
	for rows.Next() {
		var languageCode string
		var isDefault bool
		if err := rows.Scan(&languageCode, &isDefault); err != nil {
			return err
		}
		known[languageCode] = true
		if isDefault {
			defaultLanguage = languageCode
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(known) != len(languageCodes) {
		return errRowGroupLanguages
	}
	if defaultLanguage == "" {
		if err := tx.QueryRowContext(ctx, `
			SELECT language_code
			FROM public.system_languages
			WHERE is_default = TRUE
			LIMIT 1
		`).Scan(&defaultLanguage); err != nil {
			return errRowGroupLanguages
		}
	}
	if strings.TrimSpace(title[defaultLanguage]) == "" {
		return errRowGroupLanguages
	}
	return nil
}
