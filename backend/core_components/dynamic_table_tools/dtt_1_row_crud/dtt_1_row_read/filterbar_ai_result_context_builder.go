// filterbar_ai_result_context_builder.go
// Builds compact result-context snapshots for the API-first filter bar AI chat.
// Bridges canonical dataset read responses and LLM-safe conversation memory.
// Exists so chat can discuss previous results without exposing raw SQL or unlimited row data.
package dtt_1_row_read

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	filterbarAIResultContextMaxRows         = 20
	filterbarAIResultContextMaxBytes        = 8 * 1024
	filterbarAIResultContextMaxFieldsPerRow = 6
	filterbarAIResultContextCellChars       = 160
	filterbarAIResultMemoryMarker           = "[easelect_result_context]"
)

type filterbarAIResultContext struct {
	Dataset      string                        `json:"dataset"`
	Mode         string                        `json:"mode"`
	Level        string                        `json:"level"`
	Error        string                        `json:"error,omitempty"`
	SearchQuery  string                        `json:"search_query,omitempty"`
	Filters      map[string]string             `json:"filters,omitempty"`
	RowsReturned int                           `json:"rows_returned"`
	RowsVisible  int                           `json:"rows_visible"`
	RowCount     int                           `json:"row_count,omitempty"`
	ContextBytes int                           `json:"context_bytes"`
	Truncated    bool                          `json:"truncated"`
	Notes        []string                      `json:"notes,omitempty"`
	Rows         []filterbarAIResultContextRow `json:"rows"`
	Related      []filterbarAIResultContext    `json:"related,omitempty"`
}

type filterbarAIResultContextRow struct {
	Index     int               `json:"index"`
	ID        string            `json:"id,omitempty"`
	Title     string            `json:"title,omitempty"`
	Fields    map[string]string `json:"fields,omitempty"`
	Truncated bool              `json:"truncated,omitempty"`
}

func buildFilterbarAIResultContext(dataset string, plan filterbarAIQueryPlan, result map[string]interface{}) filterbarAIResultContext {
	columns := extractFilterbarAIResultColumns(result["columns"])
	rawRows := extractFilterbarAIResultRows(result["data"])
	rowCount := filterbarAINumberFromResult(result["row_count"])

	context := filterbarAIResultContext{
		Dataset:      dataset,
		Mode:         plan.Mode,
		Level:        "overview",
		SearchQuery:  strings.TrimSpace(plan.SearchQuery),
		Filters:      cloneFilterbarAIResultContextFilters(plan.Filters),
		RowsReturned: len(rawRows),
		RowCount:     rowCount,
		Notes: []string{
			"overview only; long cells are previewed and may be truncated",
			"use the canonical API again to refine the search or open specific rows",
		},
		Rows: []filterbarAIResultContextRow{},
	}

	for index, rawRow := range rawRows {
		if index >= filterbarAIResultContextMaxRows {
			context.Truncated = true
			break
		}

		rowMap, ok := rawRow.(map[string]interface{})
		if !ok {
			continue
		}
		nextRow := buildFilterbarAIResultContextRow(index+1, columns, rowMap)
		candidate := context
		candidate.Rows = append(candidate.Rows, nextRow)
		candidate.RowsVisible = len(candidate.Rows)
		candidate.ContextBytes = estimateFilterbarAIResultContextBytes(candidate)
		if candidate.ContextBytes > filterbarAIResultContextMaxBytes && len(context.Rows) > 0 {
			context.Truncated = true
			break
		}
		context = candidate
	}

	context.RowsVisible = len(context.Rows)
	context.ContextBytes = estimateFilterbarAIResultContextBytes(context)
	if context.RowsVisible < context.RowsReturned {
		context.Truncated = true
	}
	return context
}

// buildFilterbarAIErrorResultContext records a failed read as answer context instead of fabricated rows.
// Between: canonical delegate errors and the LLM answer prompt.
// Why: Multi-call turns can still answer cautiously when one dataset read fails.
func buildFilterbarAIErrorResultContext(dataset string, plan filterbarAIQueryPlan, err error) filterbarAIResultContext {
	errorMessage := ""
	if err != nil {
		errorMessage = strings.TrimSpace(err.Error())
	}
	return filterbarAIResultContext{
		Dataset: dataset,
		Mode:    plan.Mode,
		Level:   "error",
		Error:   errorMessage,
		Notes: []string{
			"this canonical API read failed; answer with uncertainty instead of inventing rows",
		},
		Rows: []filterbarAIResultContextRow{},
	}
}

