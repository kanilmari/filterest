// row_groups.go
// Provides administrator list/create and membership management for reusable groups.
// Bridges generic dataset rows and the normalized system_row_groups taxonomy.
// Exists so projects can classify rows across datasets without comma-separated labels or table-specific schemas.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"github.com/lib/pq"
)

const maxRowGroupRequestBytes = 64 * 1024

var (
	rowGroupSlugPattern     = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
	rowGroupLanguagePattern = regexp.MustCompile(`^[a-z]{2,3}(-[A-Z]{2})?$`)
	errRowGroupUnavailable  = errors.New("row group does not exist or is disabled")
	errRowGroupConflict     = errors.New("a row group with this slug already exists")
	errRowGroupTarget       = errors.New("target dataset or row does not exist")
	errRowGroupLanguages    = errors.New("row group languages must use the registered default language and known language codes")
	listRowGroups           = listRowGroupsFromDB
	createRowGroup          = createRowGroupInDB
	assignRowGroup          = assignRowGroupInDB
	removeRowGroup          = removeRowGroupInDB
)

// RowGroup is one reusable global classification.
type RowGroup struct {
	ID          int64             `json:"id"`
	Slug        string            `json:"slug"`
	Title       map[string]string `json:"title"`
	Description map[string]string `json:"description,omitempty"`
	SortOrder   int               `json:"sort_order"`
	Enabled     bool              `json:"enabled"`
	Selected    bool              `json:"selected"`
}

type createRowGroupRequest struct {
	Slug        string            `json:"slug"`
	Title       map[string]string `json:"title"`
	Description map[string]string `json:"description,omitempty"`
	SortOrder   int               `json:"sort_order"`
	Enabled     *bool             `json:"enabled,omitempty"`
}

type rowGroupMembershipRequest struct {
	GroupID  int64 `json:"group_id"`
	TableUID int64 `json:"table_uid"`
	RowID    int64 `json:"row_id"`
}

