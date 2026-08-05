// card_visibility.go
// Admin API handlers for managing card column visibility flags.
// Bridges system_column_details visibility settings and the admin card-configuration UI.
// Exists to let admins read and batch-update which columns appear on card views.
package system_table_tools

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

const defaultCardDetailsLayout = "conditional_multiline"
const defaultCardStyleVariant = "standard"

// CardVisibilityColumn represents one column's visibility settings.
type CardVisibilityColumn struct {
	ColumnUID                int    `json:"column_uid"`
	ColumnName               string `json:"column_name"`
	CardElement              string `json:"card_element"`
	CardDetailLabelMode      string `json:"card_detail_label_mode"`
	CardDetailIconSVG        string `json:"card_detail_icon_svg"`
	CardDetailIconKey        string `json:"card_detail_icon_key"`
	CardDetailCapitalization bool   `json:"card_detail_capitalization"`
	ShowKeyOnCard            bool   `json:"show_key_on_card"`
	ShowValueOnCard          bool   `json:"show_value_on_card"`
	HideEverywhere           bool   `json:"hide_everywhere"`
	HideOnSmallCard          bool   `json:"hide_on_small_card"`
	HideFalseNullOnSmlCrd    bool   `json:"hide_false_null_on_sml_crd"`
	HideFalseNullOnBigCrd    bool   `json:"hide_false_null_on_big_crd"`
	HideOnBgCrdIfNotOwn      bool   `json:"hide_on_bg_crd_if_not_own"`
	HideInFilterPanel        bool   `json:"hide_in_filter_panel"`
}

// CardVisibilityResponse represents one table's card visibility settings.
type CardVisibilityResponse struct {
	TableName         string                 `json:"table_name"`
	CardDetailsLayout string                 `json:"card_details_layout"`
	CardStyleVariant  string                 `json:"card_style_variant"`
	Columns           []CardVisibilityColumn `json:"columns"`
}

func publicTableColumnExists(db *sql.DB, tableName, columnName string) (bool, error) {
	var exists bool
	err := db.QueryRow(`
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'public'
			  AND table_name = $1
			  AND column_name = $2
		)
	`, tableName, columnName).Scan(&exists)
	return exists, err
}

