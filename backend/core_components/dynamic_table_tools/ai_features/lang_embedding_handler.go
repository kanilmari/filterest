// lang_embedding_handler.go
// Generates multilingual embeddings for table rows by fetching language strings
// and computing embedding vectors via the configured AI provider. Results are
// written back to the embedding store for use in semantic search.
package ai_features

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"easelect/backend/core_components/httpresponse"
	"strings"
	"time"

	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/lib/pq"
	pgvector "github.com/pgvector/pgvector-go"
)

// LangEmbeddingHandler generates embeddings for each row of tableName
// in the given comma-separated languages query param "langs".
func LangEmbeddingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	tableName := r.URL.Query().Get("dataset")
	if tableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing dataset")
		return
	}
	langsParam := r.URL.Query().Get("langs")
	if langsParam == "" {
		langsParam = "en"
	}
	languages := strings.Split(langsParam, ",")

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}

	cols, err := dbutils.GetQueryableColumns(tableName, tx, true)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "column fetch error")
		return
	}
	quotedCols := make([]string, len(cols))
	for i, col := range cols {
		quotedCols[i] = pq.QuoteIdentifier(col)
	}
	selectCols := strings.Join(quotedCols, ", ")
	rows, err := tx.Query(fmt.Sprintf(`SELECT id, %s FROM %s`, selectCols, pq.QuoteIdentifier(tableName)))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "row fetch error")
		return
	}
	defer rows.Close()

	numCols := len(cols) + 1
	for rows.Next() {
		vals := make([]interface{}, numCols)
		ptrs := make([]interface{}, numCols)
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			continue
		}
		rowID, _ := vals[0].(int64)
		var parts []string
		for i := 1; i < numCols; i++ {
			if vals[i] != nil {
				str := strings.TrimSpace(fmt.Sprintf("%v", vals[i]))
				if str != "" {
					parts = append(parts, str)
				}
			}
		}
		joined := strings.Join(parts, " / ")
		if strings.TrimSpace(joined) == "" {
			continue
		}
		embedding, err := GenerateEmbedding(ctx, joined)
		if err != nil || len(embedding) == 0 {
			continue
		}
		vec := pgvector.NewVector(embedding)
		if err := storeLangEmbeddings(tx, tableName, int(rowID), languages, vec); err != nil {
			log.Printf("\033[31merror: storeLangEmbeddings for row %d: %v\033[0m", rowID, err)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: rows iteration error in LangEmbeddingHandler: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "rows iteration error")
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func storeLangEmbeddings(tx *sql.Tx, table string, rowID int, langs []string, vec pgvector.Vector) error {
	embTable := pq.QuoteIdentifier(table + "_lang_embeddings")
	for _, lang := range langs {
		del := fmt.Sprintf(`DELETE FROM %s WHERE host_row_id=$1 AND language_code=$2`, embTable)
		if _, err := tx.Exec(del, rowID, lang); err != nil {
			log.Printf("\033[31merror: deleting lang embedding for row %d lang %s: %v\033[0m", rowID, lang, err)
			return err
		}
		ins := fmt.Sprintf(`INSERT INTO %s (host_row_id, language_code, embedding, updated) VALUES ($1,$2,$3,NOW())`, embTable)
		if _, err := tx.Exec(ins, rowID, lang, vec); err != nil {
			log.Printf("\033[31merror: inserting lang embedding for row %d lang %s: %v\033[0m", rowID, lang, err)
			return err
		}
	}
	return nil
}
