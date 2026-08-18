// lang_embedding_handler.go
// Generates multilingual embeddings for table rows by fetching language strings
// and computing embedding vectors via the configured AI provider. Results are
// written back to the embedding store for use in semantic search.
package ai_features

import (
	"easelect/backend/core_components/httpresponse"
	"fmt"
	"log"
	"net/http"
	"strings"

	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/lib/pq"
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

	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}

	rows, err := tx.Query(fmt.Sprintf(`SELECT id FROM %s`, pq.QuoteIdentifier(tableName)))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "row fetch error")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var rowID int64
		if err := rows.Scan(&rowID); err != nil {
			continue
		}
		if err := generateLangEmbeddingsForRow(tx, tableName, rowID, languages); err != nil {
			log.Printf("\033[31merror: generate approved language embeddings for row %d: %v\033[0m", rowID, err)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: rows iteration error in LangEmbeddingHandler: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "rows iteration error")
		return
	}
	w.WriteHeader(http.StatusCreated)
}
