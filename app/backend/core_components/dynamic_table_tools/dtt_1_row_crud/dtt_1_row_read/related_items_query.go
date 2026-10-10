// related_items_query.go
// Builds related-row query, count and relation-kind projections.
// Connects related result assembly with its existing permission and row-policy boundaries.
// Keeps one implementation for each read responsibility and bounded source files.
package dtt_1_row_read

import (
	"database/sql"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
	"fmt"
	"github.com/lib/pq"
	"strings"
)

func buildRelatedTableKindMap(
	querier dbutils.Querier,
	parentTable string,
) (map[string]string, error) {
	statuses, err := dtt_card_picture.ListRelationStatuses(querier, parentTable)
	if err != nil {
		return nil, err
	}

	kindByTable := make(map[string]string, len(statuses))
	for _, status := range statuses {
		trimmedChildTable := strings.TrimSpace(status.ChildTable)
		if trimmedChildTable == "" {
			continue
		}
		kindByTable[trimmedChildTable] = resolveRelatedTableKind(status)
	}
	return kindByTable, nil
}

func classifyRelatedTableKind(referencingTable string, relationKindByChildTable map[string]string) string {
	trimmedTable := strings.TrimSpace(referencingTable)
	if resolvedKind := strings.TrimSpace(relationKindByChildTable[trimmedTable]); resolvedKind != "" {
		return resolvedKind
	}
	// Generic related-tab resolution is metadata-driven now; suffix-only child
	// tables stay ordinary related rows unless FK media metadata says otherwise.
	return relatedTableKindRows
}

func countRegularRelatedTableEntries(
	fkInfos []FKInfo,
	relationKindByChildTable map[string]string,
	childTableFilter string,
) int {
	if strings.TrimSpace(childTableFilter) != "" {
		return 0
	}

	count := 0
	for _, fkInfo := range fkInfos {
		if classifyRelatedTableKind(fkInfo.Referencing_table, relationKindByChildTable) == relatedTableKindRows {
			count++
		}
	}
	return count
}

func shouldEagerLoadRelatedRows(childTableFilter string, relationKind string, regularRelatedTableCount int) bool {
	if strings.TrimSpace(childTableFilter) != "" {
		return true
	}
	if strings.TrimSpace(relationKind) != relatedTableKindRows {
		return true
	}
	return regularRelatedTableCount == 1
}

func appendExistingRelatedAuditColumns(
	db *sql.DB,
	tableName string,
	columns []string,
) ([]string, error) {
	existingColumns := make(map[string]bool, len(relatedRecordSummaryAuditColumns))
	for _, columnName := range relatedRecordSummaryAuditColumns {
		exists, err := columnExistsInTable(db, tableName, columnName)
		if err != nil {
			return columns, err
		}
		existingColumns[columnName] = exists
	}
	return appendRelatedAuditColumns(columns, existingColumns), nil
}

func appendRelatedAuditColumns(columns []string, existingColumns map[string]bool) []string {
	seenColumns := make(map[string]bool, len(columns)+len(relatedRecordSummaryAuditColumns))
	for _, columnName := range columns {
		seenColumns[columnName] = true
	}

	nextColumns := append([]string(nil), columns...)
	for _, columnName := range relatedRecordSummaryAuditColumns {
		if seenColumns[columnName] || !existingColumns[columnName] {
			continue
		}
		nextColumns = append(nextColumns, columnName)
		seenColumns[columnName] = true
	}
	return nextColumns
}

// countRelatedRows counts reverse-FK rows visible to the current principal.
// It exists between related-tab summaries and row-policy SQL so hidden child rows cannot leak through counts.
func countRelatedRows(
	querier dbutils.Querier,
	tableName string,
	referencingColumn string,
	parentID int,
	userRole string,
	userID int,
	readPolicy ReadRowPolicy,
) (int, error) {
	whereClause, queryArgs := buildRelatedItemsWhereClause(
		tableName,
		referencingColumn,
		parentID,
		userRole,
		userID,
		readPolicy,
	)
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s%s", pq.QuoteIdentifier(tableName), whereClause)

	var rowCount int
	if err := querier.QueryRow(query, queryArgs...).Scan(&rowCount); err != nil {
		return 0, err
	}
	return rowCount, nil
}

func buildRelatedSelectColumnsWithFKLabels(
	tableName string,
	columns []string,
	foreignKeys map[string]dtt_utils.ForeignKey,
	actorColumns row_mutation_policy.RowActorColumns,
) (string, string) {
	if len(columns) == 0 {
		return fmt.Sprintf("%s.*", pq.QuoteIdentifier(tableName)), ""
	}

	selectParts := make([]string, 0, len(columns)*2)
	joinParts := make([]string, 0, len(columns))
	usedJoinAliases := make(map[string]int)
	usedDisplayAliases := make(map[string]struct{}, len(columns))
	existingColumns := make(map[string]struct{}, len(columns))

	for _, columnName := range columns {
		existingColumns[strings.ToLower(columnName)] = struct{}{}
	}

	for _, columnName := range columns {
		selectParts = append(
			selectParts,
			fmt.Sprintf(
				"%s.%s AS %s",
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(columnName),
				pq.QuoteIdentifier(columnName),
			),
		)

		if actorColumns[columnName] != "" {
			displayAlias := buildRelatedFKDisplayAlias(columnName, existingColumns, usedDisplayAliases)
			selectParts = append(selectParts, "NULL::text AS "+pq.QuoteIdentifier(displayAlias))
			continue
		}
		fk, ok := foreignKeys[columnName]
		if !ok || fk.NameColumn == "" {
			continue
		}

		usedJoinAliases[columnName]++
		joinAlias := fmt.Sprintf("%s_related_fk_alias%d", columnName, usedJoinAliases[columnName])
		displayAlias := buildRelatedFKDisplayAlias(columnName, existingColumns, usedDisplayAliases)

		selectParts = append(
			selectParts,
			fmt.Sprintf(
				"%s.%s AS %s",
				pq.QuoteIdentifier(joinAlias),
				pq.QuoteIdentifier(fk.NameColumn),
				pq.QuoteIdentifier(displayAlias),
			),
		)
		joinParts = append(
			joinParts,
			fmt.Sprintf(
				"LEFT JOIN %s AS %s ON %s.%s = %s.%s",
				pq.QuoteIdentifier(fk.ReferencedTable),
				pq.QuoteIdentifier(joinAlias),
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(columnName),
				pq.QuoteIdentifier(joinAlias),
				pq.QuoteIdentifier(fk.ReferencedColumn),
			),
		)
	}

	joinClauses := ""
	if len(joinParts) > 0 {
		joinClauses = strings.Join(joinParts, " ") + " "
	}
	return strings.Join(selectParts, ", "), joinClauses
}

