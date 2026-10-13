// related_incoming_reader.go
// Reads incoming relations with a bounded gallery snapshot lifetime.
// Separates administrator metadata from the viewer's gallery and picture reads.
// Releases the snapshot before any other pooled read, preserving response order.
package dtt_1_row_read

import (
	"database/sql"
	"errors"
	"log"
	"net/http"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

type incomingRelatedMetadata struct {
	fk     FKInfo
	types  map[string]interface{}
	labels map[string]dtt_utils.ForeignKey
	kind   string
}

// prepareIncomingRelatedMetadata performs the owner-only catalogue reads before
// reserving the gallery connection. A role transaction cannot replace these
// reads: information_schema hides foreign keys from non-owning roles.
func prepareIncomingRelatedMetadata(currentDb *sql.DB, fkInfos []FKInfo, childFilter, userRole string,
	kinds map[string]string, canRead relatedDatasetPermissionChecker) ([]incomingRelatedMetadata, error) {
	metadata := make([]incomingRelatedMetadata, 0, len(fkInfos))
	for _, fk := range fkInfos {
		if childFilter != "" && fk.Referencing_table != childFilter {
			continue
		}
		types, err := getColumnDataTypesWithFK(fk.Referencing_table, currentDb)
		if err != nil {
			log.Printf("\033[33mwarning: related items type metadata lookup failed for %s: %s\033[0m", fk.Referencing_table, err)
			types = map[string]interface{}{}
		} else {
			types = enrichServiceCatalogModerationDataTypes(fk.Referencing_table, types)
		}
		foreignKeys, err := dtt_utils.GetForeignKeysForTable(fk.Referencing_table)
		if err != nil {
			log.Printf("\033[33mwarning: related label metadata unavailable for table %s: %s\033[0m", fk.Referencing_table, err)
			foreignKeys = map[string]dtt_utils.ForeignKey{}
		}
		labels, types, err := authorizeRelatedNestedMetadata(foreignKeys, types, userRole, canRead,
			func(table string) (ReadRowPolicy, error) { return getLegacyMustTrueReadPolicy(currentDb, table) })
		if err != nil {
			log.Printf("\033[31merror: authorizing nested foreign keys from table %s: %s\033[0m", fk.Referencing_table, err)
			return nil, errors.New("error authorizing related datasets")
		}
		metadata = append(metadata, incomingRelatedMetadata{fk, types, labels, classifyRelatedTableKind(fk.Referencing_table, kinds)})
	}
	return metadata, nil
}

// readIncomingRelatedTable uses only its querier, including policy, audit and
// media reads. Calling it with a snapshot never acquires a second connection.
func readIncomingRelatedTable(q dbutils.Querier, meta incomingRelatedMetadata, parentID int,
	childFilter string, regularCount int, actor dbutils.RequestActorContext, gallery *dtt_card_picture.PictureRelation) (*RelatedTableResult, error) {
	fk := meta.fk
	result := RelatedTableResult{Table_name: fk.Referencing_table, Column_name: fk.Referencing_column,
		RelationKind: meta.kind, ReferenceDirection: relatedReferenceDirectionIncoming,
		FilterValue: parentID, Types: meta.types, Rows: []map[string]interface{}{}}
	if !shouldEagerLoadRelatedRows(childFilter, meta.kind, regularCount) {
		policy, err := getLegacyMustTrueReadPolicy(q, fk.Referencing_table)
		if err != nil {
			log.Printf("\033[31merror: fetching row policy metadata for table %s: %s\033[0m", fk.Referencing_table, err)
			return nil, nil
		}
		result.RowCount, err = countRelatedRows(q, fk.Referencing_table, fk.Referencing_column, parentID, actor.UserRole, actor.UserID, policy)
		if err != nil {
			log.Printf("\033[31merror: counting related rows from table %s: %s\033[0m", fk.Referencing_table, err)
			return nil, nil
		}
		return &result, nil
	}
	columns, err := getVisibleColumnNames(q, fk.Referencing_table)
	if err != nil {
		log.Printf("\033[31merror: fetching visible columns from table %s: %s\033[0m", fk.Referencing_table, err)
		return nil, nil
	}
	columns, err = appendExistingRelatedAuditColumns(q, fk.Referencing_table, columns)
	if err != nil {
		log.Printf("\033[33mwarning: related items audit column lookup failed for %s: %s\033[0m", fk.Referencing_table, err)
	}
	actors, err := row_mutation_policy.ReadRowActorColumns(q, fk.Referencing_table)
	if err != nil {
		return nil, errors.New("error reading related actor columns")
	}
	selectColumns, joins := buildRelatedSelectColumnsWithFKLabels(fk.Referencing_table, columns, meta.labels, actors)
	policy, err := getLegacyMustTrueReadPolicy(q, fk.Referencing_table)
	if err != nil {
		log.Printf("\033[31merror: fetching row policy metadata for table %s: %s\033[0m", fk.Referencing_table, err)
		return nil, nil
	}
	order := ""
	if gallery != nil && gallery.ChildTable == fk.Referencing_table && gallery.ForeignKey == fk.Referencing_column {
		order = galleryRowsOrder(gallery)
	}
	query, args := buildRelatedItemsQueryWithReadPolicy(selectColumns, fk.Referencing_table, joins,
		fk.Referencing_column, parentID, actor.UserRole, actor.UserID, policy, order)
	rows, err := q.Query(query, args...)
	if err != nil {
		log.Printf("\033[31merror: fetching related rows from table %s: %s\033[0m", fk.Referencing_table, err)
		return nil, nil
	}
	result.Rows, err = scanRowsToMaps(rows)
	rows.Close()
	if err != nil {
		log.Printf("\033[31merror: reading related rows from table %s: %s\033[0m", fk.Referencing_table, err)
		return nil, nil
	}
	FilterIndependentMediaRows(q, actor, result.Rows)
	result.RowCount = len(result.Rows)
	return &result, nil
}

func readIncomingRelatedTables(request *http.Request, currentDb *sql.DB, metadata []incomingRelatedMetadata,
	parentTable string, parentID int, childFilter string, regularCount int,
	actor dbutils.RequestActorContext, gallery *dtt_card_picture.PictureRelation) ([]RelatedTableResult, map[string]interface{}, error) {
	results := make([]*RelatedTableResult, len(metadata))
	picture := map[string]interface{}{}
	useSnapshot := gallery != nil && parentTable != rlsPilotTableName && gallery.ChildTable != rlsPilotTableName
	if useSnapshot {
		// Only gallery rows and the shown picture need one REPEATABLE READ
		// snapshot. End it before ordinary relations, appearance or capabilities
		// acquire pooled connections; saturation must never require two slots.
		err := func() error {
			tx, err := currentDb.BeginTx(request.Context(), &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
			if err != nil {
				log.Printf("\033[31merror: gallery snapshot unavailable for %s: %s\033[0m", parentTable, err)
				return errors.New("error reading the gallery")
			}
			defer tx.Rollback()
			q := dbutils.BindQueryContext(request.Context(), tx)
			for i, meta := range metadata {
				if meta.fk.Referencing_table != gallery.ChildTable || meta.fk.Referencing_column != gallery.ForeignKey {
					continue
				}
				results[i], err = readIncomingRelatedTable(q, meta, parentID, childFilter, regularCount, actor, gallery)
				if err != nil {
					return err
				}
			}
			readRelatedPictureInto(picture, q, actor, parentTable, parentID)
			return nil
		}()
		if err != nil {
			return nil, nil, err
		}
	}
	for i, meta := range metadata {
		if useSnapshot && meta.fk.Referencing_table == gallery.ChildTable && meta.fk.Referencing_column == gallery.ForeignKey {
			continue
		}
		q, err := getPilotReadQuerier(request.Context(), meta.fk.Referencing_table, currentDb)
		if err != nil {
			return nil, nil, errors.New("error initializing related row visibility check")
		}
		results[i], err = readIncomingRelatedTable(q, meta, parentID, childFilter, regularCount, actor, gallery)
		if err != nil {
			return nil, nil, err
		}
	}
	ordered := []RelatedTableResult{}
	for _, result := range results {
		if result != nil {
			ordered = append(ordered, *result)
		}
	}
	// The pilot picture stays after its rows in the request transaction.
	if !useSnapshot {
		if q, err := getPilotReadQuerier(request.Context(), parentTable, currentDb); err == nil {
			readRelatedPictureInto(picture, q, actor, parentTable, parentID)
		}
	}
	return ordered, picture, nil
}

func readRelatedPictureInto(response map[string]interface{}, q dbutils.Querier, actor dbutils.RequestActorContext, parentTable string, parentID int) {
	picture, hasFields, err := readRelatedCardPicture(q, actor, parentTable, parentID)
	if err != nil {
		log.Printf("\033[33mwarning: shown picture of %s row %d not readable: %s\033[0m", parentTable, parentID, err)
	} else if hasFields {
		response["card_picture"] = picture
	}
}
