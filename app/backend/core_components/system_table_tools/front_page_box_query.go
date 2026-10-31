// front_page_box_query.go
// Validates saved Home box definitions at the API and execution boundaries.
// Connects strict JSON with registered UI languages, enabled dataset categories and columns.
// Prevents a stale or malformed definition from silently becoming a broader query.
package system_table_tools

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"unicode"
	"unicode/utf8"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"github.com/lib/pq"
)

type frontPageBoxQuery struct {
	RowGroup   []string `json:"row_group,omitempty"`
	SortColumn string   `json:"sort_column,omitempty"`
	SortOrder  string   `json:"sort_order,omitempty"`
}

var errFrontPageCategories = fmt.Errorf("%w: unavailable categories", errFrontPageInput)

// Raw messages distinguish omitted fields from explicit null/empty replacement.
func (input *frontPageBlockInput) UnmarshalJSON(raw []byte) error {
	type plain frontPageBlockInput
	var value plain
	if err := strictFrontPageJSON(raw, &value); err != nil {
		return err
	}
	*input = frontPageBlockInput(value)
	if err := json.Unmarshal(raw, &input.present); err != nil {
		return err
	}
	for key, value := range input.present {
		switch key {
		case "box_id", "dataset", "result_limit", "sort_order", "enabled", "title", "query", "category_links":
		default:
			return errFrontPageInput
		}
		if key != "title" && bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return errFrontPageInput
		}
	}
	return nil
}

func strictFrontPageJSON(raw []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return errFrontPageInput
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errFrontPageInput
	}
	return nil
}

func decodeFrontPageBoxQuery(raw json.RawMessage) (frontPageBoxQuery, error) {
	var query frontPageBoxQuery
	if len(raw) == 0 {
		return query, nil
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || strictFrontPageJSON(raw, &query) != nil {
		return query, errFrontPageInput
	}
	// Null values are not category arrays or sort strings.
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return query, errFrontPageInput
	}
	for key, value := range fields {
		if key != "row_group" && key != "sort_column" && key != "sort_order" {
			return query, errFrontPageInput
		}
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return query, errFrontPageInput
		}
	}
	if len(query.RowGroup) > 19 {
		return query, errFrontPageInput
	}
	seen := map[string]bool{}
	for _, slug := range query.RowGroup {
		if !rowGroupSlugPattern.MatchString(slug) || seen[slug] {
			return query, errFrontPageInput
		}
		seen[slug] = true
	}
	if _, exists := fields["sort_column"]; exists && (query.SortColumn == "" || len(query.SortColumn) > 63) {
		return query, errFrontPageInput
	}
	if _, exists := fields["sort_order"]; exists && query.SortOrder != "ASC" && query.SortOrder != "DESC" {
		return query, errFrontPageInput
	}
	return query, nil
}

var frontPageKnownLanguage = func(q dbutils.Querier, code string) (bool, error) {
	if frontPageQueryUnavailable(q) {
		return false, errFrontPageInput
	}
	var known bool
	err := q.QueryRow(`SELECT EXISTS (SELECT 1 FROM public.system_languages WHERE language_code=$1)`, code).Scan(&known)
	return known, err
}

func normalizeFrontPageBoxTitle(q dbutils.Querier, raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	var title map[string]string
	if strictFrontPageJSON(raw, &title) != nil || title == nil {
		return nil, errFrontPageInput
	}
	for code, text := range title {
		text = strings.TrimSpace(text)
		if !utf8.ValidString(text) || utf8.RuneCountInString(text) < 1 || utf8.RuneCountInString(text) > 100 || strings.ContainsAny(text, "<>") {
			return nil, errFrontPageInput
		}
		for _, char := range text {
			if unicode.IsControl(char) {
				return nil, errFrontPageInput
			}
		}
		known, err := frontPageKnownLanguage(q, code)
		if err != nil {
			return nil, err
		}
		if !known {
			return nil, errFrontPageInput
		}
		title[code] = text
	}
	if len(title) == 0 {
		return nil, nil
	}
	return json.Marshal(title)
}

// validateFrontPageBoxReferences uses catalogue existence, never viewer row counts.
// The canonical delegate later resolves selection through the viewer's row policy/RLS.
func validateFrontPageBoxReferences(q dbutils.Querier, block frontPageBlock) error {
	query, err := decodeFrontPageBoxQuery(block.Query)
	if err != nil || block.ResultLimit < 1 || block.ResultLimit > 20 || block.CategoryLinks < 0 || block.CategoryLinks > 3 {
		return errFrontPageInput
	}
	if _, err = normalizeFrontPageBoxTitle(q, block.Title); err != nil {
		return err
	}
	if len(query.RowGroup) > 0 {
		if frontPageQueryUnavailable(q) {
			return errFrontPageCategories
		}
		var count int
		err = q.QueryRow(`SELECT count(DISTINCT category.slug) FROM public.system_row_groups category
            LEFT JOIN public.system_row_group_classifications heading ON heading.id=category.classification_id
            WHERE category.slug=ANY($2::text[]) AND category.enabled
              AND (category.classification_id IS NULL OR heading.enabled)
              AND EXISTS (SELECT 1 FROM public.system_row_group_memberships membership
                JOIN public.system_db_tables registry USING(table_uid)
                WHERE membership.group_id=category.id AND registry.table_name=$1
                  AND COALESCE(NULLIF(registry.schema_name,''),'public')='public')`, block.Dataset, pq.Array(query.RowGroup)).Scan(&count)
		if err != nil {
			return err
		}
		if count != len(query.RowGroup) {
			return errFrontPageCategories
		}
	}
	if query.SortColumn != "" && query.SortColumn != "__newest" {
		if frontPageQueryUnavailable(q) {
			return errFrontPageInput
		}
		var exists bool
		err = q.QueryRow(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1 AND column_name=$2)`, block.Dataset, query.SortColumn).Scan(&exists)
		if err != nil {
			return err
		}
		if !exists {
			return errFrontPageInput
		}
	}
	return nil
}

func frontPageQueryUnavailable(q dbutils.Querier) bool {
	if q == nil {
		return true
	}
	db, isDB := q.(*sql.DB)
	return isDB && db == nil
}

func validateFrontPageBoxInputFields(block *frontPageBlockInput) error {
	if _, err := decodeFrontPageBoxQuery(block.Query); err != nil {
		return err
	}
	if block.CategoryLinks != nil && (*block.CategoryLinks < 0 || *block.CategoryLinks > 3) {
		return errFrontPageInput
	}
	if block.Title != nil {
		var err error
		block.Title, err = normalizeFrontPageBoxTitle(backend.Db, block.Title)
		// Retain explicit clearing after normalization, distinct from an omitted title.
		if block.Title == nil {
			block.Title = json.RawMessage("null")
		}
		return err
	}
	return nil
}
