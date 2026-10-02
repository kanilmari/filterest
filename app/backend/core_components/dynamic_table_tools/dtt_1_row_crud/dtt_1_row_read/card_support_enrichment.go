// card_support_enrichment.go
// Enriches get-results rows with hidden card-support fields such as cached images.
// Bridges the normal visible-column query and the card renderer without exposing support columns to table layouts.
// Exists so card view can keep using compact visible-column presets while still receiving media fields.
package dtt_1_row_read

import (
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"

	"github.com/lib/pq"
)

type canonicalAssetImageValue struct {
	filename     string
	typeID       int64
	metadataJSON string
	title        string
	originalName string
}

func collectHiddenCardSupportColumns(
	columnsMap map[int]dtt_models.ColumnInfo,
	visibleColumns []string,
) []string {
	if len(columnsMap) == 0 {
		return nil
	}

	visibleSet := make(map[string]bool, len(visibleColumns))
	for _, columnName := range visibleColumns {
		visibleSet[columnName] = true
	}

	type orderedSupportColumn struct {
		name     string
		coNumber int
	}

	supportColumns := make([]orderedSupportColumn, 0)
	for _, colInfo := range columnsMap {
		if visibleSet[colInfo.ColumnName] {
			continue
		}
		if !strings.Contains(strings.ToLower(strings.TrimSpace(colInfo.CardElement)), "image") {
			continue
		}
		supportColumns = append(supportColumns, orderedSupportColumn{
			name:     colInfo.ColumnName,
			coNumber: colInfo.CoNumber,
		})
	}

	sort.SliceStable(supportColumns, func(i, j int) bool {
		if supportColumns[i].coNumber == supportColumns[j].coNumber {
			return supportColumns[i].name < supportColumns[j].name
		}
		return supportColumns[i].coNumber < supportColumns[j].coNumber
	})

	resolved := make([]string, 0, len(supportColumns))
	for _, column := range supportColumns {
		resolved = append(resolved, column.name)
	}
	return resolved
}

func appendHiddenCardSupportColumnUIDs(
	columnsMap map[int]dtt_models.ColumnInfo,
	visibleColumns []string,
	visibleColUIDs []int,
) ([]int, []string) {
	supportColumns := collectHiddenCardSupportColumns(columnsMap, visibleColumns)
	if len(supportColumns) == 0 {
		return visibleColUIDs, nil
	}

	augmentedUIDs := append([]int(nil), visibleColUIDs...)
	addedColumns := make([]string, 0, len(supportColumns))
	seenUIDs := make(map[int]bool, len(visibleColUIDs))
	for _, uid := range visibleColUIDs {
		seenUIDs[uid] = true
	}

	for _, columnName := range supportColumns {
		for uid, colInfo := range columnsMap {
			if colInfo.ColumnName != columnName || seenUIDs[uid] {
				continue
			}
			augmentedUIDs = append(augmentedUIDs, uid)
			addedColumns = append(addedColumns, columnName)
			seenUIDs[uid] = true
			break
		}
	}

	return augmentedUIDs, addedColumns
}

func filterCardSupportColumnsFromResultColumns(resultColumns []string, hiddenSupportColumns []string) []string {
	if len(resultColumns) == 0 || len(hiddenSupportColumns) == 0 {
		return resultColumns
	}

	hiddenSet := make(map[string]bool, len(hiddenSupportColumns))
	for _, columnName := range hiddenSupportColumns {
		if columnName == "" {
			continue
		}
		hiddenSet[columnName] = true
	}

	filteredColumns := make([]string, 0, len(resultColumns))
	for _, columnName := range resultColumns {
		if hiddenSet[columnName] {
			continue
		}
		filteredColumns = append(filteredColumns, columnName)
	}

	return filteredColumns
}

func rowsAlreadyContainCardSupportColumns(rows []map[string]interface{}, supportColumns []string) bool {
	if len(rows) == 0 || len(supportColumns) == 0 {
		return false
	}

	for _, row := range rows {
		if row == nil {
			return false
		}
		for _, columnName := range supportColumns {
			if _, exists := row[columnName]; !exists {
				return false
			}
		}
	}

	return true
}

