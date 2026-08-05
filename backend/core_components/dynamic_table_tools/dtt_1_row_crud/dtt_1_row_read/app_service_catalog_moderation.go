// app_service_catalog_moderation.go
// Enriches service catalog read payloads with moderation fields for actors who may inspect them.
// Bridges the RLS pilot's hidden moderation columns and the big-card/card-edit UX without exposing SQL.
// Exists so admins can review moderation flags, owners can inspect their own row state, and other actors do not receive those fields.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"

	dbutils "easelect/backend/core_components/dbutils"

	"github.com/lib/pq"
)

const serviceCatalogModerationTableName = "app_service_catalog"

var serviceCatalogModerationColumns = []string{
	"published",
	"enabled",
	"admin_reviewed",
	"admin_approved",
}

type serviceCatalogModerationRecord struct {
	OwnerUserID int64
	Values      map[string]interface{}
}

var serviceCatalogModerationReader = readServiceCatalogModerationRecords

func shouldApplyServiceCatalogModerationOverlay(tableName string) bool {
	return tableName == serviceCatalogModerationTableName
}

func enrichServiceCatalogModerationRows(
	readQuerier dbutils.Querier,
	tableName string,
	rows []map[string]interface{},
	userRole string,
	userID int,
) error {
	if !shouldApplyServiceCatalogModerationOverlay(tableName) || len(rows) == 0 {
		return nil
	}

	rowIDs := collectCardSupportRowIDs(rows)
	if len(rowIDs) == 0 {
		return nil
	}

	recordsByID, err := serviceCatalogModerationReader(readQuerier, rowIDs)
	if err != nil {
		return err
	}

	for _, row := range rows {
		rowID, ok := coerceCardSupportRowID(row["id"])
		if !ok {
			removeServiceCatalogModerationColumns(row)
			continue
		}

		record, exists := recordsByID[rowID]
		if !exists {
			removeServiceCatalogModerationColumns(row)
			continue
		}

		if userRole != "admin" && int(record.OwnerUserID) != userID {
			removeServiceCatalogModerationColumns(row)
			continue
		}

		for _, columnName := range serviceCatalogModerationColumns {
			row[columnName] = record.Values[columnName]
		}
	}

	return nil
}

func appendServiceCatalogModerationColumns(
	tableName string,
	columns []string,
	rows []map[string]interface{},
	userRole string,
) []string {
	if !shouldApplyServiceCatalogModerationOverlay(tableName) {
		return columns
	}

	shouldExposeColumns := userRole == "admin"
	if !shouldExposeColumns {
		for _, row := range rows {
			for _, columnName := range serviceCatalogModerationColumns {
				if _, exists := row[columnName]; exists {
					shouldExposeColumns = true
					break
				}
			}
			if shouldExposeColumns {
				break
			}
		}
	}
	if !shouldExposeColumns {
		return columns
	}

	existing := make(map[string]bool, len(columns))
	for _, columnName := range columns {
		existing[columnName] = true
	}

	result := append([]string{}, columns...)
	for _, columnName := range serviceCatalogModerationColumns {
		if existing[columnName] {
			continue
		}
		result = append(result, columnName)
	}

	return result
}

func readServiceCatalogModerationRecords(
	readQuerier dbutils.Querier,
	rowIDs []int64,
) (map[int64]serviceCatalogModerationRecord, error) {
	if readQuerier == nil || len(rowIDs) == 0 {
		return map[int64]serviceCatalogModerationRecord{}, nil
	}

	rows, err := readQuerier.Query(
		`
		SELECT
			id,
			COALESCE(user_id, 0) AS user_id,
			COALESCE(published, false) AS published,
			COALESCE(enabled, false) AS enabled,
			COALESCE(admin_reviewed, false) AS admin_reviewed,
			COALESCE(admin_approved, false) AS admin_approved
		FROM app_service_catalog
		WHERE id = ANY($1::bigint[])
		`,
		pq.Array(rowIDs),
	)
	if err != nil {
		return nil, fmt.Errorf("error reading service catalog moderation fields: %w", err)
	}
	defer rows.Close()

	records := make(map[int64]serviceCatalogModerationRecord, len(rowIDs))
	for rows.Next() {
		var (
			rowID         int64
			ownerUserID   sql.NullInt64
			published     sql.NullBool
			enabled       sql.NullBool
			adminReviewed sql.NullBool
			adminApproved sql.NullBool
		)
		if err := rows.Scan(&rowID, &ownerUserID, &published, &enabled, &adminReviewed, &adminApproved); err != nil {
			return nil, fmt.Errorf("error scanning service catalog moderation fields: %w", err)
		}

		records[rowID] = serviceCatalogModerationRecord{
			OwnerUserID: ownerUserID.Int64,
			Values: map[string]interface{}{
				"published":      published.Valid && published.Bool,
				"enabled":        enabled.Valid && enabled.Bool,
				"admin_reviewed": adminReviewed.Valid && adminReviewed.Bool,
				"admin_approved": adminApproved.Valid && adminApproved.Bool,
			},
		}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating service catalog moderation fields: %w", err)
	}

	return records, nil
}

func removeServiceCatalogModerationColumns(row map[string]interface{}) {
	if row == nil {
		return
	}
	for _, columnName := range serviceCatalogModerationColumns {
		delete(row, columnName)
	}
}

func enrichServiceCatalogModerationDataTypes(
	tableName string,
	dataTypes map[string]interface{},
) map[string]interface{} {
	if !shouldApplyServiceCatalogModerationOverlay(tableName) || dataTypes == nil {
		return dataTypes
	}

	enrichedDataTypes := cloneServiceCatalogModerationDataTypes(dataTypes)
	for _, columnName := range serviceCatalogModerationColumns {
		columnInfo := map[string]interface{}{
			"data_type":                  "boolean",
			"card_element":               "details",
			"show_key_on_card":           true,
			"show_value_on_card":         true,
			"hide_in_filter_panel":       true,
			"hide_everywhere":            false,
			"hide_on_small_card":         true,
			"hide_false_null_on_sml_crd": false,
			"hide_false_null_on_big_crd": false,
			"hide_on_bg_crd_if_not_own":  false,
			"co_number":                  0,
			"fco_number":                 0,
			"is_multilingual":            false,
			"card_detail_icon_svg":       "",
			"card_detail_icon_key":       "",
			"card_detail_label_mode":     "label",
		}

		if existing, ok := enrichedDataTypes[columnName].(map[string]interface{}); ok {
			for key, value := range existing {
				columnInfo[key] = value
			}
		}

		columnInfo["card_element"] = "details"
		columnInfo["show_key_on_card"] = true
		columnInfo["show_value_on_card"] = true
		columnInfo["hide_in_filter_panel"] = true
		columnInfo["hide_everywhere"] = false
		columnInfo["hide_on_small_card"] = true
		enrichedDataTypes[columnName] = columnInfo
	}

	return enrichedDataTypes
}

func cloneServiceCatalogModerationDataTypes(dataTypes map[string]interface{}) map[string]interface{} {
	if dataTypes == nil {
		return nil
	}
	cloned := make(map[string]interface{}, len(dataTypes)+len(serviceCatalogModerationColumns))
	for columnName, columnInfo := range dataTypes {
		cloned[columnName] = columnInfo
	}
	return cloned
}
