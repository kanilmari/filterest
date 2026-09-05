// add_row_existing_links.go
// Resolves and applies existing-row links for the add-row workflow.
// Bridges stable relation identifiers, route permissions, row policies, and SQL writes.
// Exists so the browser never chooses physical table or column names for relation mutations.
package dtt_1_row_create

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"easelect/backend/core_components/permissions"

	"github.com/lib/pq"
)

const (
	existingRelationOneToMany  = "one_to_many"
	existingRelationManyToMany = "many_to_many"
)

type resolvedExistingLink struct {
	Kind                  string
	RelationID            int64
	RelatedTableUID       string
	RelatedTableName      string
	RelatedForeignKey     string
	BridgeTableUID        string
	BridgeTableName       string
	BridgeMainForeignKey  string
	BridgeOtherForeignKey string
	RowIDs                []int64
}

func resolveAndAuthorizeExistingLinks(
	tx *sql.Tx,
	mainTableUID string,
	links []ExistingRelationLinkPayload,
	userID int,
	userRole string,
) ([]resolvedExistingLink, error) {
	resolved := make([]resolvedExistingLink, 0, len(links))
	seenRelations := make(map[string]struct{}, len(links))
	for _, link := range links {
		link.RelationKind = strings.TrimSpace(link.RelationKind)
		for _, rowID := range link.RowIDs {
			if rowID <= 0 {
				return nil, errors.New("invalid existing relation row identifier")
			}
		}
		link.RowIDs = uniquePositiveRowIDs(link.RowIDs)
		if link.RelationID <= 0 || len(link.RowIDs) == 0 {
			return nil, errors.New("invalid existing relation link")
		}
		key := fmt.Sprintf("%s:%d", link.RelationKind, link.RelationID)
		if _, duplicate := seenRelations[key]; duplicate {
			return nil, errors.New("duplicate existing relation link")
		}
		seenRelations[key] = struct{}{}

		var relation resolvedExistingLink
		var err error
		switch link.RelationKind {
		case existingRelationOneToMany:
			relation, err = resolveOneToManyExistingLink(tx, mainTableUID, link)
		case existingRelationManyToMany:
			relation, err = resolveManyToManyExistingLink(tx, mainTableUID, link)
		default:
			return nil, errors.New("unsupported existing relation kind")
		}
		if err != nil {
			return nil, err
		}
		if err := authorizeExistingLink(tx, relation, userID, userRole); err != nil {
			return nil, err
		}
		resolved = append(resolved, relation)
	}
	return resolved, nil
}

func resolveOneToManyExistingLink(
	tx *sql.Tx,
	mainTableUID string,
	link ExistingRelationLinkPayload,
) (resolvedExistingLink, error) {
	var relation resolvedExistingLink
	var targetInsertSpecs sql.NullString
	err := tx.QueryRow(`
		SELECT
			fr.id,
			fr.source_table_uid,
			source_table.table_name,
			fr.source_column_name,
			fr.target_insert_specs
		FROM system_foreign_key_relations_1_m fr
		JOIN system_db_tables source_table
			ON source_table.table_uid = fr.source_table_uid
		WHERE fr.id = $1
			AND fr.target_table_uid = $2
	`, link.RelationID, mainTableUID).Scan(
		&relation.RelationID,
		&relation.RelatedTableUID,
		&relation.RelatedTableName,
		&relation.RelatedForeignKey,
		&targetInsertSpecs,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return relation, errors.New("registered one-to-many relation was not found for this dataset")
		}
		return relation, fmt.Errorf("resolve one-to-many relation: %w", err)
	}
	if uploadEnabledInTargetSpecs(targetInsertSpecs.String) {
		return relation, errors.New("asset relations cannot use link-existing")
	}
	relation.Kind = existingRelationOneToMany
	relation.RowIDs = link.RowIDs
	return relation, nil
}

