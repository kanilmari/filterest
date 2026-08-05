// fix_table_translations.go
// Repair handler that backfills missing JSON translation payloads in table cell content.
// Bridges dynamic dataset rows, lang helpers, and AI-backed translation completion.
// Exists to fix legacy or partial row translations without manual row-by-row editing.
package lang

import (
	"bytes"
	"context"
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"

	backend "easelect/backend/core_components"

	"github.com/lib/pq"
)

type FixTranslationsRequest struct {
	Table   string   `json:"table"`
	RowIDs  []int    `json:"row_ids"`
	Columns []string `json:"columns"`
}

type translationResult struct {
	En string `json:"en"`
	Fi string `json:"fi"`
}

// FixTableTranslationsHandler repairs the requested row/column cells and persists completed translation JSON.
func FixTableTranslationsHandler(w http.ResponseWriter, r *http.Request) {
	var req FixTranslationsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("\033[31merror: %v\033[0m", err))
		return
	}
	if req.Table == "" || len(req.RowIDs) == 0 || len(req.Columns) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "\033[31merror: missing data\033[0m")
		return
	}

	// Filter out columns whose card_element role contains 'image' —
	// these hold filenames (e.g. cached_image) and must never be JSON-wrapped.
	var tableUID int
	if err := backend.Db.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name = $1`, req.Table).Scan(&tableUID); err == nil {
		skipColSet := map[string]bool{}
		iceRows, iceErr := backend.Db.Query(
			`SELECT column_name FROM system_column_details WHERE table_uid = $1 AND card_element LIKE '%image%'`,
			tableUID,
		)
		if iceErr == nil {
			defer iceRows.Close()
			for iceRows.Next() {
				var cn string
				if iceRows.Scan(&cn) == nil {
					skipColSet[cn] = true
				}
			}
		}
		filtered := make([]string, 0, len(req.Columns))
		for _, c := range req.Columns {
			if !skipColSet[c] {
				filtered = append(filtered, c)
			}
		}
		req.Columns = filtered
		if len(req.Columns) == 0 {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
			return
		}
	}

	cols := append([]string{"id"}, req.Columns...)
	quotedCols := make([]string, len(cols))
	for i, c := range cols {
		quotedCols[i] = pq.QuoteIdentifier(c)
	}
	query := fmt.Sprintf("SELECT %s FROM %s WHERE id = ANY($1)", strings.Join(quotedCols, ","), pq.QuoteIdentifier(req.Table))
	rows, err := backend.Db.Query(query, pq.Array(req.RowIDs))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("\033[31merror: %v\033[0m", err))
		return
	}
	defer rows.Close()

	for rows.Next() {
		idVal := sql.NullInt64{}
		values := make([]sql.NullString, len(req.Columns))
		scanArgs := []interface{}{&idVal}
		for i := range values {
			scanArgs = append(scanArgs, &values[i])
		}
		if err := rows.Scan(scanArgs...); err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("\033[31merror: %v\033[0m", err))
			return
		}
		rowID := idVal.Int64
		for i, colName := range req.Columns {
			val := values[i]
			if !val.Valid || val.String == "" {
				continue
			}
			updated, err := ensureTranslations(r.Context(), val.String, colName)
			if err != nil {
				httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("\033[31merror: %v\033[0m", err))
				return
			}
			if updated == val.String {
				continue
			}
			updateQuery := fmt.Sprintf("UPDATE %s SET %s = $1 WHERE id = $2", pq.QuoteIdentifier(req.Table), pq.QuoteIdentifier(colName))
			if _, err := backend.Db.Exec(updateQuery, updated, rowID); err != nil {
				httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("\033[31merror: %v\033[0m", err))
				return
			}
		}
	}
	if err := rows.Err(); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("\033[31merror: %v\033[0m", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// ensureTranslations normalizes one cell value into a JSON object that contains both en and fi entries.
func ensureTranslations(ctx context.Context, value, column string) (string, error) {
	obj := map[string]string{}
	if err := json.Unmarshal([]byte(value), &obj); err != nil {
		lang := detectLanguage(value)
		obj[lang] = value
	}

	baseLang := ""
	base := ""
	if v, ok := obj["en"]; ok {
		baseLang = "en"
		base = v
	} else if v, ok := obj["fi"]; ok {
		baseLang = "fi"
		base = v
	} else {
		for k, v := range obj {
			baseLang = k
			base = v
			break
		}
	}

	_, enExists := obj["en"]
	_, fiExists := obj["fi"]
	if enExists && fiExists {
		return marshalOrdered(obj), nil
	}

	tr, err := translateText(ctx, base, column)
	if err != nil {
		return "", err
	}
	if !enExists {
		if baseLang == "en" {
			obj["en"] = base
		} else {
			obj["en"] = tr.En
		}
	}
	if !fiExists {
		if baseLang == "fi" {
			obj["fi"] = base
		} else {
			obj["fi"] = tr.Fi
		}
	}
	return marshalOrdered(obj), nil
}

// detectLanguage uses a lightweight character heuristic to pick a base language for plain-text cells.
func detectLanguage(text string) string {
	if strings.ContainsAny(text, "äöåÄÖÅ") {
		return "fi"
	}
	return "en"
}

// marshalOrdered serializes translation maps with a stable key order for repeatable writes.
func marshalOrdered(m map[string]string) string {
	buf := bytes.NewBufferString("{")
	if en, ok := m["en"]; ok {
		b, _ := json.Marshal(en)
		buf.WriteString("\"en\":")
		buf.Write(b)
		delete(m, "en")
		if len(m) > 0 {
			buf.WriteString(",")
		}
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for i, k := range keys {
		b, _ := json.Marshal(m[k])
		buf.WriteString(fmt.Sprintf("\"%s\":%s", k, string(b)))
		if i < len(keys)-1 {
			buf.WriteString(",")
		}
	}
	buf.WriteString("}")
	return buf.String()
}

// translateText asks the translation LLM for en/fi values for one source string.
func translateText(ctx context.Context, text, column string) (translationResult, error) {
	sysBytes, err := os.ReadFile("docs/instructions_and_documentation/ai_instructions/ai_db_cell_translations.md")
	if err != nil {
		return translationResult{}, err
	}
	systemMessage := string(sysBytes)
	if systemMessage == "" {
		return translationResult{}, fmt.Errorf("AI system message is empty")
	}

	userMsg := fmt.Sprintf("column: %s\ncell content: %s", column, text)

	content, err := chatCompletionForTranslation(ctx, systemMessage, userMsg)
	if err != nil {
		return translationResult{}, err
	}

	content = extractJSONFromLLMResponse(content)
	if strings.HasPrefix(content, "[") {
		var arr []translationResult
		if err := json.Unmarshal([]byte(content), &arr); err != nil {
			log.Printf("\033[31munexpected AI response: %s\033[0m", content)
			return translationResult{}, err
		}
		if len(arr) == 0 {
			return translationResult{}, fmt.Errorf("empty translation array")
		}
		return arr[0], nil
	}
	var tr translationResult
	if err := json.Unmarshal([]byte(content), &tr); err != nil {
		log.Printf("\033[31munexpected AI response: %s\033[0m", content)
		return translationResult{}, err
	}
	return tr, nil
}