// buildRelatedItemsQuery creates the related-row SELECT and always qualifies the
// FK filter column with the base table name so self-FK label joins stay unambiguous.
func buildRelatedItemsQuery(
	selectColumns string,
	tableName string,
	joinClauses string,
	referencingColumn string,
) string {
	query, _ := buildRelatedItemsQueryWithReadPolicy(
		selectColumns,
		tableName,
		joinClauses,
		referencingColumn,
		0,
		"admin",
		0,
		ReadRowPolicy{},
		"",
	)
	return query
}

// buildRelatedItemsQueryWithReadPolicy creates a related-row SELECT and returns its ordered SQL args.
// It exists so eager-loaded child rows apply the same row policy as count-only related tabs.
// orderBy, without the keyword, orders the rows before the limit; a gallery passes its
// pictures-first gallery order so the first 50 rows always hold the card picture.
func buildRelatedItemsQueryWithReadPolicy(
	selectColumns string,
	tableName string,
	joinClauses string,
	referencingColumn string,
	parentID int,
	userRole string,
	userID int,
	readPolicy ReadRowPolicy,
	orderBy string,
) (string, []interface{}) {
	whereClause, queryArgs := buildRelatedItemsWhereClause(
		tableName,
		referencingColumn,
		parentID,
		userRole,
		userID,
		readPolicy,
	)
	orderClause := ""
	if strings.TrimSpace(orderBy) != "" {
		orderClause = " ORDER BY " + orderBy
	}
	query := fmt.Sprintf(
		"SELECT %s FROM %s %s%s%s LIMIT 50",
		selectColumns,
		pq.QuoteIdentifier(tableName),
		joinClauses,
		whereClause,
		orderClause,
	)
	return query, queryArgs
}

// galleryRowsOrder orders a gallery's rows for the article: pictures — rows of the image
// kind that name a stored file, the gallery's own definition of a picture — before
// everything else, then the one gallery order, qualified by the gallery table so the
// label joins of the related-row query cannot make a column ambiguous.
func galleryRowsOrder(gallery *dtt_card_picture.PictureRelation) string {
	terms := []string{fmt.Sprintf(`CASE WHEN %s THEN 0 ELSE 1 END`, gallery.PictureCondition(gallery.ChildTable))}
	if order := dtt_card_picture.GalleryOrderClause(gallery.Columns, gallery.ChildTable); order != "" {
		terms = append(terms, order)
	}
	return strings.Join(terms, ", ")
}

// buildRelatedItemsWhereClause creates the parent-FK WHERE clause and appends row-policy predicates.
// It exists as the shared placeholder-ordering helper for related-row selects and counts.
func buildRelatedItemsWhereClause(
	tableName string,
	referencingColumn string,
	parentID int,
	userRole string,
	userID int,
	readPolicy ReadRowPolicy,
) (string, []interface{}) {
	whereClause := fmt.Sprintf(
		" WHERE %s.%s = $1",
		pq.QuoteIdentifier(tableName),
		pq.QuoteIdentifier(referencingColumn),
	)
	queryArgs := []interface{}{parentID}
	return appendReadPolicyToWhereClause(tableName, userRole, userID, readPolicy, whereClause, queryArgs)
}

func buildRelatedFKDisplayAlias(
	columnName string,
	existingColumns map[string]struct{},
	usedDisplayAliases map[string]struct{},
) string {
	baseAlias := relatedFKDisplayAliasBase(columnName)
	candidate := baseAlias
	suffixIndex := 0

	for {
		normalizedCandidate := strings.ToLower(candidate)
		if _, exists := existingColumns[normalizedCandidate]; !exists {
			if _, used := usedDisplayAliases[normalizedCandidate]; !used {
				usedDisplayAliases[normalizedCandidate] = struct{}{}
				return candidate
			}
		}

		suffixIndex++
		if suffixIndex == 1 {
			candidate = baseAlias + " (ln)"
			continue
		}
		candidate = fmt.Sprintf("%s (ln %d)", baseAlias, suffixIndex)
	}
}

func relatedFKDisplayAliasBase(columnName string) string {
	switch {
	case strings.HasSuffix(columnName, "_id"):
		return strings.TrimSuffix(columnName, "_id") + "_name"
	case strings.HasSuffix(columnName, "_uid"):
		return strings.TrimSuffix(columnName, "_uid") + "_name"
	default:
		return columnName + "_name"
	}
}
