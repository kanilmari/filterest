// intelligent_result_fetcher.go
// Database query functions for intelligent search: FTS, vector similarity, and ordered retrieval.
// Bridges the intelligent result handler and the database with FK-display JOINs.
// Exists to execute the search queries that the handler orchestrates and merges.

package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

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

	// --- Build SELECT + JOINs using the same FK-display logic as normal results ---
	selectList := ""
	joinClauses := ""

	columnsMap, err := dtt_2_column_read.GetColumnsMapForTable(table)
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

		sel, joins, _, joinErr := buildJoinsWith1MRelations(db, table, columnsMap, colUIDs)
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

	cols, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}

	var data []map[string]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, nil, err
		}
		rowObj := make(map[string]interface{})
		for i, c := range cols {
			switch v := vals[i].(type) {
			case time.Time:
				rowObj[c] = v.Format("2006-01-02 15:04:05")
			case []byte:
				rowObj[c] = string(v)
			default:
				rowObj[c] = v
			}
		}
		data = append(data, rowObj)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	if err := enrichServiceCatalogModerationRows(db, table, data, authorization.userRole, authorization.userID); err != nil {
		return nil, nil, err
	}
	cols = appendServiceCatalogModerationColumns(table, cols, data, authorization.userRole)
	return data, cols, nil
}

/* ===========================================================
 *  Muuttumattomat apurit (buildOrPrefixTsQuery …)
 * =========================================================*/

// buildOrPrefixTsQuery muuntaa esim.
//
//	"kahvila kaninkolo" → "kahvila:* | kaninkolo:*"
func buildOrPrefixTsQuery(input string) string {
	words := strings.Fields(strings.ToLower(input))
	if len(words) == 0 {
		return ""
	}
	for i, w := range words {
		words[i] = w + ":*"
	}
	return strings.Join(words, " | ")
}

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

// parseNumericIDSearch detects exact numeric searches between user input and id lookups.
// It exists so generic text search can include the stable row id without broadening mixed text queries.
func parseNumericIDSearch(input string) (int, bool) {
	if input == "" {
		return 0, false
	}
	for _, r := range input {
		if r < '0' || r > '9' {
			return 0, false
		}
	}
	id, err := strconv.Atoi(input)
	if err != nil {
		return 0, false
	}
	return id, true
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

	tsQuery := buildOrPrefixTsQuery(trimmed)
	numericID, hasNumericID := parseNumericIDSearch(trimmed)

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

	var (
		query string
		args  []interface{}
	)
	if hasVector {
		cols, err := dbutils.GetQueryableColumns(mainTable, db, false)
		if err != nil {
			return nil, err
		}

		quotedSource := pq.QuoteIdentifier("src")
		quotedID := pq.QuoteIdentifier("id")
		searchVectorExpr := fmt.Sprintf(`%s.search_vector_simple`, quotedSource)
		if fallbackExpr := buildSimpleSearchVectorExpression("src", cols); fallbackExpr != "" {
			// Rows seeded before search-vector backfill should still participate in text search.
			searchVectorExpr = fmt.Sprintf(`COALESCE(%s, %s)`, searchVectorExpr, fallbackExpr)
		}

		rankExpr := "ts_rank(search_doc.search_vector, q.query)"
		idWhereExpr := ""
		idOrderExpr := ""
		if hasNumericID {
			idExpr := fmt.Sprintf("%s.%s", quotedSource, quotedID)
			rankExpr = fmt.Sprintf("CASE WHEN %s = $2 THEN 1.0 ELSE ts_rank(search_doc.search_vector, q.query) END", idExpr)
			idWhereExpr = fmt.Sprintf(" OR %s = $2", idExpr)
			idOrderExpr = fmt.Sprintf("(%s = $2) DESC, ", idExpr)
		}

		args = []interface{}{tsQuery}
		if hasNumericID {
			args = append(args, numericID)
		}
		authorizationCond, scopedArgs, err := appendIntelligentSearchAuthorizationCondition(
			mainTable,
			"src",
			authorization,
			args,
		)
		if err != nil {
			return nil, err
		}
		args = scopedArgs
		authorizationWhere := ""
		if authorizationCond != "" {
			authorizationWhere = " AND " + authorizationCond
		}

		query = fmt.Sprintf(`
	               WITH q AS (
	                       SELECT to_tsquery('simple', $1) AS query
	               )
	               SELECT %[2]s.id,
	                      %[2]s.%[4]s,
	                      %[6]s AS rank
	               FROM %[1]s AS %[2]s
	               CROSS JOIN q
	               CROSS JOIN LATERAL (
	                       SELECT %[5]s AS search_vector
	               ) AS search_doc
	               WHERE (search_doc.search_vector @@ q.query%[7]s)%[9]s
	               ORDER BY %[8]srank DESC
	               LIMIT %[3]d`,
			pq.QuoteIdentifier(mainTable),
			pq.QuoteIdentifier("src"),
			limitResults,
			pq.QuoteIdentifier(rowName),
			searchVectorExpr,
			rankExpr,
			idWhereExpr,
			idOrderExpr,
			authorizationWhere,
		)
	} else {
		cols, err := dbutils.GetQueryableColumns(mainTable, db, false)
		if err != nil {
			return nil, err
		}
		if len(cols) == 0 && !hasNumericID {
			return nil, nil
		}
		idExpr := fmt.Sprintf("%s.%s", pq.QuoteIdentifier(mainTable), pq.QuoteIdentifier("id"))
		orderByClause := idExpr
		whereClause := ""
		if len(cols) == 0 {
			whereClause = fmt.Sprintf("%s = $1", idExpr)
			orderByClause = fmt.Sprintf("(%s = $1) DESC, %s", idExpr, idExpr)
			args = []interface{}{numericID}
		} else {
			parts := make([]string, 0, len(cols))
			for _, c := range cols {
				parts = append(parts, fmt.Sprintf("coalesce(%s::text,'') ILIKE $1", pq.QuoteIdentifier(c)))
			}
			whereClause = strings.Join(parts, " OR ")
			args = []interface{}{"%" + trimmed + "%"}
			if hasNumericID {
				whereClause = fmt.Sprintf("(%s OR %s = $2)", whereClause, idExpr)
				orderByClause = fmt.Sprintf("(%s = $2) DESC, %s", idExpr, idExpr)
				args = append(args, numericID)
			}
		}
		authorizationCond, scopedArgs, err := appendIntelligentSearchAuthorizationCondition(
			mainTable,
			mainTable,
			authorization,
			args,
		)
		if err != nil {
			return nil, err
		}
		args = scopedArgs
		if authorizationCond != "" {
			whereClause = fmt.Sprintf("(%s) AND %s", whereClause, authorizationCond)
		}
		query = fmt.Sprintf(`
               SELECT %[1]s.id,
                      %[1]s.%[2]s,
                      1 AS rank
               FROM %[1]s
               WHERE %[3]s
               ORDER BY %[5]s
               LIMIT %[4]d`,
			pq.QuoteIdentifier(mainTable),
			pq.QuoteIdentifier(rowName),
			whereClause,
			limitResults,
			orderByClause,
		)
	}

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
