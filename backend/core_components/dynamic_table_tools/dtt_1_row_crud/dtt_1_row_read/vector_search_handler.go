// vector_search_handler.go
// HTTP handler for semantic vector search over database rows.
// Bridges the embedding API, the vector column, and the search result response.
// Exists to generate query embeddings and rank rows by cosine distance.

package dtt_1_row_read

import (
	"context"
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/lib/pq"
	pgvector "github.com/pgvector/pgvector-go"

	auth "easelect/backend/core_components/auth"
	dtt_openai "easelect/backend/core_components/dynamic_table_tools/ai_features"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_read"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	e_sessions "easelect/backend/core_components/sessions"
)

// GetResultsVector on rinnakkainen endpoint GetResults-funktiolle, mutta tukee
// vector_query-parametria, jolla toteutetaan semanttinen haku (ORDER BY embedding_vector <-> $N).
func GetResultsVector(response_writer http.ResponseWriter, request *http.Request) {
	table_name := request.URL.Query().Get("dataset")
	if table_name == "" {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "table name is missing")
		return
	}

	//------------------------------------------------
	// 1. Haetaan user_role sessiosta ja valitaan DB
	session, err := e_sessions.GetOrCreateSession(nil, request)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching session")
		return
	}
	userRole, _ := session.Values["user_role"].(string)
	if userRole == "" {
		userRole = "guest"
	}
	userID, _ := e_sessions.GetUserIDFromSession(request)
	if userID <= 0 {
		userID = 1
	}

	// Valitaan oikea tietokantayhteys käyttäjän roolin perusteella
	currentDb := auth.GetDBForRole(userRole)
	readQuerier, err := getPilotReadQuerier(request.Context(), table_name, currentDb)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error initializing pilot read transaction")
		return
	}

	//------------------------------------------------
	// 2. Luetaan results_per_load ja offset currentDb:ltä
	var results_per_load_str string
	err = currentDb.QueryRow(`
	SELECT int_value 
	FROM system_config 
	WHERE key = 'results_load_amount'
	`).Scan(&results_per_load_str)
	if err != nil {
		log.Printf("\033[31merror fetching results_load_amount: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching configuration")
		return
	}
	results_per_load, err := strconv.Atoi(results_per_load_str)
	if err != nil {
		log.Printf("\033[31merror converting results_load_amount to int: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "invalid configuration value")
		return
	}

	offset_str := request.URL.Query().Get("offset")
	offset_value := 0
	if offset_str != "" {
		offset_value, err = strconv.Atoi(offset_str)
		if err != nil {
			log.Printf("\033[31merror converting offset to int: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "invalid offset parameter")
			return
		}
	}

	//------------------------------------------------
	// 3. Haetaan saraketiedot
	columns_map, err := dtt_2_column_read.GetColumnsMapForTable(table_name)
	if err != nil {
		log.Printf("\033[31merror fetching columns: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching columns")
		return
	}
	column_uids := make([]int, 0, len(columns_map))
	for uid := range columns_map {
		column_uids = append(column_uids, uid)
	}

	// 4. Haetaan sarakkeiden tietotyypit (mahdollisesti ulkoavaimet yms.)
	column_data_types, err := getColumnDataTypesWithFK(table_name, currentDb)
	if err != nil {
		log.Printf("\033[31merror fetching column data types: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching column data types")
		return
	}

	columns_by_name := make(map[string]dtt_models.ColumnInfo)
	for _, column_info := range columns_map {
		columns_by_name[column_info.ColumnName] = column_info
	}

	//------------------------------------------------
	// 5. Rakennetaan SELECT- ja JOIN-lauseet
	select_columns, join_clauses, column_expressions, err :=
		buildJoinsWith1MRelations(readQuerier, table_name, columns_map, column_uids)
	if err != nil {
		log.Printf("\033[31merror building JOIN clauses: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error building JOIN clauses")
		return
	}

	//------------------------------------------------
	// 6. Rakennetaan WHERE- ja ORDER BY -ehdot
	where_clause, query_args, err := buildWhereClause(
		request.URL.Query(),
		table_name,
		columns_by_name,
		column_expressions,
		column_data_types,
	)
	if err != nil {
		log.Printf("\033[31merror building WHERE clause: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error building WHERE clause")
		return
	}
	readPolicy, err := getLegacyMustTrueReadPolicy(currentDb, table_name)
	if err != nil {
		log.Printf("\033[31merror fetching row policy metadata: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching row policy metadata")
		return
	}
	where_clause, query_args = appendReadPolicyToWhereClause(
		table_name,
		userRole,
		userID,
		readPolicy,
		where_clause,
		query_args,
	)
	order_by_clause, err := buildOrderByClause(
		request.URL.Query(),
		table_name,
		columns_by_name,
		column_expressions,
	)
	if err != nil {
		log.Printf("\033[31merror building ORDER BY clause: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "error building ORDER BY clause")
		return
	}

	//------------------------------------------------
	// 7. Tarkistetaan semanttisen haun parametri (vector_query=...)
	vector_query := request.URL.Query().Get("vector_query")
	langCode := request.URL.Query().Get("lang")
	if vector_query != "" {
		log.Printf("[DEBUG] semantic search param: %s", vector_query)

		useLang := false
		if langCode != "" {
			if ok, err := tableHasLangEmbeddings(readQuerier, table_name); err == nil && ok {
				useLang = true
			}
		}

		vectorVal, embErr := generateVectorParam(vector_query)
		if embErr != nil {
			log.Printf("\033[31merror generateVectorParam: %s\033[0m\n", embErr.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, fmt.Sprintf("error generateVectorParam: %v", embErr))
			return
		}

		query_args = append(query_args, vectorVal)
		vecIndex := len(query_args)
		if useLang {
			query_args = append(query_args, langCode)
			langIndex := len(query_args)
			quotedTable := pq.QuoteIdentifier(table_name)
			quotedEmbeddingsTable := quoteDerivedTableName(table_name, "_lang_embeddings")
			join_clauses += fmt.Sprintf(
				" JOIN (SELECT DISTINCT ON (host_row_id) host_row_id, embedding FROM %s WHERE language_code = $%d ORDER BY host_row_id, updated DESC) le ON le.host_row_id = %s.id",
				quotedEmbeddingsTable, langIndex, quotedTable)
			order_by_clause = fmt.Sprintf(" ORDER BY le.embedding <-> $%d", vecIndex)
		} else {
			// Tarkista embedding_vector-sarake
			var columnExists bool
			err = readQuerier.QueryRow(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'embedding_vector' AND table_schema = 'public')`, table_name).Scan(&columnExists)
			if err != nil || !columnExists {
				response_data := map[string]interface{}{"columns": []string{}, "data": []map[string]interface{}{}, "types": map[string]interface{}{}, "resultsPerLoad": 0}
				json.NewEncoder(response_writer).Encode(response_data)
				return
			}
			order_by_clause = fmt.Sprintf(" ORDER BY %s.embedding_vector <-> $%d",
				pq.QuoteIdentifier(table_name), vecIndex)
		}
	}

	// ------------------------------------------------
	// 8. Kootaan lopullinen SQL-kysely
	query := fmt.Sprintf(
		"SELECT %s FROM %s %s%s%s LIMIT %d OFFSET %d",
		select_columns,
		pq.QuoteIdentifier(table_name),
		join_clauses,
		where_clause,
		order_by_clause,
		results_per_load,
		offset_value,
	)

	// Lisätään lokitus: tulostetaan SQL-kysely ja argumentit
	// log.Printf("Suoritetaan SQL-kysely: %s, argumentit: %v", query, query_args)

	rows_result, err := readQuerier.Query(query, query_args...)
	if err != nil {
		log.Printf("\033[31merror executing query: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching data")
		return
	}
	defer rows_result.Close()

	// ------------------------------------------------
	// 9. Luetaan tulokset ja muotoillaan JSON
	result_columns, err := rows_result.Columns()
	if err != nil {
		log.Printf("\033[31merror fetching columns from result: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching columns")
		return
	}

	query_results := make([]map[string]interface{}, 0)
	for rows_result.Next() {
		row_values := make([]interface{}, len(result_columns))
		row_pointers := make([]interface{}, len(result_columns))
		for i := range row_values {
			row_pointers[i] = &row_values[i]
		}

		if err := rows_result.Scan(row_pointers...); err != nil {
			log.Printf("\033[31merror processing rows: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing rows")
			return
		}

		current_row_result := make(map[string]interface{})
		for i, column_name := range result_columns {
			val := row_values[i]
			switch typed_val := val.(type) {
			case time.Time:
				current_row_result[column_name] = typed_val.Format("2006-01-02 15:04:05")
			case []byte:
				current_row_result[column_name] = string(typed_val)
			default:
				current_row_result[column_name] = typed_val
			}
		}
		query_results = append(query_results, current_row_result)
	}

	if err := rows_result.Err(); err != nil {
		log.Printf("\033[31merror processing rows (rows_result err): %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing rows")
		return
	}

	// Lisätään laajennettu lokitus tulosten määrästä ja esimerkistä
	if len(query_results) == 0 {
		log.Printf("vector search returned no rows for table %s, query: %s, args: %v", table_name, query, query_args)
	} else {
		log.Printf("vector search returned %d rows for table %s", len(query_results), table_name)
		// Valinnainen: tulosta ensimmäinen tulos tarkistusta varten
		// if len(query_results) > 0 {
		// 	log.Printf("Ensimmäinen tulos: %v", query_results[0])
		// }
	}

	// 10. Palautetaan tulokset JSON-muodossa
	response_data := map[string]interface{}{
		"columns":        result_columns,
		"data":           query_results,
		"types":          column_data_types,
		"resultsPerLoad": results_per_load,
	}

	response_writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(response_writer).Encode(response_data); err != nil {
		log.Printf("\033[31merror encoding response: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding response")
		return
	}
}

// generateVectorParam generates an embedding vector via the configured provider.
func generateVectorParam(queryText string) (pgvector.Vector, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	embedding, err := dtt_openai.GenerateEmbedding(ctx, queryText)
	if err != nil {
		return pgvector.Vector{}, err
	}
	return pgvector.NewVector(embedding), nil
}

func tableHasLangEmbeddings(db rowQueryer, table string) (bool, error) {
	var flag bool
	err := db.QueryRow(`SELECT multi_lang_embeddings FROM system_db_tables WHERE table_name=$1`, table).Scan(&flag)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return flag, nil
}