func resolveManyToManyExistingLink(
	tx *sql.Tx,
	mainTableUID string,
	link ExistingRelationLinkPayload,
) (resolvedExistingLink, error) {
	var relation resolvedExistingLink
	err := tx.QueryRow(`
		SELECT
			fr.id,
			fr.bridging_table_uid,
			bridge_table.table_name,
			CASE WHEN fr.table_a_uid = $2 THEN fr.bridging_col_a ELSE fr.bridging_col_b END,
			CASE WHEN fr.table_a_uid = $2 THEN fr.table_b_uid ELSE fr.table_a_uid END,
			CASE WHEN fr.table_a_uid = $2 THEN table_b.table_name ELSE table_a.table_name END,
			CASE WHEN fr.table_a_uid = $2 THEN fr.bridging_col_b ELSE fr.bridging_col_a END
		FROM system_foreign_key_relations_m_m fr
		JOIN system_db_tables bridge_table ON bridge_table.table_uid = fr.bridging_table_uid
		JOIN system_db_tables table_a ON table_a.table_uid = fr.table_a_uid
		JOIN system_db_tables table_b ON table_b.table_uid = fr.table_b_uid
		WHERE fr.id = $1
			AND (fr.table_a_uid = $2 OR fr.table_b_uid = $2)
	`, link.RelationID, mainTableUID).Scan(
		&relation.RelationID,
		&relation.BridgeTableUID,
		&relation.BridgeTableName,
		&relation.BridgeMainForeignKey,
		&relation.RelatedTableUID,
		&relation.RelatedTableName,
		&relation.BridgeOtherForeignKey,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return relation, errors.New("registered many-to-many relation was not found for this dataset")
		}
		return relation, fmt.Errorf("resolve many-to-many relation: %w", err)
	}
	relation.Kind = existingRelationManyToMany
	relation.RowIDs = link.RowIDs
	return relation, nil
}

func authorizeExistingLink(
	tx *sql.Tx,
	relation resolvedExistingLink,
	userID int,
	userRole string,
) error {
	if relation.Kind == existingRelationOneToMany {
		allowed, err := hasStrictTableRoutePermission(
			tx,
			"/api/update-row",
			userID,
			relation.RelatedTableName,
			relation.RelatedTableUID,
		)
		if err != nil {
			return fmt.Errorf("check related-row update permission: %w", err)
		}
		if !allowed {
			return &forbiddenError{msg: "existing related rows cannot be updated by this actor"}
		}
		visible, err := dtt_1_row_read.LockRowsVisibleForMutation(
			tx,
			relation.RelatedTableName,
			userRole,
			userID,
			relation.RowIDs,
		)
		if err != nil {
			return err
		}
		if !visible {
			return &forbiddenError{msg: "one or more related rows are unavailable for update"}
		}
		return requireUnlinkedRows(tx, relation)
	}

	readAllowed, err := hasStrictTableRoutePermission(
		tx,
		"/api/get-results",
		userID,
		relation.RelatedTableName,
		relation.RelatedTableUID,
	)
	if err != nil {
		return fmt.Errorf("check related-row read permission: %w", err)
	}
	bridgeAllowed, err := hasStrictTableRoutePermission(
		tx,
		"/api/add-row-multipart",
		userID,
		relation.BridgeTableName,
		relation.BridgeTableUID,
	)
	if err != nil {
		return fmt.Errorf("check bridge create permission: %w", err)
	}
	if !readAllowed || !bridgeAllowed {
		return &forbiddenError{msg: "existing relation link is not allowed for this actor"}
	}
	visible, err := dtt_1_row_read.RowsVisibleForRead(
		tx,
		relation.RelatedTableName,
		userRole,
		userID,
		relation.RowIDs,
	)
	if err != nil {
		return err
	}
	if !visible {
		return &forbiddenError{msg: "one or more related rows are unavailable for read"}
	}
	return nil
}