// GetCardVisibilityHandler returns card visibility flags for all columns of a table.
// GET /api/card-visibility/{tableName}
func GetCardVisibilityHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	tableName := strings.TrimPrefix(r.URL.Path, "/api/card-visibility/")
	if tableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "table name is required")
		return
	}

	hasCardDetailIconKey, err := publicTableColumnExists(backend.Db, "system_column_details", "card_detail_icon_key")
	if err != nil {
		log.Printf("\033[31merror: [GetCardVisibilityHandler] card_detail_icon_key check failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error checking card detail icon metadata")
		return
	}

	cardDetailIconKeyExpr := `''::varchar AS card_detail_icon_key`
	if hasCardDetailIconKey {
		cardDetailIconKeyExpr = `COALESCE(scd.card_detail_icon_key, '') AS card_detail_icon_key`
	}
	hasCardDetailCapitalization, err := publicTableColumnExists(backend.Db, "system_column_details", "card_detail_capitalization")
	if err != nil {
		log.Printf("\033[31merror: [GetCardVisibilityHandler] card_detail_capitalization check failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error checking card detail capitalization metadata")
		return
	}
	cardDetailCapitalizationExpr := `TRUE AS card_detail_capitalization`
	if hasCardDetailCapitalization {
		cardDetailCapitalizationExpr = `COALESCE(scd.card_detail_capitalization, true) AS card_detail_capitalization`
	}

	query := fmt.Sprintf(`
		SELECT scd.column_uid, scd.column_name,
		       COALESCE(scd.card_element, 'details')       AS card_element,
		       COALESCE(scd.card_detail_label_mode, 'label') AS card_detail_label_mode,
		       COALESCE(scd.card_detail_icon_svg, '')     AS card_detail_icon_svg,
		       %s,
		       %s,
		       COALESCE(scd.show_key_on_card, true)        AS show_key_on_card,
		       COALESCE(scd.show_value_on_card, true)      AS show_value_on_card,
		       COALESCE(scd.hide_everywhere, false)         AS hide_everywhere,
		       COALESCE(scd.hide_on_small_card, false)      AS hide_on_small_card,
		       COALESCE(scd.hide_false_null_on_sml_crd, false) AS hide_false_null_on_sml_crd,
		       COALESCE(scd.hide_false_null_on_big_crd, false) AS hide_false_null_on_big_crd,
		       COALESCE(scd.hide_on_bg_crd_if_not_own, false)  AS hide_on_bg_crd_if_not_own,
		       COALESCE(scd.hide_in_filter_panel, false)   AS hide_in_filter_panel
		FROM system_column_details scd
		JOIN system_db_tables sdt ON sdt.table_uid = scd.table_uid
		WHERE sdt.table_name = $1
		ORDER BY scd.co_number
	`, cardDetailIconKeyExpr, cardDetailCapitalizationExpr)

	cardDetailsLayout := defaultCardDetailsLayout
	cardStyleVariant := defaultCardStyleVariant
	hasCardStyleVariant, err := publicTableColumnExists(backend.Db, "system_db_tables", "card_style_variant")
	if err != nil {
		log.Printf("\033[31merror: [GetCardVisibilityHandler] card_style_variant check failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error checking card style metadata")
		return
	}
	cardStyleVariantExpr := `'standard'::varchar AS card_style_variant`
	if hasCardStyleVariant {
		cardStyleVariantExpr = `COALESCE(card_style_variant, 'standard') AS card_style_variant`
	}
	if err := backend.Db.QueryRow(fmt.Sprintf(`
		SELECT COALESCE(card_details_layout, $2), %s
		FROM system_db_tables
		WHERE table_name = $1
		LIMIT 1
	`, cardStyleVariantExpr), tableName, defaultCardDetailsLayout).Scan(&cardDetailsLayout, &cardStyleVariant); err != nil {
		if err == sql.ErrNoRows {
			cardDetailsLayout = defaultCardDetailsLayout
			cardStyleVariant = defaultCardStyleVariant
		} else {
			log.Printf("\033[31merror: [GetCardVisibilityHandler] table settings query failed for table %q: %v\033[0m", tableName, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching card settings")
			return
		}
	}

	rows, err := backend.Db.Query(query, tableName)
	if err != nil {
		log.Printf("\033[31merror: [GetCardVisibilityHandler] query failed for table %q: %v\033[0m", tableName, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching card visibility")
		return
	}
	defer rows.Close()

	var columns []CardVisibilityColumn
	for rows.Next() {
		var c CardVisibilityColumn
		if err := rows.Scan(
			&c.ColumnUID, &c.ColumnName, &c.CardElement,
			&c.CardDetailLabelMode, &c.CardDetailIconSVG, &c.CardDetailIconKey,
			&c.CardDetailCapitalization,
			&c.ShowKeyOnCard, &c.ShowValueOnCard, &c.HideEverywhere,
			&c.HideOnSmallCard, &c.HideFalseNullOnSmlCrd, &c.HideFalseNullOnBigCrd,
			&c.HideOnBgCrdIfNotOwn, &c.HideInFilterPanel,
		); err != nil {
			log.Printf("\033[31merror: [GetCardVisibilityHandler] scan failed: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error scanning column row")
			return
		}
		columns = append(columns, c)
	}

	if columns == nil {
		columns = []CardVisibilityColumn{}
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, CardVisibilityResponse{
		TableName:         tableName,
		CardDetailsLayout: normalizeCardDetailsLayout(cardDetailsLayout),
		CardStyleVariant:  normalizeCardStyleVariant(cardStyleVariant),
		Columns:           columns,
	})
}

// updateCardVisibilityRequest is the expected request body for UpdateCardVisibilityHandler.
type updateCardVisibilityRequest struct {
	TableName         string                 `json:"table_name"`
	CardDetailsLayout string                 `json:"card_details_layout"`
	CardStyleVariant  string                 `json:"card_style_variant"`
	Columns           []CardVisibilityColumn `json:"columns"`
}

// UpdateCardVisibilityHandler batch-updates card visibility flags for a table.
// POST /api/card-visibility/update
func UpdateCardVisibilityHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req updateCardVisibilityRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.TableName == "" || len(req.Columns) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "table_name and columns are required")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		log.Printf("\033[31merror: [UpdateCardVisibilityHandler] failed to acquire transaction\033[0m")
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}

	hasCardDetailIconKey, err := publicTableColumnExists(backend.Db, "system_column_details", "card_detail_icon_key")
	if err != nil {
		log.Printf("\033[31merror: [UpdateCardVisibilityHandler] card_detail_icon_key check failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error checking card detail icon metadata")
		return
	}
	hasCardStyleVariant, err := publicTableColumnExists(backend.Db, "system_db_tables", "card_style_variant")
	if err != nil {
		log.Printf("\033[31merror: [UpdateCardVisibilityHandler] card_style_variant check failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error checking card style metadata")
		return
	}
	hasCardDetailCapitalization, err := publicTableColumnExists(backend.Db, "system_column_details", "card_detail_capitalization")
	if err != nil {
		log.Printf("\033[31merror: [UpdateCardVisibilityHandler] card_detail_capitalization check failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error checking card detail capitalization metadata")
		return
	}

	if strings.TrimSpace(req.CardDetailsLayout) != "" {
		if _, err := tx.Exec(`
			UPDATE system_db_tables
			SET card_details_layout = $1
			WHERE table_name = $2
		`, normalizeCardDetailsLayout(req.CardDetailsLayout), req.TableName); err != nil {
			log.Printf("\033[31merror: [UpdateCardVisibilityHandler] layout update for table %q: %v\033[0m", req.TableName, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error updating card detail layout")
			return
		}
	}
	if hasCardStyleVariant && strings.TrimSpace(req.CardStyleVariant) != "" {
		if _, err := tx.Exec(`
			UPDATE system_db_tables
			SET card_style_variant = $1
			WHERE table_name = $2
		`, normalizeCardStyleVariant(req.CardStyleVariant), req.TableName); err != nil {
			log.Printf("\033[31merror: [UpdateCardVisibilityHandler] style update for table %q: %v\033[0m", req.TableName, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error updating card style variant")
			return
		}
	}

	for _, col := range req.Columns {
		updateQuery := buildCardVisibilityUpdateQuery(hasCardDetailIconKey, hasCardDetailCapitalization)
		updateArgs := buildCardVisibilityUpdateArgs(col, hasCardDetailIconKey, hasCardDetailCapitalization)
		_, err := tx.Exec(updateQuery, updateArgs...)
		if err != nil {
			log.Printf("\033[31merror: [UpdateCardVisibilityHandler] update for column_uid %d: %v\033[0m", col.ColumnUID, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error updating column settings")
			return
		}
	}

	// Invalidate schema cache so visibility changes take effect immediately
	// instead of waiting for the 5-minute TTL to expire.
	dtt_1_row_read.InvalidateSchemaCache(req.TableName)

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"message": "Card visibility settings saved",
	})
}

