// get_child_items.go
// Retrieves rows from tables that refer to a parent record via foreign key constraints.
// Bridges FK metadata, referring tables, and the reverse-FK tab display in the frontend.
// Exists to dynamically discover and fetch referring rows filtered by the parent primary key.

package dtt_1_row_read

import (
	"database/sql"
	backend "easelect/backend/core_components"
	auth "easelect/backend/core_components/auth"
	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
)

const (
	dynamicRelatedItemsRoute = "/api/fetch-dynamic-children"

	relatedTableKindRows        = "related_rows"
	relatedTableKindImageAsset  = "image_asset"
	relatedTableKindSharedAsset = "shared_asset"

	relatedReferenceDirectionIncoming = "incoming"
	relatedReferenceDirectionOutgoing = "outgoing"
)

var relatedRecordSummaryAuditColumns = []string{"created", "updated"}

type FKInfo struct {
	Constraint_name    string
	Referencing_table  string
	Referencing_column string
	Referenced_table   string
	Referenced_column  string
}

type RelatedTableResult struct {
	Table_name         string                    `json:"dataset"`
	DatasetUID         int                       `json:"dataset_uid,omitempty"`
	DatasetAppearance  *store.AppearanceResponse `json:"dataset_appearance,omitempty"`
	Column_name        string                    `json:"column"`
	RelationKind       string                    `json:"relation_kind,omitempty"`
	ReferenceDirection string                    `json:"reference_direction,omitempty"`
	FilterValue        int                       `json:"filter_value,omitempty"`
	RowCount           int                       `json:"row_count,omitempty"`
	Types              map[string]interface{}    `json:"types,omitempty"`
	Rows               []map[string]interface{}  `json:"rows"`
}

type relatedDatasetPermissionChecker func(tableName string) (bool, error)
type relatedReadPolicyLoader func(tableName string) (ReadRowPolicy, error)