func requireUnlinkedRows(tx *sql.Tx, relation resolvedExistingLink) error {
	query := fmt.Sprintf(
		"SELECT COUNT(*) FROM %s WHERE %s = ANY($1) AND %s IS NULL",
		pq.QuoteIdentifier(relation.RelatedTableName),
		pq.QuoteIdentifier("id"),
		pq.QuoteIdentifier(relation.RelatedForeignKey),
	)
	var count int
	if err := tx.QueryRow(query, pq.Array(relation.RowIDs)).Scan(&count); err != nil {
		return fmt.Errorf("check unlinked related rows: %w", err)
	}
	if count != len(relation.RowIDs) {
		return errors.New("one or more related rows are already linked")
	}
	return nil
}

func applyExistingLinks(tx *sql.Tx, mainRowID int64, links []resolvedExistingLink) error {
	for _, relation := range links {
		switch relation.Kind {
		case existingRelationOneToMany:
			query := fmt.Sprintf(
				"UPDATE %s SET %s = $1 WHERE %s = ANY($2) AND %s IS NULL",
				pq.QuoteIdentifier(relation.RelatedTableName),
				pq.QuoteIdentifier(relation.RelatedForeignKey),
				pq.QuoteIdentifier("id"),
				pq.QuoteIdentifier(relation.RelatedForeignKey),
			)
			result, err := tx.Exec(query, mainRowID, pq.Array(relation.RowIDs))
			if err != nil {
				return fmt.Errorf("link one-to-many rows: %w", err)
			}
			affected, err := result.RowsAffected()
			if err != nil || affected != int64(len(relation.RowIDs)) {
				return errors.New("one-to-many link count changed during transaction")
			}
		case existingRelationManyToMany:
			query := fmt.Sprintf(
				"INSERT INTO %s (%s, %s) VALUES ($1, $2)",
				pq.QuoteIdentifier(relation.BridgeTableName),
				pq.QuoteIdentifier(relation.BridgeMainForeignKey),
				pq.QuoteIdentifier(relation.BridgeOtherForeignKey),
			)
			for _, relatedRowID := range relation.RowIDs {
				if _, err := tx.Exec(query, mainRowID, relatedRowID); err != nil {
					return fmt.Errorf("link many-to-many row: %w", err)
				}
			}
		default:
			return errors.New("unsupported resolved relation kind")
		}
	}
	return nil
}

func hasStrictTableRoutePermission(
	tx *sql.Tx,
	route string,
	userID int,
	tableName string,
	tableUID string,
) (bool, error) {
	return permissions.CheckRouteTablePermission(
		tx,
		route,
		userID,
		permissions.RouteTableScope{TableName: tableName, TableUID: tableUID},
		permissions.StrictRouteTableOptions(),
	)
}

func uniquePositiveRowIDs(rowIDs []int64) []int64 {
	seen := make(map[int64]struct{}, len(rowIDs))
	result := make([]int64, 0, len(rowIDs))
	for _, rowID := range rowIDs {
		if rowID <= 0 {
			continue
		}
		if _, duplicate := seen[rowID]; duplicate {
			continue
		}
		seen[rowID] = struct{}{}
		result = append(result, rowID)
	}
	return result
}

func uploadEnabledInTargetSpecs(raw string) bool {
	if strings.TrimSpace(raw) == "" {
		return false
	}
	var specs struct {
		FileUpload struct {
			Enabled bool `json:"enabled"`
		} `json:"file_upload"`
	}
	return json.Unmarshal([]byte(raw), &specs) == nil && specs.FileUpload.Enabled
}

