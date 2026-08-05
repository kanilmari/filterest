// get_results_metadata.go
// Fetches table and column metadata required by the get-results handler.
// Bridges the database schema tables and the get-results query builder.
// Exists to load column permissions, user display settings, and data-type info before query execution.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"log"
	"strings"

	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

const (
	rowPolicyOwnerColumnMetadataColumn = "row_policy_owner_column"
	ownerColumnSourceExplicitMetadata  = "explicit_metadata"
	ownerColumnSourceLegacyFallback    = "legacy_fallback"
)

type ownerColumnResolution struct {
	Column                     string
	Source                     string
	LegacyFallbackColumn       string
	MatchesLegacyFallback      bool
	ComparedWithLegacyFallback bool
}

// fetchUserSelectableColumns hakee sarakkeet, joihin CURRENT_USER:lla on SELECT-oikeus.
func fetchUserSelectableColumns(db *sql.DB, tableName string) ([]string, error) {
	query := `
		SELECT column_name
		FROM information_schema.column_privileges
		WHERE table_name = $1
		  AND privilege_type = 'SELECT'
		  AND grantee = current_user
	`
	rows, err := db.Query(query, tableName)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, err
	}
	defer rows.Close()

	var columns []string
	for rows.Next() {
		var colName string
		if err := rows.Scan(&colName); err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			continue
		}
		columns = append(columns, colName)
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, err
	}
	return columns, nil
}

func columnExistsInTable(db dbutils.Querier, tableName, columnName string) (bool, error) {
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

func normalizeCardDetailLabelMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "icon":
		return "icon"
	case "both":
		return "both"
	default:
		return "label"
	}
}

func normalizeCardDetailsLayout(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "single_line":
		return "single_line"
	case "stacked":
		return "stacked"
	case "inline":
		return "inline"
	case "conditional_multiline", "multiline":
		return "conditional_multiline"
	default:
		return "conditional_multiline"
	}
}

func normalizeCardStyleVariant(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "modern":
		return "modern"
	default:
		return "standard"
	}
}