// AdminRowGroupsHandler lists applicable groups or creates a reusable group.
// GET|POST /api/admin/row-groups
func AdminRowGroupsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tableUID, err := optionalPositiveQueryValue(r, "table_uid")
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		rowID, err := optionalPositiveQueryValue(r, "row_id")
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		if rowID > 0 && tableUID == 0 {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "row_id requires table_uid")
			return
		}

		groups, err := listRowGroups(r.Context(), tableUID, rowID)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "row groups unavailable")
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{"groups": groups})
	case http.MethodPost:
		request, err := decodeCreateRowGroupRequest(r.Body)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		tx, ok := dbutils.RequireTx(r.Context())
		if !ok {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction unavailable")
			return
		}
		group, err := createRowGroup(r.Context(), tx, request)
		if errors.Is(err, errRowGroupConflict) {
			httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
			return
		}
		if errors.Is(err, errRowGroupLanguages) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "row group creation failed")
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusCreated, group)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// AdminRowGroupMembershipsHandler assigns or removes a group from a dataset row.
// POST|DELETE /api/admin/row-group-memberships
func AdminRowGroupMembershipsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
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
		err = assignRowGroup(r.Context(), tx, request)
	} else {
		err = removeRowGroup(r.Context(), tx, request)
	}
	if errors.Is(err, errRowGroupUnavailable) || errors.Is(err, errRowGroupTarget) {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "row group membership update failed")
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func decodeCreateRowGroupRequest(reader io.Reader) (createRowGroupRequest, error) {
	var request createRowGroupRequest
	decoder := json.NewDecoder(io.LimitReader(reader, maxRowGroupRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return createRowGroupRequest{}, errors.New("invalid request body")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return createRowGroupRequest{}, errors.New("request body must contain one JSON object")
	}

	request.Slug = strings.TrimSpace(request.Slug)
	if !rowGroupSlugPattern.MatchString(request.Slug) {
		return createRowGroupRequest{}, errors.New("slug must contain 1-64 lowercase letters, digits, underscores, or hyphens")
	}
	if request.SortOrder < -100000 || request.SortOrder > 100000 {
		return createRowGroupRequest{}, errors.New("sort_order is outside the supported range")
	}
	var err error
	request.Title, err = normalizeRowGroupTranslations(request.Title, true)
	if err != nil {
		return createRowGroupRequest{}, fmt.Errorf("title: %w", err)
	}
	request.Description, err = normalizeRowGroupTranslations(request.Description, false)
	if err != nil {
		return createRowGroupRequest{}, fmt.Errorf("description: %w", err)
	}
	return request, nil
}

func decodeRowGroupMembershipRequest(reader io.Reader) (rowGroupMembershipRequest, error) {
	var request rowGroupMembershipRequest
	decoder := json.NewDecoder(io.LimitReader(reader, maxRowGroupRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return rowGroupMembershipRequest{}, errors.New("invalid request body")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return rowGroupMembershipRequest{}, errors.New("request body must contain one JSON object")
	}
	if request.GroupID <= 0 || request.TableUID <= 0 || request.RowID <= 0 {
		return rowGroupMembershipRequest{}, errors.New("group_id, table_uid, and row_id must be positive integers")
	}
	return request, nil
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

func listRowGroupsFromDB(ctx context.Context, tableUID int64, rowID int64) ([]RowGroup, error) {
	rows, err := backend.Db.QueryContext(ctx, `
		SELECT groups.id,
		       groups.slug,
		       groups.title::text,
		       COALESCE(groups.description, '{}'::jsonb)::text,
		       groups.sort_order,
		       groups.enabled,
		       CASE
		           WHEN $1::bigint > 0 AND $2::bigint > 0 THEN EXISTS (
		               SELECT 1
		               FROM public.system_row_group_memberships AS membership
		               WHERE membership.group_id = groups.id
		                 AND membership.table_uid = $1
		                 AND membership.row_id = $2
		           )
		           ELSE FALSE
		       END AS selected
		FROM public.system_row_groups AS groups
		ORDER BY groups.sort_order, groups.slug, groups.id
	`, tableUID, rowID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	groups := make([]RowGroup, 0)
	for rows.Next() {
		var group RowGroup
		var titleJSON string
		var descriptionJSON string
		if err := rows.Scan(
			&group.ID,
			&group.Slug,
			&titleJSON,
			&descriptionJSON,
			&group.SortOrder,
			&group.Enabled,
			&group.Selected,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(titleJSON), &group.Title); err != nil {
			return nil, fmt.Errorf("decode row group %d title: %w", group.ID, err)
		}
		if err := json.Unmarshal([]byte(descriptionJSON), &group.Description); err != nil {
			return nil, fmt.Errorf("decode row group %d description: %w", group.ID, err)
		}
		groups = append(groups, group)
	}
	return groups, rows.Err()
}

func createRowGroupInDB(ctx context.Context, tx *sql.Tx, request createRowGroupRequest) (RowGroup, error) {
	if err := validateRowGroupLanguagesInDB(ctx, tx, request.Title, request.Description); err != nil {
		return RowGroup{}, err
	}
	titleJSON, err := json.Marshal(request.Title)
	if err != nil {
		return RowGroup{}, err
	}
	descriptionJSON, err := json.Marshal(request.Description)
	if err != nil {
		return RowGroup{}, err
	}
	enabled := true
	if request.Enabled != nil {
		enabled = *request.Enabled
	}

	group := RowGroup{
		Slug: request.Slug, Title: request.Title, Description: request.Description,
		SortOrder: request.SortOrder, Enabled: enabled,
	}
	err = tx.QueryRowContext(ctx, `
		INSERT INTO public.system_row_groups (
			slug, title, description, sort_order, enabled
		)
		VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)
		RETURNING id
	`, request.Slug, string(titleJSON), string(descriptionJSON), request.SortOrder, enabled).Scan(&group.ID)
	var pqError *pq.Error
	if errors.As(err, &pqError) && pqError.Code == "23505" {
		return RowGroup{}, errRowGroupConflict
	}
	return group, err
}

func assignRowGroupInDB(ctx context.Context, tx *sql.Tx, request rowGroupMembershipRequest) error {
	var available bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM public.system_row_groups
			WHERE id = $1
			  AND enabled = TRUE
		)
	`, request.GroupID).Scan(&available); err != nil {
		return err
	}
	if !available {
		return errRowGroupUnavailable
	}

	var schemaName string
	var tableName string
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(NULLIF(schema_name, ''), 'public'), table_name
		FROM public.system_db_tables
		WHERE table_uid = $1
	`, request.TableUID).Scan(&schemaName, &tableName); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errRowGroupTarget
		}
		return err
	}

	targetStableKey := ""
	quotedTarget := pq.QuoteIdentifier(schemaName) + "." + pq.QuoteIdentifier(tableName)
	if tableName == "system_config" && schemaName == "public" {
		if err := tx.QueryRowContext(ctx, `SELECT key FROM public.system_config WHERE id = $1 FOR KEY SHARE`, request.RowID).Scan(&targetStableKey); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errRowGroupTarget
			}
			return err
		}
	} else {
		var targetID int64
		query := fmt.Sprintf("SELECT id FROM %s WHERE id = $1 FOR KEY SHARE", quotedTarget)
		if err := tx.QueryRowContext(ctx, query, request.RowID).Scan(&targetID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errRowGroupTarget
			}
			return err
		}
	}
	var err error
	if targetStableKey != "" {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO public.system_row_group_memberships (group_id, table_uid, row_id, target_stable_key)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (group_id, table_uid, target_stable_key)
			WHERE target_stable_key IS NOT NULL
			DO UPDATE SET row_id = EXCLUDED.row_id, updated = now()
		`, request.GroupID, request.TableUID, request.RowID, targetStableKey)
	} else {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO public.system_row_group_memberships (group_id, table_uid, row_id)
			VALUES ($1, $2, $3)
			ON CONFLICT (group_id, table_uid, row_id) DO NOTHING
		`, request.GroupID, request.TableUID, request.RowID)
	}
	return err
}

func removeRowGroupInDB(ctx context.Context, tx *sql.Tx, request rowGroupMembershipRequest) error {
	_, err := tx.ExecContext(ctx, `
		DELETE FROM public.system_row_group_memberships
		WHERE group_id = $1 AND table_uid = $2 AND row_id = $3
	`, request.GroupID, request.TableUID, request.RowID)
	return err
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