func resolveAndAuthorizeOwnedChildren(
	tx *sql.Tx,
	mainTableUID string,
	children []ChildRowPayload,
	userID int,
) ([]ChildRowPayload, error) {
	resolved := make([]ChildRowPayload, 0, len(children))
	for _, child := range children {
		if child.RelationID <= 0 || child.Data == nil {
			return nil, errors.New("invalid owned child payload")
		}
		var targetInsertSpecs sql.NullString
		var childTableUID string
		var childTableName string
		var referencingColumn string
		var insertNewSourceWithTarget sql.NullBool
		var hasSpatialColumn bool
		err := tx.QueryRow(`
			SELECT
				fr.source_table_uid,
				source_table.table_name,
				fr.source_column_name,
				fr.target_insert_specs,
				fr.insert_new_source_with_target,
				EXISTS (
					SELECT 1
					FROM information_schema.columns spatial_column
					WHERE spatial_column.table_schema = COALESCE(NULLIF(source_table.schema_name, ''), 'public')
						AND spatial_column.table_name = source_table.table_name
						AND (
							LOWER(spatial_column.udt_name) IN ('geometry', 'geography')
							OR LOWER(spatial_column.data_type) = 'point'
						)
				)
			FROM system_foreign_key_relations_1_m fr
			JOIN system_db_tables source_table
				ON source_table.table_uid = fr.source_table_uid
			WHERE fr.id = $1
				AND fr.target_table_uid = $2
		`, child.RelationID, mainTableUID).Scan(
			&childTableUID,
			&childTableName,
			&referencingColumn,
			&targetInsertSpecs,
			&insertNewSourceWithTarget,
			&hasSpatialColumn,
		)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, errors.New("registered owned-child relation was not found for this dataset")
			}
			return nil, fmt.Errorf("resolve owned-child relation: %w", err)
		}
		isAsset := uploadEnabledInTargetSpecs(targetInsertSpecs.String)
		isOptionalLocation := hasSpatialColumn && insertNewSourceWithTarget.Valid && insertNewSourceWithTarget.Bool
		if !isAsset && !isOptionalLocation {
			return nil, errors.New("nested business-row creation is not supported")
		}
		if insertNewSourceWithTarget.Valid && !insertNewSourceWithTarget.Bool {
			return nil, errors.New("owned-child creation is disabled for this relation")
		}
		allowed, err := hasStrictTableRoutePermission(
			tx,
			"/api/add-row-multipart",
			userID,
			childTableName,
			childTableUID,
		)
		if err != nil {
			return nil, fmt.Errorf("check owned-child create permission: %w", err)
		}
		if !allowed {
			return nil, &forbiddenError{msg: "owned child cannot be created by this actor"}
		}
		child.TableName = childTableName
		child.ReferencingColumn = referencingColumn
		resolved = append(resolved, child)
	}
	return resolved, nil
}

func validateMainForeignKeyReads(
	tx *sql.Tx,
	columns []dtt_models.AddRowColumnInfo,
	row map[string]interface{},
	userID int,
	userRole string,
) error {
	for _, column := range columns {
		value, supplied := row[column.ColumnName]
		if !supplied || value == nil || strings.TrimSpace(fmt.Sprint(value)) == "" {
			continue
		}
		if column.ForeignTableName == "" || column.ForeignColumnName == "" {
			continue
		}
		foreignUID, err := getTableUID(column.ForeignTableName, tx)
		if err != nil {
			return fmt.Errorf("resolve foreign dataset: %w", err)
		}
		allowed, err := hasStrictTableRoutePermission(
			tx,
			"/api/get-results",
			userID,
			column.ForeignTableName,
			foreignUID,
		)
		if err != nil {
			return fmt.Errorf("check foreign-row read permission: %w", err)
		}
		if !allowed {
			return &forbiddenError{msg: "foreign row cannot be read by this actor"}
		}
		query := fmt.Sprintf(
			"SELECT %s FROM %s WHERE %s = $1",
			pq.QuoteIdentifier("id"),
			pq.QuoteIdentifier(column.ForeignTableName),
			pq.QuoteIdentifier(column.ForeignColumnName),
		)
		var rowID int64
		if err := tx.QueryRow(query, value).Scan(&rowID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errors.New("foreign row does not exist")
			}
			return fmt.Errorf("resolve foreign row: %w", err)
		}
		visible, err := dtt_1_row_read.RowsVisibleForRead(
			tx,
			column.ForeignTableName,
			userRole,
			userID,
			[]int64{rowID},
		)
		if err != nil {
			return err
		}
		if !visible {
			return &forbiddenError{msg: "foreign row cannot be read by this actor"}
		}
	}
	return nil
}
