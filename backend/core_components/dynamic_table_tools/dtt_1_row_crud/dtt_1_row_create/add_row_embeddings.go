// add_row_embeddings.go
// Generates and stores vector embeddings for newly added rows.
// Bridges the AI embedding API and the database vector column.
// Exists to enable semantic search by writing embeddings at row-creation time.
package dtt_1_row_create

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"easelect/backend/core_components/dbutils"
	dtt_openai "easelect/backend/core_components/dynamic_table_tools/ai_features"

	"github.com/lib/pq"
	pgvector "github.com/pgvector/pgvector-go"
)

// hasEmbeddingVectorColumn palauttaa true, jos taulussa on embedding_vector -sarake.
// Between: AddRowMultipartHandler -> Database
// Why: Checks if the table supports OpenAI embeddings.
func hasEmbeddingVectorColumn(tableName string, q rowQueryer) bool {
	query := `
		SELECT column_name
		FROM information_schema.columns
		WHERE table_name = $1
		  AND column_name = 'embedding_vector'
	`
	var dummyCol string
	err := q.QueryRow(query, tableName).Scan(&dummyCol)
	if err == sql.ErrNoRows {
		return false
	} else if err != nil {
		fmt.Printf("\033[31m[add_row_embeddings.go] [hasEmbeddingVectorColumn] error: %s\033[0m\n", err.Error())
		return false
	}
	// dummyCol ei sinällään tarvita, vain varmistus että sarake on.
	return true
}

// tableHasLangEmbeddings checks multi_lang_embeddings from system_db_tables.
// Between: AddRowMultipartHandler -> Database
// Why: Checks if the table supports multi-language embeddings.
func tableHasLangEmbeddings(tableName string, q rowQueryer) bool {
	var flag bool
	err := q.QueryRow(`SELECT multi_lang_embeddings FROM system_db_tables WHERE table_name = $1`, tableName).Scan(&flag)
	if err != nil {
		return false
	}
	return flag
}

// generateOpenAIEmbeddingForSingleRow hakee rivin tekstisarakkeet, muodostaa embeddingin
// ja tallentaa sen embedding_vector-sarakkeeseen.
// Between: AddRowMultipartHandler -> OpenAI API -> Database
// Why: Generates and stores an OpenAI embedding for a single row.
func generateOpenAIEmbeddingForSingleRow(q queryExecer, tableName string, rowID int64) error {
	textCols, err := dbutils.GetQueryableColumns(tableName, q, true)
	if err != nil {
		return fmt.Errorf("failed to fetch text columns: %w", err)
	}
	if len(textCols) == 0 {
		return nil
	}

	quotedCols := make([]string, len(textCols))
	for i, col := range textCols {
		quotedCols[i] = pq.QuoteIdentifier(col)
	}
	selectCols := strings.Join(quotedCols, ", ")
	sqlStr := fmt.Sprintf(`SELECT %s FROM %s WHERE id=$1`, selectCols, pq.QuoteIdentifier(tableName))
	row := q.QueryRow(sqlStr, rowID)

	data := make([]interface{}, len(textCols))
	ptrs := make([]interface{}, len(textCols))
	for i := range data {
		ptrs[i] = &data[i]
	}
	if err := row.Scan(ptrs...); err != nil {
		return fmt.Errorf("failed to read row (id=%d): %w", rowID, err)
	}

	var textParts []string
	for i := range textCols {
		val := data[i]
		if val == nil {
			continue
		}
		strVal := fmt.Sprintf("%v", val)
		trimmed := strings.TrimSpace(strVal)
		if trimmed != "" {
			textParts = append(textParts, trimmed)
		}
	}
	joinedText := strings.Join(textParts, " / ")
	if strings.TrimSpace(joinedText) == "" {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	embedding, err := dtt_openai.GenerateEmbedding(ctx, joinedText)
	if err != nil {
		return fmt.Errorf("embedding error: %w", err)
	}

	vectorVal := pgvector.NewVector(embedding)
	updateQuery := fmt.Sprintf(`UPDATE %s SET embedding_vector = $1 WHERE id = $2`, pq.QuoteIdentifier(tableName))
	if _, err := q.Exec(updateQuery, vectorVal, rowID); err != nil {
		return fmt.Errorf("failed to save embedding: %w", err)
	}

	return nil
}

// generateLangEmbeddingsForRow creates an embedding for rowID and stores it in
// <table>_lang_embeddings for English and Finnish.
// Between: AddRowMultipartHandler -> OpenAI API -> Database
// Why: Generates and stores multi-language embeddings for a single row.
func generateLangEmbeddingsForRow(q queryExecer, tableName string, rowID int64, langs []string) error {
	var hostUpdated time.Time
	err := q.QueryRow(fmt.Sprintf(`SELECT updated FROM %s WHERE id=$1`, pq.QuoteIdentifier(tableName)), rowID).Scan(&hostUpdated)
	if err != nil {
		return err
	}

	embTable := pq.QuoteIdentifier(tableName + "_lang_embeddings")
	rows, err := q.Query(fmt.Sprintf(`SELECT language_code, updated FROM %s WHERE host_row_id=$1`, embTable), rowID)
	if err == nil {
		existing := make(map[string]time.Time)
		for rows.Next() {
			var code string
			var upd time.Time
			if err := rows.Scan(&code, &upd); err == nil {
				existing[code] = upd
			}
		}
		_ = rows.Err() // non-critical: best-effort prefetch of existing embeddings
		var missing []string
		for _, l := range langs {
			if upd, ok := existing[l]; !ok || upd.Before(hostUpdated) {
				missing = append(missing, l)
			}
		}
		langs = missing
	}

	if len(langs) == 0 {
		return nil
	}
	textCols, err := dbutils.GetQueryableColumns(tableName, q, true)
	if err != nil {
		return err
	}
	if len(textCols) == 0 {
		return nil
	}

	quotedCols2 := make([]string, len(textCols))
	for i, col := range textCols {
		quotedCols2[i] = pq.QuoteIdentifier(col)
	}
	selectCols := strings.Join(quotedCols2, ", ")
	row := q.QueryRow(fmt.Sprintf(`SELECT %s FROM %s WHERE id=$1`, selectCols, pq.QuoteIdentifier(tableName)), rowID)
	data := make([]interface{}, len(textCols))
	ptrs := make([]interface{}, len(textCols))
	for i := range data {
		ptrs[i] = &data[i]
	}
	if err := row.Scan(ptrs...); err != nil {
		return err
	}

	var parts []string
	for i := range textCols {
		if data[i] != nil {
			s := strings.TrimSpace(fmt.Sprintf("%v", data[i]))
			if s != "" {
				parts = append(parts, s)
			}
		}
	}
	joined := strings.Join(parts, " / ")
	if strings.TrimSpace(joined) == "" {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	embedding, err := dtt_openai.GenerateEmbedding(ctx, joined)
	if err != nil || len(embedding) == 0 {
		return err
	}
	vec := pgvector.NewVector(embedding)

	for _, lang := range langs {
		del := fmt.Sprintf(`DELETE FROM %s WHERE host_row_id=$1 AND language_code=$2`, embTable)
		if _, err := q.Exec(del, rowID, lang); err != nil {
			return err
		}
		ins := fmt.Sprintf(`INSERT INTO %s (host_row_id, language_code, embedding, updated) VALUES ($1,$2,$3,NOW())`, embTable)
		if _, err := q.Exec(ins, rowID, lang, vec); err != nil {
			return err
		}
	}
	return nil
}
