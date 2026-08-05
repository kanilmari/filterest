// embedding_stream_handler.go
// Manages embedding creation, refresh, and validation for AI-backed search endpoints.
// Calls the embedding API to generate vectors for table rows and persists
// results to the pgvector embedding columns for semantic similarity search.
package ai_features

import (
	"context"
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/security"
	e_sessions "easelect/backend/core_components/sessions"
	"fmt"
	"io"
	"log"
	"net/http"
	"easelect/backend/core_components/httpresponse"
	"strings"
	"time"

	pgvector "github.com/pgvector/pgvector-go"
)

// EmbeddingStreamHandler lukee kaikki sarakkeet jokaiselta riviltä,
// kokoaa vain tekstisarakkeet (VARCHAR/TEXT) yhdeksi tekstilauseeksi ja generoi
// embeddingin embedding_vector-sarakkeeseen (lisää sarakkeen jos sitä ei ole).
func EmbeddingStreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET method allowed for SSE")
		return
	}

	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "Unauthorized: login required")
		return
	}

	tableName := r.URL.Query().Get("dataset")
	if tableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing dataset query param")
		return
	}
	sanitizedTableName, err := security.SanitizeIdentifier(tableName)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "server does not support streaming")
		return
	}

	sendSSE := func(eventName, data string) {
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventName, data)
		flusher.Flush()
	}

	db := backend.Db

	// Tarkistetaan, onko embedding_vector-saraketta jo olemassa.
	colCheckQuery := `
		SELECT column_name
		FROM information_schema.columns
		WHERE table_name = $1
		  AND column_name = 'embedding_vector'
	`
	var existingColumn string
	err = db.QueryRow(colCheckQuery, sanitizedTableName).Scan(&existingColumn)
	if err == sql.ErrNoRows {
		// Luodaan sarake, jos ei löydy
		alterQuery := fmt.Sprintf("ALTER TABLE %s ADD COLUMN embedding_vector vector", sanitizedTableName)
		if _, alterErr := db.Exec(alterQuery); alterErr != nil {
			log.Printf("\033[31merror: adding embedding_vector column: %v\033[0m", alterErr)
			sendSSE("error", escape_for_sse(fmt.Sprintf("could not add embedding_vector column: %v", alterErr)))
			return
		}
	} else if err != nil {
		log.Printf("\033[31merror: checking embedding_vector column: %v\033[0m", err)
		sendSSE("error", escape_for_sse(fmt.Sprintf("column check error: %v", err)))
		return
	}

	// Haetaan tekstisarakkeet util-funktion avulla
	textCols, err := dbutils.GetQueryableColumns(sanitizedTableName, db, true)
	if err != nil {
		log.Printf("\033[31merror: fetching text columns: %v\033[0m", err)
		sendSSE("error", escape_for_sse(fmt.Sprintf("error fetching text columns: %v", err)))
		return
	}
	textColumnsSet := make(map[string]bool)
	for _, colName := range textCols {
		textColumnsSet[colName] = true
	}

	// Haetaan kaikki sarakkeet (koska tarvitaan myös id).
	selectQuery := fmt.Sprintf(`SELECT * FROM %s`, sanitizedTableName)
	rows, err := db.Query(selectQuery)
	if err != nil {
		log.Printf("\033[31merror: selecting rows: %v\033[0m", err)
		sendSSE("error", escape_for_sse(fmt.Sprintf("select error: %v", err)))
		return
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		log.Printf("\033[31merror: fetching columns: %v\033[0m", err)
		sendSSE("error", escape_for_sse(fmt.Sprintf("error fetching columns: %v", err)))
		return
	}

	// Etsitään 'id'-sarake
	idColIndex := -1
	for i, colName := range columns {
		if strings.EqualFold(colName, "id") {
			idColIndex = i
			break
		}
	}
	if idColIndex == -1 {
		sendSSE("error", escape_for_sse("no 'id' column found in table"))
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	var totalRows int
	var embeddedCount int

	numCols := len(columns)
	for rows.Next() {
		totalRows++
		values := make([]interface{}, numCols)
		ptrs := make([]interface{}, numCols)
		for i := 0; i < numCols; i++ {
			ptrs[i] = &values[i]
		}

		if err := rows.Scan(ptrs...); err != nil {
			log.Printf("\033[31merror: scan error: %v\033[0m", err)
			sendSSE("error", escape_for_sse(fmt.Sprintf("scan error row=%d: %v", totalRows, err)))
			continue
		}

		rowIDVal := values[idColIndex]
		var rowID int
		switch v := rowIDVal.(type) {
		case int64:
			rowID = int(v)
		case int32:
			rowID = int(v)
		case int:
			rowID = v
		default:
			sendSSE("error", escape_for_sse(fmt.Sprintf("row has non-int id: %v", rowIDVal)))
			continue
		}

		rowText := buildRowText(columns, values, textColumnsSet)
		log.Printf("[DEBUG] row id=%v: rowText length=%d", rowIDVal, len(rowText))
		if len(rowText) < 500 {
			log.Printf("[DEBUG] rowText content = %q", rowText)
		}

		if strings.TrimSpace(rowText) == "" {
			sendSSE("progress", escape_for_sse(fmt.Sprintf("row id=%d empty text, skipped", rowID)))
			continue
		}

		embeddingVec, err := GenerateEmbedding(ctx, rowText)
		if err != nil {
			log.Printf("\033[31merror: embedding error (id=%d): %v\033[0m", rowID, err)
			sendSSE("error", escape_for_sse(fmt.Sprintf("row=%d: %v", rowID, err)))
			continue
		}

		if err := storeEmbeddingInDB(db, sanitizedTableName, rowID, embeddingVec); err != nil {
			log.Printf("\033[31merror: store embedding error (id=%d): %v\033[0m", rowID, err)
			sendSSE("error", escape_for_sse(fmt.Sprintf("row=%d: %v", rowID, err)))
			continue
		}

		embeddedCount++
		sendSSE("progress", escape_for_sse(fmt.Sprintf("embedded row id=%d", rowID)))
	}
	if err := rows.Err(); err != nil && err != io.EOF {
		log.Printf("\033[31merror: rows iteration error: %v\033[0m", err)
		sendSSE("error", escape_for_sse(fmt.Sprintf("rows error: %v", err)))
	}

	sendSSE("done", escape_for_sse(fmt.Sprintf("embedding finished. total=%d, embedded=%d", totalRows, embeddedCount)))
}