func enrichRowsWithCardSupportColumns(
	readQuerier dbutils.Querier,
	tableName string,
	rows []map[string]interface{},
	columnsMap map[int]dtt_models.ColumnInfo,
	visibleColumns []string,
) error {
	if len(rows) == 0 {
		return nil
	}

	supportColumns := collectHiddenCardSupportColumns(columnsMap, visibleColumns)
	if len(supportColumns) == 0 {
		var err error
		supportColumns, err = fetchCardSupportColumnsFromMetadata(tableName, visibleColumns)
		if err != nil {
			return err
		}
	}

	rowIDs := collectCardSupportRowIDs(rows)
	if len(rowIDs) == 0 {
		return nil
	}

	if !rowsAlreadyContainCardSupportColumns(rows, supportColumns) {
		formattedSupportRows, err := fetchCardSupportRows(readQuerier, tableName, supportColumns, rowIDs)
		if err != nil && backend.Db != nil {
			formattedSupportRows, err = fetchCardSupportRows(backend.Db, tableName, supportColumns, rowIDs)
		}
		if err != nil {
			return err
		}

		supportByID := make(map[string]map[string]interface{}, len(formattedSupportRows))
		for _, supportRow := range formattedSupportRows {
			supportByID[fmt.Sprint(supportRow["id"])] = supportRow
		}

		for _, row := range rows {
			supportRow, ok := supportByID[fmt.Sprint(row["id"])]
			if !ok {
				continue
			}
			for _, columnName := range supportColumns {
				if value, exists := supportRow[columnName]; exists {
					row[columnName] = value
				}
			}
		}
	}

	missingRowIDs := collectRowsMissingCardImageValues(rows, supportColumns)
	if len(missingRowIDs) == 0 {
		return nil
	}

	if err := enrichRowsWithCanonicalAssetImages(readQuerier, tableName, rows, missingRowIDs); err != nil {
		return err
	}

	missingRowIDs = collectRowsMissingCardImageValues(rows, supportColumns)
	if len(missingRowIDs) == 0 {
		return nil
	}

	// Repo-wide shared-asset migration means read-side card support should stop
	// probing table-specific image child tables here. Remaining image support is now
	// expected to come from `cached_image` or canonical shared `_assets` rows.
	return nil
}