// GetDynamicRelatedItemsHandler etsii ne referencing_table/column -parit,
// joilla referenced_table = parent_table, ja hakee viittaavat rivit,
// joissa referencing_column = parent_pk_value.
func GetDynamicRelatedItemsHandler(response_writer http.ResponseWriter, request *http.Request) {

	// Luetaan body
	var body_data struct {
		Parent_table    string `json:"parent_dataset"`
		Parent_pk_value string `json:"parent_pk_value"`
		Child_table     string `json:"child_table,omitempty"`
		Metadata_only   bool   `json:"metadata_only,omitempty"`
	}
	if err := json.NewDecoder(request.Body).Decode(&body_data); err != nil {
		log.Printf("\033[31merror: dynamic related search, decoding failed: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "error decoding data")
		return
	}

	routeDataset := strings.TrimSpace(request.URL.Query().Get("dataset"))
	body_data.Parent_table = strings.TrimSpace(body_data.Parent_table)
	body_data.Child_table = strings.TrimSpace(body_data.Child_table)
	if routeDataset == "" {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "dataset is missing")
		return
	}
	if body_data.Parent_table == "" {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "parent_table is missing")
		return
	}
	if routeDataset != body_data.Parent_table {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "parent_dataset must match dataset query parameter")
		return
	}

	actor := dbutils.RequestActorContextFromRequest(request)
	userRole := actor.UserRole
	userID := actor.UserID
	if body_data.Metadata_only && !actor.IsAdmin {
		httpresponse.RespondWithError(response_writer, http.StatusForbidden, "metadata_only requires admin access")
		return
	}

	parent_id := 0
	if !body_data.Metadata_only {
		if body_data.Parent_pk_value == "" {
			httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "parent_pk_value is missing")
			return
		}
		var err error
		parent_id, err = strconv.Atoi(body_data.Parent_pk_value)
		if err != nil {
			log.Printf("\033[31merror: parent_pk_value is not an int: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "parent_pk_value was not an int")
			return
		}
	}

	log.Printf("dynamic related search: table=%s, pk_value=%s metadata_only=%t", body_data.Parent_table, body_data.Parent_pk_value, body_data.Metadata_only)

	currentDb := auth.GetDBForRole(userRole)
	var parentReadPolicy ReadRowPolicy
	if !body_data.Metadata_only {
		var policyErr error
		parentReadPolicy, policyErr = getLegacyMustTrueReadPolicy(currentDb, body_data.Parent_table)
		if policyErr != nil {
			log.Printf("\033[31merror: fetching parent row policy metadata for %s: %s\033[0m\n", body_data.Parent_table, policyErr.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error checking parent row visibility")
			return
		}
		parentReadQuerier, setupErr := getPilotReadQuerier(request.Context(), body_data.Parent_table, currentDb)
		if setupErr != nil {
			log.Printf("\033[31merror: parent row read setup failed for %s: %s\033[0m\n", body_data.Parent_table, setupErr.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error initializing parent row visibility check")
			return
		}
		parentVisible, visibilityErr := isRelatedParentRowVisible(
			parentReadQuerier,
			body_data.Parent_table,
			parent_id,
			userRole,
			userID,
			parentReadPolicy,
		)
		if visibilityErr != nil {
			log.Printf("\033[31merror: parent row visibility check failed for %s: %s\033[0m\n", body_data.Parent_table, visibilityErr.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error checking parent row visibility")
			return
		}
		if !parentVisible {
			httpresponse.RespondWithError(response_writer, http.StatusNotFound, "parent row not found")
			return
		}
	}

	canReadRelatedDataset := newRelatedDatasetPermissionChecker(backend.Db, userID)

	// Kysely, jolla haetaan ne foreign key -rivit, joissa ccu.table_name = haluttu taulu
	query_fk := `
        SELECT
            tc.constraint_name,
            tc.table_name AS referencing_table,
            kcu.column_name AS referencing_column,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column
        FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.constraint_schema = kcu.constraint_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.constraint_schema = tc.constraint_schema
        WHERE
            tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_name = $1
    `

	rows_fk, err := backend.Db.Query(query_fk, body_data.Parent_table)
	if err != nil {
		log.Printf("\033[31merror: foreign key search failed: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching foreign keys")
		return
	}
	defer rows_fk.Close()

	var fk_infos []FKInfo
	for rows_fk.Next() {
		var f FKInfo
		if err := rows_fk.Scan(&f.Constraint_name, &f.Referencing_table, &f.Referencing_column,
			&f.Referenced_table, &f.Referenced_column); err != nil {
			log.Printf("\033[31merror: foreign key scan: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error in foreign key data")
			return
		}
		fk_infos = append(fk_infos, f)
	}
	if err := rows_fk.Err(); err != nil {
		log.Printf("\033[31merror: foreign key rows iteration: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching foreign keys")
		return
	}
	fk_infos, err = filterAuthorizedIncomingForeignKeys(fk_infos, body_data.Child_table, canReadRelatedDataset)
	if err != nil {
		log.Printf("\033[31merror: related dataset permission check failed: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error authorizing related datasets")
		return
	}

	relationKindByChildTable, err := buildRelatedTableKindMap(currentDb, body_data.Parent_table)
	if err != nil {
		log.Printf("\033[33mwarning: related table kind metadata lookup failed for %s: %s\033[0m\n", body_data.Parent_table, err.Error())
		relationKindByChildTable = map[string]string{}
	}
	// The parent's one gallery, chosen by the same function the card and its writers
	// use, so the article never lists another relation's pictures as the gallery. A
	// gallery found by its columns alone has no upload metadata to classify it, so it
	// is classed here as what it is: never an ordinary related tab, and always loaded.
	gallery, galleryErr := dtt_card_picture.PictureRelationOf(currentDb, body_data.Parent_table)
	if galleryErr != nil {
		log.Printf("\033[33mwarning: gallery lookup failed for %s: %s\033[0m\n", body_data.Parent_table, galleryErr.Error())
		gallery = nil
	}
	if gallery != nil && strings.TrimSpace(relationKindByChildTable[gallery.ChildTable]) == "" {
		galleryKind := relatedTableKindImageAsset
		if gallery.Shared {
			galleryKind = relatedTableKindSharedAsset
		}
		relationKindByChildTable[gallery.ChildTable] = galleryKind
	}
	// The gallery is named to the browser only when this viewer may read its dataset;
	// otherwise its rows are not listed either, and its name stays unknown.
	if gallery != nil {
		if allowed, permissionErr := canReadRelatedDataset(gallery.ChildTable); permissionErr != nil || !allowed {
			gallery = nil
		}
	}
	if body_data.Metadata_only {
		candidates := buildRelatedMetadataCandidates(fk_infos, relationKindByChildTable)
		if err := populateRelatedAppearance(candidates, backend.Db, userID); err != nil {
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching related dataset appearance")
			return
		}
		response_writer.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(response_writer).Encode(map[string]interface{}{
			"child_tables": candidates,
		}); err != nil {
			log.Printf("\033[31merror: encoding related metadata response: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding child response")
		}
		return
	}
	regularRelatedTableCount := countRegularRelatedTableEntries(
		fk_infos,
		relationKindByChildTable,
		body_data.Child_table,
	)

	// The gallery rows and the parent's shown picture come from one snapshot (a read-only
	// REPEATABLE READ transaction), so a picture deleted or marked primary meanwhile cannot
	// make them disagree. The row-security pilot dataset is read through the request's own
	// transaction instead; when the parent or the gallery is the pilot, the rows are read
	// first and the picture after them, so a deleted picture still cannot come back.
	var snapshot *sql.Tx
	if gallery != nil && body_data.Parent_table != rlsPilotTableName && gallery.ChildTable != rlsPilotTableName {
		opened, snapshotErr := currentDb.BeginTx(request.Context(), &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
		if snapshotErr != nil {
			// Without the snapshot the gallery and the picture could disagree; a failed
			// answer is better than one that shows a deleted picture.
			log.Printf("\033[31merror: gallery snapshot unavailable for %s: %s\033[0m\n", body_data.Parent_table, snapshotErr.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error reading the gallery")
			return
		}
		snapshot = opened
		defer func() { _ = snapshot.Rollback() }()
	}

	// An empty list, never null: a viewer with no readable relation still gets a final
	// answer, which the browser takes as the gallery and pictures there are.
	relatedTablesList := []RelatedTableResult{}

	for _, fk_row := range fk_infos {
		// Optional child_table filter for lazy-loading a single tab
		if body_data.Child_table != "" && fk_row.Referencing_table != body_data.Child_table {
			continue
		}

		relationKind := classifyRelatedTableKind(fk_row.Referencing_table, relationKindByChildTable)
		relatedTypes, err := getColumnDataTypesWithFK(fk_row.Referencing_table, currentDb)
		if err != nil {
			log.Printf("\033[33mwarning: related items type metadata lookup failed for %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
			relatedTypes = map[string]interface{}{}
		} else {
			relatedTypes = enrichServiceCatalogModerationDataTypes(fk_row.Referencing_table, relatedTypes)
		}
		foreignKeys, err := dtt_utils.GetForeignKeysForTable(fk_row.Referencing_table)
		if err != nil {
			log.Printf("\033[33mwarning: related label metadata unavailable for table %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
			foreignKeys = map[string]dtt_utils.ForeignKey{}
		}
		labelForeignKeys, relatedTypes, err := authorizeRelatedNestedMetadata(
			foreignKeys,
			relatedTypes,
			userRole,
			canReadRelatedDataset,
			func(tableName string) (ReadRowPolicy, error) {
				return getLegacyMustTrueReadPolicy(currentDb, tableName)
			},
		)
		if err != nil {
			log.Printf("\033[31merror: authorizing nested foreign keys from table %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error authorizing related datasets")
			return
		}

		readQuerier, err := getPilotReadQuerier(request.Context(), fk_row.Referencing_table, currentDb)
		if err != nil {
			log.Printf("\033[31merror: related items pilot read setup failed for %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error initializing related row visibility check")
			return
		}
		isGalleryRelation := gallery != nil && gallery.ChildTable == fk_row.Referencing_table && gallery.ForeignKey == fk_row.Referencing_column
		if isGalleryRelation && snapshot != nil {
			readQuerier = snapshot
		}

		if !shouldEagerLoadRelatedRows(body_data.Child_table, relationKind, regularRelatedTableCount) {
			readPolicy, policyErr := getLegacyMustTrueReadPolicy(currentDb, fk_row.Referencing_table)
			if policyErr != nil {
				log.Printf("\033[31merror: fetching row policy metadata for table %s: %s\033[0m\n", fk_row.Referencing_table, policyErr.Error())
				continue
			}
			rowCount, countErr := countRelatedRows(
				readQuerier,
				fk_row.Referencing_table,
				fk_row.Referencing_column,
				parent_id,
				userRole,
				userID,
				readPolicy,
			)
			if countErr != nil {
				log.Printf("\033[31merror: counting related rows from table %s: %s\033[0m\n", fk_row.Referencing_table, countErr.Error())
				continue
			}

			relatedTablesList = append(relatedTablesList, RelatedTableResult{
				Table_name:         fk_row.Referencing_table,
				Column_name:        fk_row.Referencing_column,
				RelationKind:       relationKind,
				ReferenceDirection: relatedReferenceDirectionIncoming,
				FilterValue:        parent_id,
				RowCount:           rowCount,
				Types:              relatedTypes,
				Rows:               []map[string]interface{}{},
			})
			continue
		}

		visibleCols, err := getVisibleColumnNames(readQuerier, fk_row.Referencing_table)
		if err != nil {
			log.Printf("\033[31merror: fetching visible columns from table %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
			continue
		}
		visibleCols, err = appendExistingRelatedAuditColumns(currentDb, fk_row.Referencing_table, visibleCols)
		if err != nil {
			log.Printf("\033[33mwarning: related items audit column lookup failed for %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
		}

		actorColumns, err := row_mutation_policy.ReadRowActorColumns(readQuerier, fk_row.Referencing_table)
		if err != nil {
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error reading related actor columns")
			return
		}
		selectColumns, joinClauses := buildRelatedSelectColumnsWithFKLabels(
			fk_row.Referencing_table,
			visibleCols,
			labelForeignKeys,
			actorColumns,
		)
		readPolicy, policyErr := getLegacyMustTrueReadPolicy(currentDb, fk_row.Referencing_table)
		if policyErr != nil {
			log.Printf("\033[31merror: fetching row policy metadata for table %s: %s\033[0m\n", fk_row.Referencing_table, policyErr.Error())
			continue
		}
		rowsOrder := ""
		if isGalleryRelation {
			rowsOrder = galleryRowsOrder(gallery)
		}
		queryRelated, queryArgs := buildRelatedItemsQueryWithReadPolicy(
			selectColumns,
			fk_row.Referencing_table,
			joinClauses,
			fk_row.Referencing_column,
			parent_id,
			userRole,
			userID,
			readPolicy,
			rowsOrder,
		)
		relatedRows, err := readQuerier.Query(queryRelated, queryArgs...)
		if err != nil {
			log.Printf("\033[31merror: fetching related rows from table %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
			continue
		}

		table_rows, scanErr := scanRowsToMaps(relatedRows)
		relatedRows.Close()
		if scanErr != nil {
			log.Printf("\033[31merror: reading related rows from table %s: %s\033[0m\n", fk_row.Referencing_table, scanErr.Error())
			continue
		}

		FilterIndependentMediaRows(readQuerier, actor, table_rows)
		relatedTablesList = append(relatedTablesList, RelatedTableResult{
			Table_name:         fk_row.Referencing_table,
			Column_name:        fk_row.Referencing_column,
			RelationKind:       relationKind,
			ReferenceDirection: relatedReferenceDirectionIncoming,
			FilterValue:        parent_id,
			RowCount:           len(table_rows),
			Types:              relatedTypes,
			Rows:               table_rows,
		})
	}

	outgoingRelatedTables, err := fetchOutgoingReferencedTableResults(
		request,
		currentDb,
		body_data.Parent_table,
		parent_id,
		body_data.Child_table,
		userRole,
		userID,
		parentReadPolicy,
		canReadRelatedDataset,
	)
	if err != nil {
		log.Printf("\033[31merror: outgoing related items lookup failed for %s: %s\033[0m\n", body_data.Parent_table, err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching outgoing related items")
		return
	}
	relatedTablesList = append(relatedTablesList, outgoingRelatedTables...)
	if err := populateRelatedAppearance(relatedTablesList, backend.Db, userID); err != nil {
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching related dataset appearance")
		return
	}

	resp := map[string]interface{}{
		"child_tables": relatedTablesList,
	}
	if gallery != nil {
		resp["gallery_relation"] = map[string]string{"dataset": gallery.ChildTable, "column": gallery.ForeignKey}
	}
	// The parent's shown picture, also for a dataset without a gallery: the browser shows
	// a value no listed row carries as the card's own tile, and an empty value as none.
	var pictureQuerier dbutils.Querier
	if snapshot != nil {
		pictureQuerier = snapshot
	} else if pilotQuerier, pilotErr := getPilotReadQuerier(request.Context(), body_data.Parent_table, currentDb); pilotErr == nil {
		pictureQuerier = pilotQuerier
	}
	if pictureQuerier != nil {
		cardPicture, hasPictureFields, pictureErr := readRelatedCardPicture(pictureQuerier, actor, body_data.Parent_table, parent_id)
		if pictureErr != nil {
			log.Printf("\033[33mwarning: shown picture of %s row %d not readable: %s\033[0m\n", body_data.Parent_table, parent_id, pictureErr.Error())
		} else if hasPictureFields {
			resp["card_picture"] = cardPicture
		}
	}
	totalRelatedRows := 0
	for _, relatedTable := range relatedTablesList {
		if relatedTable.RowCount > 0 {
			totalRelatedRows += relatedTable.RowCount
			continue
		}
		totalRelatedRows += len(relatedTable.Rows)
	}
	log.Printf(
		"dynamic related search summary: parent=%s pk_value=%s child_tables=%d total_rows=%d",
		body_data.Parent_table,
		body_data.Parent_pk_value,
		len(relatedTablesList),
		totalRelatedRows,
	)
	response_writer.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(response_writer).Encode(resp); err != nil {
		log.Printf("\033[31merror: encoding child response: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding child response")
		return
	}
}

// GetDynamicChildItemsHandler is a legacy alias kept for existing route/profile names.
// Related results include current UID-bound appearance only for authorized get-results readers.
func GetDynamicChildItemsHandler(response_writer http.ResponseWriter, request *http.Request) {
	GetDynamicRelatedItemsHandler(response_writer, request)
}
