// intelligent_search_filters.go
// Validates optional text-search filters using server metadata and the actor's SELECT rights.
// Bridges search authorization with the existing ordinary-list WHERE builder before ranking LIMIT.
// Keeps forbidden fields, client-supplied metadata and invalid filters out of fallback queries.
package dtt_1_row_read

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

var errInvalidIntelligentSearchFilters = errors.New("invalid search filters")

func parseIntelligentSearchFilters(raw string) (map[string]string, error) {
	filters := map[string]string{}
	if strings.TrimSpace(raw) == "" {
		return filters, nil
	}
	if len(raw) > 16384 || json.Unmarshal([]byte(raw), &filters) != nil || filters == nil || len(filters) > 64 {
		return nil, errInvalidIntelligentSearchFilters
	}
	for key, value := range filters {
		if len(key) == 0 || len(key) > 128 || len(value) > 2048 {
			return nil, errInvalidIntelligentSearchFilters
		}
	}
	return filters, nil
}

// prepareIntelligentSearchFilters accepts only delivered columns also selectable by this DB role.
// The same metadata-derived types and localized expressions as ordinary list filters are reused.
func prepareIntelligentSearchFilters(tableName, lang string, filters map[string]string, allowed []string, types map[string]interface{}) (url.Values, map[string]dtt_models.ColumnInfo, error) {
	permitted := make(map[string]bool, len(allowed))
	for _, name := range allowed {
		permitted[name] = true
	}
	columns := map[string]dtt_models.ColumnInfo{}
	for name, raw := range types {
		metadata, ok := raw.(map[string]interface{})
		if !ok || !permitted[name] {
			continue
		}
		dataType, _ := metadata["data_type"].(string)
		multilingual, _ := metadata["is_multilingual"].(bool)
		columns[name] = dtt_models.ColumnInfo{ColumnName: name, DataType: dataType, IsMultilingual: multilingual}
	}
	values := url.Values{}
	if lang != "" {
		values.Set("lang", lang)
	}
	for rawKey, value := range filters {
		if value == "" {
			continue
		}
		key := stripTablePrefix(rawKey, tableName)
		base, _, _ := resolveFilterColumn(key, func(name string) bool {
			// Resolve against all delivered metadata first, then require SELECT.
			// A forbidden exact field must never become an operator on an allowed base.
			_, known := types[name]
			return known
		})
		if _, ok := columns[base]; !ok {
			return nil, nil, errInvalidIntelligentSearchFilters
		}
		// Avoid two differently prefixed keys silently replacing one another.
		if _, exists := values[key]; exists {
			return nil, nil, errInvalidIntelligentSearchFilters
		}
		values.Set(key, value)
	}
	return values, columns, nil
}

func withIntelligentSearchFilters(db *sql.DB, tableName, raw, lang string, authorization intelligentSearchAuthorization) (intelligentSearchAuthorization, error) {
	filters, err := parseIntelligentSearchFilters(raw)
	if err != nil {
		return authorization, err
	}
	if len(filters) == 0 {
		return authorization, nil
	}
	allowed, err := fetchUserSelectableColumns(db, tableName)
	if err != nil {
		return authorization, fmt.Errorf("search filter permissions: %w", err)
	}
	// This metadata reader excludes server-only, hidden-everywhere and transport-only vector fields.
	types, err := getColumnDataTypesWithFK(tableName, db)
	if err != nil {
		return authorization, fmt.Errorf("search filter metadata: %w", err)
	}
	values, columns, err := prepareIntelligentSearchFilters(tableName, lang, filters, allowed, types)
	if err != nil {
		return authorization, err
	}
	authorization.userFilters = values
	authorization.filterColumns = columns
	authorization.filterTypes = types
	return authorization, nil
}