func fetchCardSupportColumnsFromMetadata(tableName string, visibleColumns []string) ([]string, error) {
	if backend.Db == nil {
		return nil, nil
	}

	rows, err := backend.Db.Query(
		`SELECT scd.column_name
		   FROM system_db_tables sdt
		   JOIN system_column_details scd ON scd.table_uid = sdt.table_uid
		  WHERE sdt.table_name = $1
		    AND COALESCE(scd.hide_everywhere, false) = false
		    AND COALESCE(scd.client_delivery_mode, 'include') = 'include'
		    AND COALESCE(scd.show_value_on_card, false) = true
		    AND scd.card_element ILIKE '%image%'
		  ORDER BY scd.co_number, scd.column_name`,
		tableName,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	visibleSet := make(map[string]bool, len(visibleColumns))
	for _, columnName := range visibleColumns {
		visibleSet[columnName] = true
	}

	supportColumns := make([]string, 0)
	for rows.Next() {
		var columnName string
		if scanErr := rows.Scan(&columnName); scanErr != nil {
			return nil, scanErr
		}
		if visibleSet[columnName] {
			continue
		}
		supportColumns = append(supportColumns, columnName)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return supportColumns, nil
}

func fetchCardSupportRows(
	querier dbutils.Querier,
	tableName string,
	supportColumns []string,
	rowIDs []int64,
) ([]map[string]interface{}, error) {
	if querier == nil || len(supportColumns) == 0 || len(rowIDs) == 0 {
		return nil, nil
	}

	selectParts := make([]string, 0, len(supportColumns)+1)
	selectParts = append(
		selectParts,
		fmt.Sprintf(`%s.%s AS %s`, pq.QuoteIdentifier(tableName), pq.QuoteIdentifier("id"), pq.QuoteIdentifier("id")),
	)
	for _, columnName := range supportColumns {
		selectParts = append(
			selectParts,
			fmt.Sprintf(
				`%s.%s AS %s`,
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(columnName),
				pq.QuoteIdentifier(columnName),
			),
		)
	}

	placeholders := make([]string, 0, len(rowIDs))
	queryArgs := make([]interface{}, 0, len(rowIDs))
	for idx, rowID := range rowIDs {
		placeholders = append(placeholders, fmt.Sprintf("$%d", idx+1))
		queryArgs = append(queryArgs, rowID)
	}

	query := fmt.Sprintf(
		`SELECT %s FROM %s WHERE %s.%s IN (%s)`,
		strings.Join(selectParts, ", "),
		pq.QuoteIdentifier(tableName),
		pq.QuoteIdentifier(tableName),
		pq.QuoteIdentifier("id"),
		strings.Join(placeholders, ", "),
	)

	supportRows, err := querier.Query(query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer supportRows.Close()

	_, formattedSupportRows, err := FormatRowsToMaps(supportRows)
	if err != nil {
		return nil, err
	}

	return formattedSupportRows, nil
}

func enrichRowsWithCanonicalAssetImages(
	querier dbutils.Querier,
	parentTable string,
	rows []map[string]interface{},
	rowIDs []int64,
) error {
	if len(rows) == 0 || len(rowIDs) == 0 {
		return nil
	}

	relation, err := dtt_card_picture.PictureRelationOf(querier, parentTable)
	if (relation == nil || err != nil) && backend.Db != nil {
		fallbackRelation, fallbackErr := dtt_card_picture.PictureRelationOf(backend.Db, parentTable)
		if fallbackErr == nil && fallbackRelation != nil {
			relation = fallbackRelation
			err = nil
		} else if err == nil {
			err = fallbackErr
		}
	}
	if err != nil || relation == nil {
		return err
	}

	imageByID, err := fetchCanonicalAssetImageValues(querier, *relation, rowIDs)
	if (len(imageByID) == 0 || err != nil) && backend.Db != nil {
		fallbackImages, fallbackErr := fetchCanonicalAssetImageValues(backend.Db, *relation, rowIDs)
		if fallbackErr == nil && len(fallbackImages) > 0 {
			imageByID = fallbackImages
			err = nil
		} else if err == nil {
			err = fallbackErr
		}
	}
	if err != nil {
		return err
	}

	applyLegacyChildImageValues(rows, imageByID)
	return nil
}

// fetchCanonicalAssetImageValues reads, per parent row, the gallery's first picture in
// the one gallery order (dtt_card_picture.GalleryOrderClause): the read-time stand-in
// for a card whose stored picture is still empty.
func fetchCanonicalAssetImageValues(
	querier dbutils.Querier,
	relation dtt_card_picture.PictureRelation,
	rowIDs []int64,
) (map[string]canonicalAssetImageValue, error) {
	if querier == nil || relation.ChildTable == "" || relation.ForeignKey == "" || relation.FilenameColumn == "" || len(rowIDs) == 0 {
		return nil, nil
	}

	placeholders := make([]string, 0, len(rowIDs))
	queryArgs := make([]interface{}, 0, len(rowIDs))
	for idx, rowID := range rowIDs {
		placeholders = append(placeholders, fmt.Sprintf("$%d", idx+1))
		queryArgs = append(queryArgs, rowID)
	}

	orderByParts := []string{
		pq.QuoteIdentifier(relation.ForeignKey),
	}
	if galleryOrder := dtt_card_picture.GalleryOrderClause(relation.Columns, ""); galleryOrder != "" {
		orderByParts = append(orderByParts, galleryOrder)
	}

	typeIDSelect := `0 AS "type_id"`
	if relation.HasTypeID {
		typeIDSelect = `COALESCE("type_id", 0) AS "type_id"`
	}
	metadataJSONSelect := `'' AS "metadata_json"`
	if relation.HasMetadataJSON {
		metadataJSONSelect = `COALESCE("metadata_json"::text, '') AS "metadata_json"`
	}
	titleSelect := `'' AS "title"`
	if relation.HasTitle {
		titleSelect = `COALESCE("title"::text, '') AS "title"`
	}
	originalNameSelect := `'' AS "original_name"`
	if relation.HasOriginalName {
		originalNameSelect = `COALESCE("original_name"::text, '') AS "original_name"`
	}

	query := fmt.Sprintf(
		`SELECT %s, %s, %s, %s, %s, %s
		   FROM %s
		  WHERE %s IN (%s)
		    AND %s`,
		pq.QuoteIdentifier(relation.ForeignKey),
		pq.QuoteIdentifier(relation.FilenameColumn),
		typeIDSelect,
		metadataJSONSelect,
		titleSelect,
		originalNameSelect,
		pq.QuoteIdentifier(relation.ChildTable),
		pq.QuoteIdentifier(relation.ForeignKey),
		strings.Join(placeholders, ", "),
		relation.PictureCondition(""),
	)
	query += fmt.Sprintf(` ORDER BY %s`, strings.Join(orderByParts, ", "))

	rows, err := querier.Query(query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	imageByID := make(map[string]canonicalAssetImageValue)
	for rows.Next() {
		var rawParentID interface{}
		var rawFilename interface{}
		var rawTypeID interface{}
		var rawMetadataJSON interface{}
		var rawTitle interface{}
		var rawOriginalName interface{}
		if scanErr := rows.Scan(
			&rawParentID,
			&rawFilename,
			&rawTypeID,
			&rawMetadataJSON,
			&rawTitle,
			&rawOriginalName,
		); scanErr != nil {
			return nil, scanErr
		}

		parentID, ok := coerceCardSupportRowID(rawParentID)
		if !ok {
			continue
		}

		filename := normalizeCardSupportValue(rawFilename)
		if filename == "" {
			continue
		}

		key := strconv.FormatInt(parentID, 10)
		if _, exists := imageByID[key]; exists {
			continue
		}
		imageByID[key] = canonicalAssetImageValue{
			filename:     filename,
			typeID:       coerceCanonicalAssetTypeID(rawTypeID),
			metadataJSON: normalizeCardSupportValue(rawMetadataJSON),
			title:        normalizeCardSupportValue(rawTitle),
			originalName: normalizeCardSupportValue(rawOriginalName),
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return imageByID, nil
}

func collectRowsMissingCardImageValues(rows []map[string]interface{}, supportColumns []string) []int64 {
	imageKeys := resolveCardImageLookupKeys(supportColumns)
	missing := make([]int64, 0, len(rows))
	seen := make(map[int64]bool, len(rows))

	for _, row := range rows {
		rowID, ok := coerceCardSupportRowID(row["id"])
		if !ok || seen[rowID] {
			continue
		}
		if rowHasMeaningfulCardImageValue(row, imageKeys) && rowHasCardImageAssetCompanionValue(row) {
			continue
		}
		seen[rowID] = true
		missing = append(missing, rowID)
	}

	return missing
}

func resolveCardImageLookupKeys(supportColumns []string) []string {
	merged := make([]string, 0, len(dtt_card_picture.CardPictureFields)+len(supportColumns))
	seen := make(map[string]bool, len(dtt_card_picture.CardPictureFields)+len(supportColumns))

	for _, columnName := range dtt_card_picture.CardPictureFields {
		if columnName == "" || seen[columnName] {
			continue
		}
		seen[columnName] = true
		merged = append(merged, columnName)
	}

	for _, columnName := range supportColumns {
		if columnName == "" || seen[columnName] {
			continue
		}
		seen[columnName] = true
		merged = append(merged, columnName)
	}

	return merged
}

func rowHasMeaningfulCardImageValue(row map[string]interface{}, imageKeys []string) bool {
	if row == nil {
		return false
	}

	for _, key := range imageKeys {
		if hasMeaningfulCardSupportValue(row[key]) {
			return true
		}
	}

	return false
}

func resolveExistingCardImageValue(row map[string]interface{}, imageKeys []string) string {
	if row == nil {
		return ""
	}

	for _, key := range imageKeys {
		value := normalizeCardSupportValue(row[key])
		if value != "" {
			return value
		}
	}

	return ""
}

func rowHasCardImageAssetCompanionValue(row map[string]interface{}) bool {
	if row == nil {
		return false
	}
	_, exists := row["cached_image_type_id"]
	return exists
}

func hasMeaningfulCardSupportValue(rawValue interface{}) bool {
	return normalizeCardSupportValue(rawValue) != ""
}

func normalizeCardSupportValue(rawValue interface{}) string {
	switch typedValue := rawValue.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typedValue)
	case []byte:
		return strings.TrimSpace(string(typedValue))
	default:
		return strings.TrimSpace(fmt.Sprint(rawValue))
	}
}

func coerceCanonicalAssetTypeID(rawValue interface{}) int64 {
	switch typedValue := rawValue.(type) {
	case nil:
		return 0
	case int:
		return int64(typedValue)
	case int32:
		return int64(typedValue)
	case int64:
		return typedValue
	case float64:
		return int64(typedValue)
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(typedValue), 10, 64)
		if err == nil {
			return parsed
		}
	case []byte:
		parsed, err := strconv.ParseInt(strings.TrimSpace(string(typedValue)), 10, 64)
		if err == nil {
			return parsed
		}
	}
	return 0
}

func applyLegacyChildImageValues(rows []map[string]interface{}, imageByID map[string]canonicalAssetImageValue) {
	if len(rows) == 0 || len(imageByID) == 0 {
		return
	}

	imageKeys := resolveCardImageLookupKeys(nil)
	for _, row := range rows {
		rowID, ok := coerceCardSupportRowID(row["id"])
		if !ok {
			continue
		}

		imageValue, exists := imageByID[strconv.FormatInt(rowID, 10)]
		if !exists || imageValue.filename == "" {
			continue
		}

		existingImage := resolveExistingCardImageValue(row, imageKeys)
		if existingImage != "" && !cardImageFilenameMatches(existingImage, imageValue.filename) {
			continue
		}
		if existingImage == "" {
			row["cached_image"] = imageValue.filename
		}
		row["cached_image_type_id"] = imageValue.typeID
		if imageValue.metadataJSON != "" {
			row["cached_image_metadata_json"] = imageValue.metadataJSON
		}
		if imageValue.title != "" {
			row["cached_image_title"] = imageValue.title
		}
		if imageValue.originalName != "" {
			row["cached_image_original_name"] = imageValue.originalName
		}
	}
}

func cardImageFilenameMatches(existingImage string, canonicalFilename string) bool {
	existingImage = strings.TrimSpace(existingImage)
	canonicalFilename = strings.TrimSpace(canonicalFilename)
	if existingImage == "" || canonicalFilename == "" {
		return false
	}
	if existingImage == canonicalFilename {
		return true
	}

	existingParts := strings.Split(strings.Split(existingImage, "?")[0], "/")
	existingBasename := existingParts[len(existingParts)-1]
	return existingBasename == canonicalFilename
}

func collectCardSupportRowIDs(rows []map[string]interface{}) []int64 {
	collected := make([]int64, 0, len(rows))
	seen := make(map[int64]bool, len(rows))

	for _, row := range rows {
		rowID, ok := coerceCardSupportRowID(row["id"])
		if !ok || seen[rowID] {
			continue
		}
		seen[rowID] = true
		collected = append(collected, rowID)
	}

	return collected
}

func coerceCardSupportRowID(rawValue interface{}) (int64, bool) {
	switch typedValue := rawValue.(type) {
	case int:
		return int64(typedValue), true
	case int32:
		return int64(typedValue), true
	case int64:
		return typedValue, true
	case float64:
		return int64(typedValue), true
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(typedValue), 10, 64)
		return parsed, err == nil
	case []byte:
		parsed, err := strconv.ParseInt(strings.TrimSpace(string(typedValue)), 10, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func logCardSupportEnrichmentWarning(tableName string, err error) {
	if err == nil {
		return
	}
	log.Printf(
		"\033[33mwarning: card support enrichment for %s skipped: %s\033[0m\n",
		tableName,
		err.Error(),
	)
}