// combineFilterbarAIResultContexts nests related dataset results under one memory envelope.
// Between: multiple canonical read contexts and the existing hidden chat memory format.
// Why: Preserves the single-memory frontend contract while carrying cross-dataset evidence.
func combineFilterbarAIResultContexts(primaryDataset string, contexts []filterbarAIResultContext) filterbarAIResultContext {
	if len(contexts) == 0 {
		return filterbarAIResultContext{
			Dataset: strings.TrimSpace(primaryDataset),
			Mode:    "answer_only",
			Level:   "overview",
			Notes: []string{
				"no canonical API read returned rows for this turn",
			},
			Rows: []filterbarAIResultContextRow{},
		}
	}

	primaryIndex := 0
	for index, context := range contexts {
		if context.Dataset == primaryDataset {
			primaryIndex = index
			break
		}
	}
	combined := contexts[primaryIndex]
	if len(contexts) > 1 {
		combined.Notes = append(combined.Notes, "multiple canonical API reads were executed for this chat turn")
	}
	for index, context := range contexts {
		if index == primaryIndex {
			continue
		}
		combined.Related = append(combined.Related, context)
	}
	combined.ContextBytes = estimateFilterbarAIResultContextBytes(combined)
	if combined.ContextBytes > filterbarAIResultContextMaxBytes {
		combined.Truncated = true
	}
	return combined
}

func buildFilterbarAIResultContextRow(index int, columns []string, row map[string]interface{}) filterbarAIResultContextRow {
	idColumn := pickFilterbarAIResultIDColumn(columns, row)
	titleColumn := pickFilterbarAIResultTitleColumn(columns, row)
	contextRow := filterbarAIResultContextRow{
		Index:  index,
		ID:     previewFilterbarAIResultCell(row[idColumn], filterbarAIResultContextCellChars),
		Title:  previewFilterbarAIResultCell(row[titleColumn], filterbarAIResultContextCellChars),
		Fields: map[string]string{},
	}

	for _, column := range columns {
		if column == "" || column == idColumn || column == titleColumn {
			continue
		}
		value := previewFilterbarAIResultCell(row[column], filterbarAIResultContextCellChars)
		if value == "" {
			continue
		}
		contextRow.Fields[column] = value
		if len(contextRow.Fields) >= filterbarAIResultContextMaxFieldsPerRow {
			contextRow.Truncated = true
			break
		}
	}

	if contextRow.ID == "" && idColumn != "" {
		contextRow.ID = previewFilterbarAIResultCell(row[idColumn], filterbarAIResultContextCellChars)
	}
	if contextRow.Title == "" && titleColumn != "" {
		contextRow.Title = previewFilterbarAIResultCell(row[titleColumn], filterbarAIResultContextCellChars)
	}
	return contextRow
}

func cloneFilterbarAIResultContextFilters(filters map[string]string) map[string]string {
	if len(filters) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(filters))
	for key, value := range filters {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" {
			continue
		}
		cloned[key] = value
	}
	if len(cloned) == 0 {
		return nil
	}
	return cloned
}

func buildFilterbarAIResultMemory(context filterbarAIResultContext) *aiChatConversationMessage {
	rawContext, err := json.Marshal(context)
	if err != nil {
		return nil
	}
	return &aiChatConversationMessage{
		Role:    "system",
		Content: filterbarAIResultMemoryMarker + "\n" + string(rawContext),
	}
}

func extractFilterbarAIResultColumns(raw interface{}) []string {
	values, ok := raw.([]interface{})
	if !ok {
		return []string{}
	}
	columns := make([]string, 0, len(values))
	for _, value := range values {
		column := strings.TrimSpace(fmt.Sprint(value))
		if column != "" {
			columns = append(columns, column)
		}
	}
	return columns
}

func extractFilterbarAIResultRows(raw interface{}) []interface{} {
	rows, ok := raw.([]interface{})
	if !ok {
		return []interface{}{}
	}
	return rows
}

func filterbarAINumberFromResult(raw interface{}) int {
	switch value := raw.(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	case json.Number:
		parsed, _ := value.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func pickFilterbarAIResultIDColumn(columns []string, row map[string]interface{}) string {
	for _, candidate := range []string{"id", "row_id"} {
		if _, ok := row[candidate]; ok {
			return candidate
		}
	}
	for _, column := range columns {
		lowered := strings.ToLower(column)
		if lowered == "id" || strings.HasSuffix(lowered, "_id") {
			return column
		}
	}
	return ""
}

func pickFilterbarAIResultTitleColumn(columns []string, row map[string]interface{}) string {
	preferred := []string{"header", "title", "name", "label", "nimi", "otsikko"}
	for _, candidate := range preferred {
		if value := previewFilterbarAIResultCell(row[candidate], filterbarAIResultContextCellChars); value != "" {
			return candidate
		}
	}
	for _, column := range columns {
		lowered := strings.ToLower(column)
		if lowered == "id" || strings.HasSuffix(lowered, "_id") {
			continue
		}
		if value := previewFilterbarAIResultCell(row[column], filterbarAIResultContextCellChars); value != "" {
			return column
		}
	}
	return ""
}

func previewFilterbarAIResultCell(raw interface{}, maxChars int) string {
	if raw == nil {
		return ""
	}
	value := strings.Join(strings.Fields(fmt.Sprint(raw)), " ")
	if value == "" || utf8.RuneCountInString(value) <= maxChars {
		return value
	}
	runes := []rune(value)
	return strings.TrimSpace(string(runes[:maxChars-1])) + "..."
}

func estimateFilterbarAIResultContextBytes(context filterbarAIResultContext) int {
	rawContext, err := json.Marshal(context)
	if err != nil {
		return 0
	}
	return len(rawContext)
}
