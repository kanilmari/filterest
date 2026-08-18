// refresh_lang_embeddings.go
// HTTP handler that triggers a full refresh of multilingual embeddings for a
// specified dataset. Recomputes embedding vectors for all rows using current
// language strings and writes the results back to the embedding store.
package ai_features

import (
	"context"
	"crypto/md5"
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/lib/pq"
	pgvector "github.com/pgvector/pgvector-go"
)

type queryExecer interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
	QueryRow(query string, args ...interface{}) *sql.Row
	Query(query string, args ...interface{}) (*sql.Rows, error)
}

type refreshRequest struct {
	Dataset   string   `json:"dataset"`
	Languages []string `json:"languages"`
}

type embeddingDatasetSummary struct {
	Dataset               string `json:"dataset"`
	GeneralEmbedding      bool   `json:"general_embedding"`
	MultilingualEmbedding bool   `json:"multilingual_embedding"`
}

const embeddingDatasetCatalogQuery = `
		WITH RECURSIVE current_project_folders AS (
			SELECT id
			FROM system_table_folders
			WHERE is_current_project = true
			UNION ALL
			SELECT child.id
			FROM system_table_folders child
			INNER JOIN current_project_folders parent ON child.parent_id = parent.id
		)
		SELECT
			sdt.table_name,
			EXISTS (
				SELECT 1
				FROM information_schema.columns isc
				WHERE isc.table_schema = 'public'
				  AND isc.table_name = sdt.table_name
				  AND isc.column_name = 'embedding_vector'
			),
			COALESCE(sdt.multi_lang_embeddings, false)
		FROM system_db_tables sdt
		WHERE COALESCE(NULLIF(sdt.schema_name, ''), 'public') = 'public'
		  AND (
			(
				$1
				AND sdt.folder_id IN (SELECT id FROM current_project_folders)
				AND EXISTS (
					SELECT 1
					FROM system_column_details scd
					JOIN information_schema.columns isc
					  ON isc.table_schema = 'public'
					 AND isc.table_name = sdt.table_name
					 AND isc.column_name = scd.column_name
					WHERE scd.table_uid = sdt.table_uid
					  AND isc.data_type IN ('text', 'character varying')
				)
			)
			OR (
				NOT $1
				AND (
					COALESCE(sdt.multi_lang_embeddings, false)
					OR EXISTS (
						SELECT 1
						FROM information_schema.columns isc
						WHERE isc.table_schema = 'public'
						  AND isc.table_name = sdt.table_name
						  AND isc.column_name = 'embedding_vector'
					)
				)
			)
		  )
		ORDER BY sdt.table_name`

func GetEmbeddingDatasetsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET allowed")
		return
	}
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}
	includePolicyCandidates := r.URL.Query().Get("include_policy_candidates") == "true"
	rows, err := tx.Query(embeddingDatasetCatalogQuery, includePolicyCandidates)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows.Close()
	includeCapabilities := r.URL.Query().Get("include_capabilities") == "true"
	tables := make([]string, 0)
	summaries := make([]embeddingDatasetSummary, 0)
	for rows.Next() {
		var name string
		var generalEmbedding bool
		var multilingualEmbedding bool
		if err := rows.Scan(&name, &generalEmbedding, &multilingualEmbedding); err == nil {
			tables = append(tables, name)
			summaries = append(summaries, embeddingDatasetSummary{
				Dataset:               name,
				GeneralEmbedding:      generalEmbedding,
				MultilingualEmbedding: multilingualEmbedding,
			})
		}
	}
	w.Header().Set("Content-Type", "application/json")
	if includeCapabilities {
		json.NewEncoder(w).Encode(summaries)
		return
	}
	json.NewEncoder(w).Encode(tables)
}

func RefreshLangEmbeddingsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if strings.TrimSpace(req.Dataset) == "" || len(req.Languages) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing dataset or languages")
		return
	}
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}
	rows, err := tx.Query(fmt.Sprintf(`SELECT id FROM %s`, pq.QuoteIdentifier(req.Dataset)))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "query error")
		return
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: scan ids for %s: %v\033[0m", req.Dataset, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "query error")
		rows.Close()
		return
	}
	rows.Close()
	count := 0
	for _, id := range ids {
		if err := generateLangEmbeddingsForRow(tx, req.Dataset, id, req.Languages); err == nil {
			count++
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"updated": count, "timestamp": time.Now()})
}

func CountLangEmbeddingsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if strings.TrimSpace(req.Dataset) == "" || len(req.Languages) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing dataset or languages")
		return
	}
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}
	rows, err := tx.Query(fmt.Sprintf(`SELECT id FROM %s`, pq.QuoteIdentifier(req.Dataset)))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "query error")
		return
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: scan ids for %s: %v\033[0m", req.Dataset, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "query error")
		rows.Close()
		return
	}
	rows.Close()
	pending := 0
	for _, id := range ids {
		need, err := needLangEmbeddingsForRow(tx, req.Dataset, id, req.Languages)
		if err == nil && need {
			pending++
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"pending": pending})
}

func generateLangEmbeddingsForRow(tx queryExecer, tableName string, rowID int64, langs []string) error {
	embTable := pq.QuoteIdentifier(tableName + "_lang_embeddings")
	existing := map[string]string{}
	rows, err := tx.Query(fmt.Sprintf(`SELECT language_code, content_md5 FROM %s WHERE host_row_id=$1`, embTable), rowID)
	if err != nil {
		log.Printf("\033[31merror: query existing embeddings for %s row %d: %v\033[0m", tableName, rowID, err)
		return err
	}
	for rows.Next() {
		var code, hash string
		if err := rows.Scan(&code, &hash); err == nil {
			existing[code] = hash
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: iterate embeddings rows for %s row %d: %v\033[0m", tableName, rowID, err)
		rows.Close()
		return err
	}
	rows.Close()
	source, err := LoadAuthorizedEmbeddingSource(tx, tableName, rowID, false)
	if err != nil {
		return err
	}
	for _, lang := range langs {
		joined := strings.TrimSpace(source.ByLanguage[lang])
		if strings.TrimSpace(joined) == "" {
			continue
		}
		hash := fmt.Sprintf("%x", md5.Sum([]byte(joined)))
		if existing[lang] == hash {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		embedding, err := GenerateEmbedding(ctx, joined)
		cancel()
		if err != nil || len(embedding) == 0 {
			return err
		}
		vec := pgvector.NewVector(embedding)
		del := fmt.Sprintf(`DELETE FROM %s WHERE host_row_id=$1 AND language_code=$2`, embTable)
		if _, err := tx.Exec(del, rowID, lang); err != nil {
			log.Printf("\033[31merror: delete embedding for %s row %d lang %s: %v\033[0m", tableName, rowID, lang, err)
			return err
		}
		ins := fmt.Sprintf(`INSERT INTO %s (host_row_id, language_code, embedding, updated, content_md5) VALUES ($1,$2,$3,NOW(),$4)`, embTable)
		if _, err := tx.Exec(ins, rowID, lang, vec, hash); err != nil {
			log.Printf("\033[31merror: insert embedding for %s row %d lang %s: %v\033[0m", tableName, rowID, lang, err)
			return err
		}
	}
	return nil
}

func needLangEmbeddingsForRow(tx queryExecer, tableName string, rowID int64, langs []string) (bool, error) {
	embTable := pq.QuoteIdentifier(tableName + "_lang_embeddings")
	existing := map[string]string{}
	rows, err := tx.Query(fmt.Sprintf(`SELECT language_code, content_md5 FROM %s WHERE host_row_id=$1`, embTable), rowID)
	if err != nil {
		log.Printf("\033[31merror: query existing embeddings for %s row %d: %v\033[0m", tableName, rowID, err)
		return false, err
	}
	for rows.Next() {
		var code, hash string
		if err := rows.Scan(&code, &hash); err == nil {
			existing[code] = hash
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: iterate embeddings rows for %s row %d: %v\033[0m", tableName, rowID, err)
		rows.Close()
		return false, err
	}
	rows.Close()
	source, err := LoadAuthorizedEmbeddingSource(tx, tableName, rowID, false)
	if err != nil {
		return false, err
	}
	for _, lang := range langs {
		joined := strings.TrimSpace(source.ByLanguage[lang])
		if strings.TrimSpace(joined) == "" {
			continue
		}
		hash := fmt.Sprintf("%x", md5.Sum([]byte(joined)))
		if existing[lang] != hash {
			return true, nil
		}
	}
	return false, nil
}

func detectLanguage(text string) string {
	lowered := strings.ToLower(text)
	if strings.ContainsAny(lowered, "äö") {
		return "fi"
	}
	return "en"
}
