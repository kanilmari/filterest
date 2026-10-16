// intelligent_result_fetcher.go
// Database query functions for intelligent search: FTS, vector similarity, and ordered retrieval.
// Bridges the intelligent result handler and the database with FK-display JOINs.
// Exists to execute the search queries that the handler orchestrates and merges.

package dtt_1_row_read

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"

	dbutils "easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_read"
	dtt_search_vectors "easelect/backend/core_components/dynamic_table_tools/search_vectors"

	"github.com/lib/pq"
	pgvector "github.com/pgvector/pgvector-go"
)

/* ===========================================================
 *  Embedding-sarakkeen tarkistus
 * =========================================================*/

func hasEmbeddingVectorColumn(db rowQueryer, tableName string) (bool, error) {
	const qry = `
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = $1
		  AND column_name = 'embedding_vector'
		LIMIT 1`
	var dummy int
	err := db.QueryRow(qry, tableName).Scan(&dummy)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

func tableHasColumn(db rowQueryer, table, column string) (bool, error) {
	const qry = `
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = $1
                  AND column_name = $2
                LIMIT 1`
	var dummy int
	err := db.QueryRow(qry, table, column).Scan(&dummy)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

/* ===========================================================
 *  Rivien haku annetussa järjestyksessä
 * =========================================================*/

// fetchRowsInOrder hakee rivit ID-listan mukaisessa järjestyksessä.
// Käyttää buildJoinsWith1MRelations() FK-näyttösarakkeille (_name (ln)),
// jotta tekstihakutulokset näyttävät samat FK-arvot kuin normaalit tulokset.
// FK-sarakkeen valinta: dtt_utils.ResolveFKDisplayColumn() — ks. dtt_utils/utils.go.
func fetchRowsInOrder(db dbutils.Querier, table string, rowIDs []int, authorization intelligentSearchAuthorization) ([]map[string]interface{}, []string, error) {
	if len(rowIDs) == 0 {
		return nil, nil, nil
	}

	extraCond := ""
	queryArgs := []interface{}{pq.Array(rowIDs)}
	authorizationCond, authorizedArgs, err := appendIntelligentSearchAuthorizationCondition(
		table,
		table,
		authorization,
		queryArgs,
	)
	if err != nil {
		return nil, nil, err
	}
	queryArgs = authorizedArgs
	if authorizationCond != "" {
		extraCond = " AND " + authorizationCond
	}

	// Owner metadata may advertise denied optional fields. Filter before building
	// either projection, so PostgreSQL never rejects an otherwise readable row.
	allowed, err := fetchUserSelectableColumns(db, table)
	if err != nil {
		return nil, nil, err
	}
	allowedColumns := selectableColumnSet(allowed)

	// --- Build SELECT + JOINs using the same FK-display logic as normal results ---
	selectList := ""
	joinClauses := ""

	columnsMap, err := dtt_2_column_read.GetColumnsMapForTable(table)
	columnsMap = filterReadableColumnMetadata(columnsMap, allowedColumns)
	if err == nil && len(columnsMap) > 0 {
		// Collect column UIDs in co_number order for deterministic output.
		type uidOrder struct {
			uid   int
			order int
		}
		var ordered []uidOrder
		for uid, ci := range columnsMap {
			ordered = append(ordered, uidOrder{uid, ci.CoNumber})
		}
		sort.Slice(ordered, func(i, j int) bool { return ordered[i].order < ordered[j].order })
		colUIDs := make([]int, len(ordered))
		for i, o := range ordered {
			colUIDs[i] = o.uid
		}

		labelAuthorization := authorization.labelAuthorization
		if labelAuthorization == nil {
			labelAuthorization = newForeignLabelAuthorization(db, authorization.userRole, authorization.userID)
		}
		sel, joins, _, joinArgs, joinErr := buildJoinsWith1MRelations(db, table, columnsMap, colUIDs, labelAuthorization, len(queryArgs))
		if joinErr != nil && !errors.Is(joinErr, sql.ErrNoRows) {
			return nil, nil, joinErr
		}
		queryArgs = append(queryArgs, joinArgs...)
		if joinErr == nil {
			selectList = sel
			joinClauses = joins
		}
	}

	// Fallback: plain column list without JOINs (e.g. for views without system_db_tables entry).
	if selectList == "" {
		visibleCols, vcErr := getVisibleColumnNames(db, table)
		if vcErr != nil {
			return nil, nil, vcErr
		}
		visibleCols = filterAllowedSupportColumns(visibleCols, allowedColumns)
		// buildSelectColumns expands an empty list to *, which must not bypass grants.
		if len(visibleCols) == 0 {
			return nil, nil, fmt.Errorf("no readable result columns for %s", table)
		}
		selectList = buildSelectColumns(table, visibleCols)
	}

	query := fmt.Sprintf(`
		WITH wanted AS (
			SELECT unnest($1::int[]) AS id,
			       generate_series(1, array_length($1::int[],1)) AS pos
		)
		SELECT %s
		FROM wanted
		JOIN %s ON %s.id = wanted.id
		%s
		WHERE 1=1%s
		ORDER BY wanted.pos`,
		selectList,
		pq.QuoteIdentifier(table),
		pq.QuoteIdentifier(table),
		joinClauses,
		extraCond,
	)

	rows, err := db.Query(query, queryArgs...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	// Use the listing serializer so zoned platform clocks remain explicit
	// instants in search results, including joins and CSV-restored rows.
	cols, data, err := formatRowsToMaps(rows, false)
	if err != nil {
		return nil, nil, err
	}
	// Ordered search historically emits data:null when requested IDs yield no
	// readable rows. Listings and vector search retain their empty-array shape.
	if len(data) == 0 {
		data = nil
	}
	if err := enrichServiceCatalogModerationRows(db, table, data, authorization.userRole, authorization.userID); err != nil {
		return nil, nil, err
	}
	cols = appendServiceCatalogModerationColumns(table, cols, data, authorization.userRole)
	return data, cols, nil
}

/* ===========================================================
 *  Muuttumattomat apurit (hakusanat: dtt_search_vectors.OrPrefixTsQuery)
 * =========================================================*/

func buildSimpleSearchVectorExpression(tableAlias string, cols []string) string {
	if len(cols) == 0 {
		return ""
	}

	quotedAlias := pq.QuoteIdentifier(tableAlias)
	parts := make([]string, 0, len(cols))
	for _, col := range cols {
		parts = append(parts, fmt.Sprintf("coalesce(%s.%s::text, '')", quotedAlias, pq.QuoteIdentifier(col)))
	}

	// The same definition as the stored vector, so a row without one is found
	// by the same words.
	return dtt_search_vectors.SearchVectorExpressionForValues(parts)
}

func quoteDerivedTableName(baseTable string, suffix string) string {
	return pq.QuoteIdentifier(baseTable + suffix)
}

// fetchFullTextRows hakee 10 parasta täyden tekstin osumaa
// käyttäen SIMPLE-konfiguraatiota. Jos search_vector_simple puuttuu,
// vektori lasketaan lennossa ilman taulumuutoksia.
func fetchFullTextRows(db dbutils.Querier, mainTable, searchString string, authorization intelligentSearchAuthorization) ([]rowTextRank, error) {
	const limitResults = 10

	trimmed := strings.TrimSpace(searchString)
	if trimmed == "" {
		return nil, nil
	}

	idSearch, err := dtt_search_vectors.DatasetIDSearch(db, mainTable, trimmed)
	if err != nil {
		return nil, err
	}
	trimmed = idSearch.TextTerm(trimmed)

	rowName := "header"
	if ok, err := tableHasColumn(db, mainTable, "header"); err != nil {
		return nil, err
	} else if !ok {
		rowName = "id"
	}

	hasVector, err := tableHasColumn(db, mainTable, "search_vector_simple")
	if err != nil {
		return nil, err
	}
	cols, err := dbutils.GetQueryableColumns(mainTable, db, false)
	if err != nil {
		return nil, err
	}

	alias := mainTable
	from := pq.QuoteIdentifier(mainTable)
	prefix := ""
	rankExpr := "1"
	search := dtt_search_vectors.TextSearch{}
	if hasVector {
		alias = "src"
		searchVectorExpr := `"src".search_vector_simple`
		if fallbackExpr := buildSimpleSearchVectorExpression(alias, cols); fallbackExpr != "" {
			searchVectorExpr = fmt.Sprintf("COALESCE(%s, %s)", searchVectorExpr, fallbackExpr)
		}
		prefix = "WITH q AS (SELECT to_tsquery('simple', $1) AS query) "
		from += fmt.Sprintf(` AS "src" CROSS JOIN q CROSS JOIN LATERAL (SELECT %s AS search_vector) AS search_doc`, searchVectorExpr)
		rankExpr = "ts_rank(search_doc.search_vector, q.query)"
		search = dtt_search_vectors.TextSearch{
			Predicate: "search_doc.search_vector @@ q.query",
			Args:      []interface{}{dtt_search_vectors.OrPrefixTsQuery(trimmed)},
			OrderBy:   " ORDER BY rank DESC",
		}
	} else {
		if len(cols) == 0 && !idSearch.Enabled {
			return nil, nil
		}
		// Keep the existing substring fallback and its identifier order.
		parts := make([]string, 0, len(cols))
		for _, column := range cols {
			parts = append(parts, fmt.Sprintf("coalesce(%s::text,'') ILIKE $1", pq.QuoteIdentifier(column)))
		}
		search.Predicate = strings.Join(parts, " OR ")
		search.OrderBy = " ORDER BY " + pq.QuoteIdentifier(mainTable) + `."id"`
		if len(cols) > 0 {
			search.Args = []interface{}{"%" + trimmed + "%"}
		}
	}
	idExpr := pq.QuoteIdentifier(alias) + `."id"`
	search = idSearch.Apply(search, idExpr, len(search.Args)+1)
	if hasVector && search.IDPredicate != "" {
		// Preserve the assisted search's existing score for the exact ID hit.
		rankExpr = fmt.Sprintf("CASE WHEN %s THEN 1.0 ELSE %s END", search.IDPredicate, rankExpr)
	}
	authorizationCond, args, err := appendIntelligentSearchAuthorizationCondition(mainTable, alias, authorization, search.Args)
	if err != nil {
		return nil, err
	}
	where := "(" + search.Predicate + ")"
	if authorizationCond != "" {
		where += " AND " + authorizationCond
	}
	query := fmt.Sprintf("%sSELECT %s.id, %s.%s, %s AS rank FROM %s WHERE %s%s LIMIT %d",
		prefix, pq.QuoteIdentifier(alias), pq.QuoteIdentifier(alias), pq.QuoteIdentifier(rowName),
		rankExpr, from, where, search.OrderBy, limitResults)

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []rowTextRank
	for rows.Next() {
		var id int
		var name sql.NullString
		var rankValue sql.NullFloat64
		if err := rows.Scan(&id, &name, &rankValue); err != nil {
			return nil, err
		}
		if rankValue.Valid {
			results = append(results, rowTextRank{RowID: id, RowName: name.String, Rank: rankValue.Float64})
		}
	}
	return results, rows.Err()
}

// fetchSimilarRows returns up to limit rows closest in meaning to the query,
// across every embedding the dataset stores: the general row embedding and
// each language embedding, one result per row at its best distance.
//
// readerLang is the reader's interface language. It never narrows which rows
// or languages are searched; a match in that language only ranks slightly
// ahead (semanticReaderLanguageRankFactor). DistanceScore stays the row's best
// distance in any language, so the same row passes the relatedness threshold
// whichever language the reader uses.
func fetchSimilarRows(
	db dbutils.Querier,
	mainTable string,
	readerLang string,
	queryVector pgvector.Vector,
	authorization intelligentSearchAuthorization,
	sources semanticSources,
	limit int,
) ([]rowSemanticScore, error) {
	if !sources.any() || limit <= 0 {
		return nil, nil
	}

	rowName := "header"
	if ok, err := tableHasColumn(db, mainTable, "header"); err != nil {
		return nil, err
	} else if !ok {
		rowName = "id"
	}

	queryArgs := []interface{}{queryVector}
	languagePlaceholder := 0
	if sources.Language {
		queryArgs = append(queryArgs, readerContentLanguage(readerLang))
		languagePlaceholder = len(queryArgs)
	}
	// Authorization sits in the candidate WHERE, before ORDER BY and LIMIT, so
	// rows the reader may not see never take a place among the nearest.
	authorizationCond, scopedArgs, err := appendIntelligentSearchAuthorizationCondition(
		mainTable,
		mainTable,
		authorization,
		queryArgs,
	)
	if err != nil {
		return nil, err
	}
	whereClause := "semantic.distance IS NOT NULL"
	if authorizationCond != "" {
		whereClause += " AND " + authorizationCond
	}

	quotedTable := pq.QuoteIdentifier(mainTable)
	query := fmt.Sprintf(`
		SELECT %[1]s.id,
		       %[1]s.%[2]s,
		       semantic.distance,
		       semantic.language_code
		FROM %[1]s
		CROSS JOIN LATERAL (%[3]s
		) AS semantic
		WHERE %[4]s
		ORDER BY semantic.rank_score ASC, semantic.distance ASC, %[1]s.id ASC
		LIMIT %[5]d`,
		quotedTable,
		pq.QuoteIdentifier(rowName),
		semanticMatchLateral(mainTable, sources, 1, languagePlaceholder),
		whereClause,
		limit,
	)
	rows, err := db.Query(query, scopedArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []rowSemanticScore
	for rows.Next() {
		var id int
		var name sql.NullString
		var distance sql.NullFloat64
		var language sql.NullString
		if err := rows.Scan(&id, &name, &distance, &language); err != nil {
			return nil, err
		}
		if distance.Valid {
			results = append(results, rowSemanticScore{
				RowID:         id,
				RowName:       name.String,
				DistanceScore: distance.Float64,
				MatchLanguage: language.String,
			})
		}
	}
	return results, rows.Err()
}