// fetchUserColumnSettingsOrDefaults hakee käyttäjän sarakeasetukset tai palauttaa oletukset (read-only)
func fetchUserColumnSettingsOrDefaults(userID int, tableName string, db *sql.DB) ([]UserColumnSetting, error) {
	var tableUID int
	if err := db.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name = $1`, tableName).Scan(&tableUID); err != nil {
		return nil, err
	}

	hiddenCols := make(map[string]bool)
	hideRows, err := db.Query(`SELECT column_name FROM system_column_details WHERE table_uid = $1 AND COALESCE(hide_everywhere, false) = true`, tableUID)
	if err == nil {
		defer hideRows.Close()
		for hideRows.Next() {
			var col string
			if err := hideRows.Scan(&col); err == nil {
				hiddenCols[col] = true
			}
		}
	}

	queryUserSettings := `
        SELECT
            column_name,
            sort_order,
            column_width_px,
            is_hidden
        FROM system_user_column_settings
        WHERE user_id = $1
          AND table_uid = $2
        ORDER BY sort_order
    `
	rows, err := db.Query(queryUserSettings, userID, tableUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []UserColumnSetting
	for rows.Next() {
		var ucs UserColumnSetting
		if err := rows.Scan(&ucs.ColumnName, &ucs.SortOrder, &ucs.ColumnWidth, &ucs.IsHidden); err != nil {
			log.Printf("scan error system_user_column_settings: %v", err)
			continue
		}
		if hiddenCols[ucs.ColumnName] {
			continue
		}
		results = append(results, ucs)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(results) == 0 {
		queryDefaults := `
            SELECT
                scd.column_name,
                scd.co_number AS sort_order,
                0 AS column_width_px,
                false AS is_hidden
            FROM system_db_tables sdt
            JOIN system_column_details scd ON scd.table_uid = sdt.table_uid
            WHERE sdt.table_name = $1
              AND COALESCE(scd.hide_everywhere, false) = false
            ORDER BY scd.co_number
        `
		rows, err := db.Query(queryDefaults, tableName)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		for rows.Next() {
			var ucs UserColumnSetting
			if err := rows.Scan(&ucs.ColumnName, &ucs.SortOrder, &ucs.ColumnWidth, &ucs.IsHidden); err != nil {
				log.Printf("scan error system_column_details: %v", err)
				continue
			}
			if hiddenCols[ucs.ColumnName] {
				continue
			}
			results = append(results, ucs)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}

		// Jos edelleen ei tuloksia, kyseessä voi olla näkymä, jota ei
		// löydy system_db_tables-taulusta. Tällöin käytetään
		// information_schema.columns -tietoja oletuksina.
		if len(results) == 0 {
			viewRows, err := db.Query(
				`SELECT column_name, ordinal_position AS sort_order, 0 AS column_width_px, false AS is_hidden
                                FROM information_schema.columns
                                WHERE table_schema = 'public' AND table_name = $1
                                ORDER BY ordinal_position`,
				tableName,
			)
			if err != nil {
				return nil, err
			}
			defer viewRows.Close()

			for viewRows.Next() {
				var ucs UserColumnSetting
				if err := viewRows.Scan(&ucs.ColumnName, &ucs.SortOrder, &ucs.ColumnWidth, &ucs.IsHidden); err != nil {
					log.Printf("scan error information_schema: %v", err)
					continue
				}
				results = append(results, ucs)
			}
			if err := viewRows.Err(); err != nil {
				return nil, err
			}
		}
	}

	return results, nil
}

// getColumnDataTypesWithFK hakee sarakkeen data_type sekä FK-tiedot (jos niitä on).
func getColumnDataTypesWithFK(tableName string, db *sql.DB) (map[string]interface{}, error) {
	hasCardDetailIconSVG, err := columnExistsInTable(db, "system_column_details", "card_detail_icon_svg")
	if err != nil {
		return nil, fmt.Errorf("getColumnDataTypesWithFK: checking card_detail_icon_svg column failed: %v", err)
	}
	hasCardDetailIconKey, err := columnExistsInTable(db, "system_column_details", "card_detail_icon_key")
	if err != nil {
		return nil, fmt.Errorf("getColumnDataTypesWithFK: checking card_detail_icon_key column failed: %v", err)
	}
	hasCardDetailLabelMode, err := columnExistsInTable(db, "system_column_details", "card_detail_label_mode")
	if err != nil {
		return nil, fmt.Errorf("getColumnDataTypesWithFK: checking card_detail_label_mode column failed: %v", err)
	}
	hasCardDetailCapitalization, err := columnExistsInTable(db, "system_column_details", "card_detail_capitalization")
	if err != nil {
		return nil, fmt.Errorf("getColumnDataTypesWithFK: checking card_detail_capitalization column failed: %v", err)
	}

	cardDetailIconExpr := `''::text AS card_detail_icon_svg`
	if hasCardDetailIconSVG {
		cardDetailIconExpr = `COALESCE(scd.card_detail_icon_svg, '') AS card_detail_icon_svg`
	}

	cardDetailIconKeyExpr := `''::varchar AS card_detail_icon_key`
	if hasCardDetailIconKey {
		cardDetailIconKeyExpr = `COALESCE(scd.card_detail_icon_key, '') AS card_detail_icon_key`
	}

	cardDetailLabelModeExpr := `'label'::varchar AS card_detail_label_mode`
	if hasCardDetailLabelMode {
		cardDetailLabelModeExpr = `COALESCE(scd.card_detail_label_mode, 'label') AS card_detail_label_mode`
	}
	cardDetailCapitalizationExpr := `TRUE AS card_detail_capitalization`
	if hasCardDetailCapitalization {
		cardDetailCapitalizationExpr = `COALESCE(scd.card_detail_capitalization, true) AS card_detail_capitalization`
	}

	query := fmt.Sprintf(`
        SELECT
            c.column_name,
            c.data_type,
            fk_info.foreign_table_name,
            fk_info.foreign_column_name,
            COALESCE(scd.card_element, '') AS card_element,
            COALESCE(scd.show_key_on_card, false)  AS show_key_on_card,
            COALESCE(scd.show_value_on_card, false) AS show_value_on_card,
            COALESCE(scd.hide_in_filter_panel, false) AS hide_in_filter_panel,
            COALESCE(scd.hide_everywhere, false) AS hide_everywhere,
            COALESCE(scd.hide_on_small_card, false) AS hide_on_small_card,
            COALESCE(scd.hide_false_null_on_sml_crd, false) AS hide_false_null_on_sml_crd,
            COALESCE(scd.hide_false_null_on_big_crd, false) AS hide_false_null_on_big_crd,
            COALESCE(scd.hide_on_bg_crd_if_not_own, false) AS hide_on_bg_crd_if_not_own,
            COALESCE(scd.co_number, 0) AS co_number,
            COALESCE(scd.fco_number, scd.co_number, 0) AS fco_number,
            COALESCE(scd.is_multilingual, false) AS is_multilingual,
            %s,
            %s,
            %s,
            %s
        FROM information_schema.columns c
        LEFT JOIN (
            SELECT
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM
                information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_name = $1
              AND tc.table_schema = 'public'
        ) AS fk_info
          ON c.column_name = fk_info.column_name
          AND c.table_name = $1
          AND c.table_schema = 'public'
        LEFT JOIN system_column_details scd
          ON scd.column_name = c.column_name
          AND scd.table_uid = (
               SELECT table_uid
               FROM system_db_tables
               WHERE table_name = $1
          )
        WHERE c.table_name = $1
          AND c.table_schema = 'public'
          AND COALESCE(scd.hide_everywhere, false) = false
          AND c.column_name NOT IN ('embedding_vector', 'search_vector_simple')
    `, cardDetailIconExpr, cardDetailIconKeyExpr, cardDetailCapitalizationExpr, cardDetailLabelModeExpr)
	rows, err := db.Query(query, tableName)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, fmt.Errorf("getColumnDataTypesWithFK: %v", err)
	}
	defer rows.Close()

	data_types := make(map[string]interface{})
	for rows.Next() {
		var columnName, dataType string
		var foreignTableName, foreignColumnName sql.NullString
		var cardElement string
		var showKeyOnCard, showValueOnCard, hideInFilterPanel, hideEverywhere bool
		var hideOnSmallCard, hideFalseNullOnSmlCrd, hideFalseNullOnBigCrd, hideOnBgCrdIfNotOwn bool
		var coNumber int
		var fcoNumber int
		var isMultilingual bool
		var cardDetailIconSVG string
		var cardDetailIconKey string
		var cardDetailCapitalization bool
		var cardDetailLabelMode string

		if err := rows.Scan(
			&columnName,
			&dataType,
			&foreignTableName,
			&foreignColumnName,
			&cardElement,
			&showKeyOnCard,
			&showValueOnCard,
			&hideInFilterPanel,
			&hideEverywhere,
			&hideOnSmallCard,
			&hideFalseNullOnSmlCrd,
			&hideFalseNullOnBigCrd,
			&hideOnBgCrdIfNotOwn,
			&coNumber,
			&fcoNumber,
			&isMultilingual,
			&cardDetailIconSVG,
			&cardDetailIconKey,
			&cardDetailCapitalization,
			&cardDetailLabelMode,
		); err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			return nil, fmt.Errorf("getColumnDataTypesWithFK: %v", err)
		}

		columnInfo := map[string]interface{}{
			"data_type":                  dataType,
			"card_element":               cardElement,
			"show_key_on_card":           showKeyOnCard,
			"show_value_on_card":         showValueOnCard,
			"hide_in_filter_panel":       hideInFilterPanel,
			"hide_everywhere":            hideEverywhere,
			"hide_on_small_card":         hideOnSmallCard,
			"hide_false_null_on_sml_crd": hideFalseNullOnSmlCrd,
			"hide_false_null_on_big_crd": hideFalseNullOnBigCrd,
			"hide_on_bg_crd_if_not_own":  hideOnBgCrdIfNotOwn,
			"co_number":                  coNumber,
			"fco_number":                 fcoNumber,
			"is_multilingual":            isMultilingual,
			"card_detail_icon_svg":       cardDetailIconSVG,
			"card_detail_icon_key":       cardDetailIconKey,
			"card_detail_capitalization": cardDetailCapitalization,
			"card_detail_label_mode":     normalizeCardDetailLabelMode(cardDetailLabelMode),
		}
		if foreignTableName.Valid && foreignColumnName.Valid {
			columnInfo["foreign_table"] = foreignTableName.String
			columnInfo["foreign_column"] = foreignColumnName.String
		}

		data_types[columnName] = columnInfo
	}
	if err := rows.Err(); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, fmt.Errorf("getColumnDataTypesWithFK, rows error: %v", err)
	}

	data_types = enrichServiceCatalogModerationDataTypes(tableName, data_types)

	fmt.Printf("\033[36m[getColumnDataTypesWithFK] column data for table '%s' loaded successfully.\033[0m\n", tableName)
	return data_types, nil
}

func fetchTableReadMeta(db *sql.DB, tableName string) (dtt_models.TableReadMeta, error) {
	meta := dtt_models.TableReadMeta{
		CardDetailsLayout: "conditional_multiline",
		CardStyleVariant:  "standard",
	}

	hasCardDetailsLayout, err := columnExistsInTable(db, "system_db_tables", "card_details_layout")
	if err != nil {
		return meta, fmt.Errorf("fetchTableReadMeta: checking card_details_layout column failed: %v", err)
	}
	hasCardStyleVariant, err := columnExistsInTable(db, "system_db_tables", "card_style_variant")
	if err != nil {
		return meta, fmt.Errorf("fetchTableReadMeta: checking card_style_variant column failed: %v", err)
	}
	if !hasCardDetailsLayout && !hasCardStyleVariant {
		return meta, nil
	}

	cardDetailsLayoutExpr := `'conditional_multiline'::varchar AS card_details_layout`
	if hasCardDetailsLayout {
		cardDetailsLayoutExpr = `COALESCE(card_details_layout, 'conditional_multiline') AS card_details_layout`
	}

	cardStyleVariantExpr := `'standard'::varchar AS card_style_variant`
	if hasCardStyleVariant {
		cardStyleVariantExpr = `COALESCE(card_style_variant, 'standard') AS card_style_variant`
	}

	var layout sql.NullString
	var styleVariant sql.NullString
	err = db.QueryRow(fmt.Sprintf(`
		SELECT %s, %s
		FROM system_db_tables
		WHERE table_name = $1
		LIMIT 1
	`, cardDetailsLayoutExpr, cardStyleVariantExpr), tableName).Scan(&layout, &styleVariant)
	if err == sql.ErrNoRows {
		return meta, nil
	}
	if err != nil {
		return meta, err
	}

	meta.CardDetailsLayout = normalizeCardDetailsLayout(layout.String)
	meta.CardStyleVariant = normalizeCardStyleVariant(styleVariant.String)
	return meta, nil
}

// buildColumnsByName on apufunktio, joka luo "colName -> ColumnInfo"
func buildColumnsByName(colsMap map[int]dtt_models.ColumnInfo) map[string]dtt_models.ColumnInfo {
	byName := make(map[string]dtt_models.ColumnInfo)
	for _, ci := range colsMap {
		byName[ci.ColumnName] = ci
	}
	return byName
}

// resolveOwnerColumn resolves the ownership column used by legacy row-visibility policies.
// It exists as the compatibility wrapper for older call sites that only need the column name.
func resolveOwnerColumn(db dbutils.Querier, tableName string) (string, error) {
	resolution, err := resolveOwnerColumnWithSource(db, tableName)
	if err != nil {
		return "", err
	}
	return resolution.Column, nil
}

// resolveOwnerColumnWithSource prefers explicit row-policy metadata and records when legacy fallback was used.
// It exists between table metadata and ReadRowPolicy so the migration can move away from inferred ownership safely.
func resolveOwnerColumnWithSource(db dbutils.Querier, tableName string) (ownerColumnResolution, error) {
	explicitOwnerColumn, err := fetchExplicitRowPolicyOwnerColumn(db, tableName)
	if err != nil {
		return ownerColumnResolution{}, err
	}

	columnNames, err := fetchTableColumnNameSet(db, tableName)
	if err != nil {
		return ownerColumnResolution{}, err
	}

	resolution := resolveOwnerColumnWithLegacyShadow(explicitOwnerColumn, columnNames)
	if strings.TrimSpace(explicitOwnerColumn) != "" && resolution.Source != ownerColumnSourceExplicitMetadata {
		log.Printf("\033[33mwarning: row policy owner column %q for table %s does not exist; using legacy owner fallback %q\033[0m", explicitOwnerColumn, tableName, resolution.Column)
	}
	if resolution.Source == ownerColumnSourceExplicitMetadata &&
		resolution.ComparedWithLegacyFallback &&
		!resolution.MatchesLegacyFallback {
		log.Printf("[row-policy-owner-shadow] table %s uses explicit owner column %q; legacy fallback would use %q",
			tableName,
			resolution.Column,
			resolution.LegacyFallbackColumn,
		)
	}
	return resolution, nil
}

// fetchExplicitRowPolicyOwnerColumn reads the optional table-level owner-column metadata when the schema supports it.
// It exists so databases that have not run the migration still use the exact legacy fallback behavior.
func fetchExplicitRowPolicyOwnerColumn(db dbutils.Querier, tableName string) (string, error) {
	hasOwnerColumnMetadata, err := columnExistsInTable(db, "system_db_tables", rowPolicyOwnerColumnMetadataColumn)
	if err != nil {
		return "", err
	}
	if !hasOwnerColumnMetadata {
		return "", nil
	}

	var ownerColumn sql.NullString
	err = db.QueryRow(`
		SELECT row_policy_owner_column
		FROM system_db_tables
		WHERE table_name = $1
		LIMIT 1
	`, tableName).Scan(&ownerColumn)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !ownerColumn.Valid {
		return "", nil
	}
	return strings.TrimSpace(ownerColumn.String), nil
}

// fetchTableColumnNameSet returns public column names for owner-column validation.
// It exists so explicit metadata can only become active when it names a real column on the dataset table.
func fetchTableColumnNameSet(db dbutils.Querier, tableName string) (map[string]bool, error) {
	rows, err := db.Query(`
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = $1
	`, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columnNames := make(map[string]bool)
	for rows.Next() {
		var columnName string
		if err := rows.Scan(&columnName); err != nil {
			return nil, err
		}
		columnNames[columnName] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return columnNames, nil
}

// resolveOwnerColumnFromMetadata chooses the explicit owner column first, then the legacy fallback order.
// It exists as a pure selection helper so tests can lock down migration behavior without a live database.
func resolveOwnerColumnFromMetadata(explicitOwnerColumn string, columnNames map[string]bool) ownerColumnResolution {
	explicitOwnerColumn = strings.TrimSpace(explicitOwnerColumn)
	if explicitOwnerColumn != "" && columnNames[explicitOwnerColumn] {
		return ownerColumnResolution{
			Column: explicitOwnerColumn,
			Source: ownerColumnSourceExplicitMetadata,
		}
	}

	ownerCandidates := []string{"created_by", "user_id", "id"}
	for _, candidate := range ownerCandidates {
		if columnNames[candidate] {
			return ownerColumnResolution{
				Column: candidate,
				Source: ownerColumnSourceLegacyFallback,
			}
		}
	}
	return ownerColumnResolution{}
}

// resolveOwnerColumnWithLegacyShadow records the old inferred owner column next to the active resolution.
// It lets all_flags_true_unless_owner compare explicit metadata with legacy behavior without changing SQL predicates.
func resolveOwnerColumnWithLegacyShadow(explicitOwnerColumn string, columnNames map[string]bool) ownerColumnResolution {
	resolution := resolveOwnerColumnFromMetadata(explicitOwnerColumn, columnNames)
	legacyResolution := resolveOwnerColumnFromMetadata("", columnNames)

	resolution.LegacyFallbackColumn = legacyResolution.Column
	resolution.MatchesLegacyFallback = resolution.Column == legacyResolution.Column
	resolution.ComparedWithLegacyFallback = resolution.Column != "" || legacyResolution.Column != ""
	return resolution
}

// getMustBeTrueColumns returns legacy must_be_true_unless_own columns and the resolved owner column.
// It exists as a compatibility wrapper for callers that do not need owner metadata provenance.
func getMustBeTrueColumns(db dbutils.Querier, tableName string) ([]string, string, error) {
	mustTrueCols, ownerResolution, err := getMustBeTrueColumnsWithOwnerResolution(db, tableName)
	if err != nil {
		return nil, "", err
	}
	return mustTrueCols, ownerResolution.Column, nil
}

// getMustBeTrueColumnsWithOwnerResolution returns legacy flag columns plus explicit/fallback owner provenance.
// It exists so ReadRowPolicy can prefer explicit owner metadata while preserving old table behavior.
func getMustBeTrueColumnsWithOwnerResolution(db dbutils.Querier, tableName string) ([]string, ownerColumnResolution, error) {
	query := `
        SELECT scd.column_name
        FROM system_db_tables sdt
        JOIN system_column_details scd ON sdt.table_uid = scd.table_uid
        WHERE sdt.table_name = $1
          AND scd.must_be_true_unless_own = true
    `
	rows, err := db.Query(query, tableName)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, ownerColumnResolution{}, err
	}
	defer rows.Close()

	var mustTrueCols []string
	for rows.Next() {
		var colName string
		if err := rows.Scan(&colName); err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			continue
		}
		mustTrueCols = append(mustTrueCols, colName)
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, ownerColumnResolution{}, err
	}

	if len(mustTrueCols) == 0 {
		return mustTrueCols, ownerColumnResolution{}, nil
	}

	ownerResolution, err := resolveOwnerColumnWithSource(db, tableName)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, ownerColumnResolution{}, err
	}

	return mustTrueCols, ownerResolution, nil
}