// buildRowText luo yksinkertaisen tekstin vain niistä sarakkeista, jotka löytyvät textColumnsSet:stä.
// Ohitetaan myös embedding_vector-sarake varmuuden vuoksi.
func buildRowText(columns []string, values []interface{}, textColumnsSet map[string]bool) string {
	var sb strings.Builder
	for i, colName := range columns {
		// Ei käsitellä embedding_vector -saraketta
		if strings.EqualFold(colName, "embedding_vector") {
			continue
		}
		// Otetaan mukaan vain tekstipohjaiset sarakkeet
		if !textColumnsSet[colName] {
			continue
		}

		val := values[i]
		var valStr string
		if val == nil {
			valStr = "NULL"
		} else {
			fullStr := fmt.Sprintf("%v", val)
			if len(fullStr) > 2000 {
				fullStr = fullStr[:2000] + "...(truncated)"
			}
			valStr = fullStr
		}

		if sb.Len() > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString(colName)
		sb.WriteString(" is ")
		sb.WriteString(valStr)
	}
	return sb.String()
}

func storeEmbeddingInDB(db *sql.DB, sanitizedTableName string, rowID int, embedding []float32) error {
	vectorVal := pgvector.NewVector(embedding)
	sqlStr := fmt.Sprintf("UPDATE %s SET embedding_vector = $1 WHERE id = $2", sanitizedTableName)
	_, err := db.Exec(sqlStr, vectorVal, rowID)
	if err != nil {
		return fmt.Errorf("update error: %w", err)
	}
	return nil
}
