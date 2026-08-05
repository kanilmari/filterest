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
func fetchRowsInOrder(db dbutils.Querier, table string, rowIDs []int, userRole string, userID int, readPolicy ReadRowPolicy) ([]map[string]interface{}, []string, error) {
	if len(rowIDs) == 0 {
		return nil, nil, nil
	}

	extraCond := ""
	queryArgs := []interface{}{pq.Array(rowIDs)}
	readPolicyCond, readPolicyArgs := buildReadRowPolicyCondition(
		table,
		userRole,
		userID,
		readPolicy,
		2,
	)
	if readPolicyCond != "" {
		queryArgs = append(queryArgs, readPolicyArgs...)
		extraCond = " AND " + readPolicyCond
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
	if err := enrichServiceCatalogModerationRows(db, table, data, userRole, userID); err != nil {
		return nil, nil, err
	}
	cols = appendServiceCatalogModerationColumns(table, cols, data, userRole)
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

	return fmt.Sprintf("to_tsvector('simple', concat_ws(' ', %s))", strings.Join(parts, ", "))
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
func fetchFullTextRows(db dbutils.Querier, mainTable, searchString string) ([]rowTextRank, error) {
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
	               WHERE search_doc.search_vector @@ q.query%[7]s
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
		)
		args = []interface{}{tsQuery}
		if hasNumericID {
			args = append(args, numericID)
		}
	} else {
		cols, err := dbutils.GetQueryableColumns(mainTable, db, false)
		if err != nil {
			return nil, err
		}
		if len(cols) == 0 && !hasNumericID {
			return nil, nil
		}
		var parts []string
		for _, c := range cols {
			parts = append(parts, fmt.Sprintf("coalesce(%s::text,'') ILIKE $1", pq.QuoteIdentifier(c)))
		}
		whereClause := strings.Join(parts, " OR ")
		idExpr := fmt.Sprintf("%s.%s", pq.QuoteIdentifier(mainTable), pq.QuoteIdentifier("id"))
		orderByClause := idExpr
		if hasNumericID {
			if whereClause == "" {
				whereClause = fmt.Sprintf("%s = $2", idExpr)
			} else {
				whereClause = fmt.Sprintf("(%s OR %s = $2)", whereClause, idExpr)
			}
			orderByClause = fmt.Sprintf("(%s = $2) DESC, %s", idExpr, idExpr)
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
		args = []interface{}{"%" + trimmed + "%"}
		if hasNumericID {
			args = append(args, numericID)
		}
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

// fetchSimilarRows hakee 10 merkitykseltään lähintä palvelua.
func fetchSimilarRows(db dbutils.Querier, mainTable, lang string, queryVector pgvector.Vector) ([]rowSemanticScore, error) {
	const limitResults = 10

	rowName := "header"
	if ok, err := tableHasColumn(db, mainTable, "header"); err != nil {
		return nil, err
	} else if !ok {
		rowName = "id"
	}

	useLang := false
	if lang != "" {
		if ok, err := tableHasLangEmbeddings(db, mainTable); err == nil && ok {
			useLang = true
		}
	}

	var rows *sql.Rows
	var err error
	if useLang {
		quotedTable := pq.QuoteIdentifier(mainTable)
		quotedEmbeddingsTable := quoteDerivedTableName(mainTable, "_lang_embeddings")
		query := fmt.Sprintf(`
                        SELECT %[1]s.id,
                               %[1]s.%[2]s,
                               le.embedding <-> $1 AS distance_score
                        FROM %[1]s
                        JOIN (
                                SELECT DISTINCT ON (host_row_id) host_row_id, embedding
                                FROM %[4]s
                                WHERE language_code = $2
                                ORDER BY host_row_id, updated DESC
                        ) AS le ON le.host_row_id = %[1]s.id
                        ORDER BY distance_score ASC
                        LIMIT %[3]d`,
			quotedTable,
			pq.QuoteIdentifier(rowName),
			limitResults,
			quotedEmbeddingsTable,
		)
		rows, err = db.Query(query, queryVector, lang)
	} else {
		query := fmt.Sprintf(`
                        SELECT %[1]s.id,
                               %[1]s.%[2]s,
                               %[1]s.embedding_vector <-> $1 AS distance_score
                        FROM %[1]s
                        WHERE %[1]s.embedding_vector IS NOT NULL
                        ORDER BY distance_score ASC
                        LIMIT %[3]d`,
			pq.QuoteIdentifier(mainTable),
			pq.QuoteIdentifier(rowName),
			limitResults,
		)
		rows, err = db.Query(query, queryVector)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []rowSemanticScore
	for rows.Next() {
		var id int
		var name sql.NullString
		var distance sql.NullFloat64
		if err := rows.Scan(&id, &name, &distance); err != nil {
			return nil, err
		}
		if distance.Valid {
			results = append(results, rowSemanticScore{RowID: id, RowName: name.String, DistanceScore: distance.Float64})
		}
	}
	return results, rows.Err()
}