func buildCardVisibilityUpdateQuery(includeIconKey, includeCapitalization bool) string {
	placeholder := 1
	setClauses := []string{}
	addSetClause := func(columnName string) {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", columnName, placeholder))
		placeholder++
	}

	addSetClause("card_element")
	addSetClause("card_detail_label_mode")
	addSetClause("card_detail_icon_svg")
	if includeIconKey {
		addSetClause("card_detail_icon_key")
	}
	if includeCapitalization {
		addSetClause("card_detail_capitalization")
	}
	addSetClause("show_key_on_card")
	addSetClause("show_value_on_card")
	addSetClause("hide_everywhere")
	addSetClause("hide_on_small_card")
	addSetClause("hide_false_null_on_sml_crd")
	addSetClause("hide_false_null_on_big_crd")
	addSetClause("hide_on_bg_crd_if_not_own")
	addSetClause("hide_in_filter_panel")

	return fmt.Sprintf(`
		UPDATE system_column_details
		SET %s,
		    updated = now()
		WHERE column_uid = $%d
	`, strings.Join(setClauses, ",\n		    "), placeholder)
}

func buildCardVisibilityUpdateArgs(col CardVisibilityColumn, includeIconKey, includeCapitalization bool) []interface{} {
	args := []interface{}{
		col.CardElement,
		normalizeCardDetailLabelMode(col.CardDetailLabelMode),
		strings.TrimSpace(col.CardDetailIconSVG),
	}
	if includeIconKey {
		args = append(args, normalizeNullableCardDetailIconKey(col.CardDetailIconKey))
	}
	if includeCapitalization {
		args = append(args, col.CardDetailCapitalization)
	}
	args = append(args,
		col.ShowKeyOnCard,
		col.ShowValueOnCard,
		col.HideEverywhere,
		col.HideOnSmallCard,
		col.HideFalseNullOnSmlCrd,
		col.HideFalseNullOnBigCrd,
		col.HideOnBgCrdIfNotOwn,
		col.HideInFilterPanel,
		col.ColumnUID,
	)
	return args
}

func normalizeCardDetailLabelMode(labelMode string) string {
	switch strings.ToLower(strings.TrimSpace(labelMode)) {
	case "icon", "both":
		return strings.ToLower(strings.TrimSpace(labelMode))
	default:
		return "label"
	}
}

func normalizeCardDetailIconKey(iconKey string) string {
	normalized := strings.ToLower(strings.TrimSpace(iconKey))
	if normalized == "" || len(normalized) > 64 {
		return ""
	}
	for _, char := range normalized {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_' || char == '-' {
			continue
		}
		return ""
	}
	return normalized
}

func normalizeNullableCardDetailIconKey(iconKey string) sql.NullString {
	normalized := normalizeCardDetailIconKey(iconKey)
	if normalized == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: normalized, Valid: true}
}

func normalizeCardDetailsLayout(layout string) string {
	switch strings.ToLower(strings.TrimSpace(layout)) {
	case "single_line":
		return "single_line"
	case "stacked":
		return "stacked"
	case "inline":
		return "inline"
	case "conditional_multiline", "multiline":
		return defaultCardDetailsLayout
	default:
		return defaultCardDetailsLayout
	}
}

func normalizeCardStyleVariant(variant string) string {
	switch strings.ToLower(strings.TrimSpace(variant)) {
	case "modern":
		return "modern"
	default:
		return defaultCardStyleVariant
	}
}
