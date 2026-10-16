// dataset_default_view_validator.go
// Determines which registered presentations can render a dataset as its default.
// Connects delivered column and self-reference metadata to the dataset view registry's contracts.
// Rejects specialized tools and unsupported shapes without inspecting content or changing rights.
package system_table_tools

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"easelect/backend/core_components/dbutils"
)

// Read the same immutable application config served to config_fetcher.js.
// Missing/malformed config inherits Cards, exactly as a failed frontend load does.
func readSiteDefaultView(applicationRoot string) string {
	var config struct {
		DefaultView string `json:"default_view"`
	}
	raw, err := os.ReadFile(filepath.Join(applicationRoot, "frontend", "config.json"))
	if err != nil || json.Unmarshal(raw, &config) != nil {
		return "card"
	}
	return config.DefaultView
}

// Match dataset_default_view.js: saved metadata, then config, then Cards.
// This exemption only chooses available controls; it grants no route or dataset rights.
func defaultViewPermissionFallback(saved *string, site string, chartAllowed bool) string {
	candidates := []string{site, "card"}
	if saved != nil {
		candidates = append([]string{*saved}, candidates...)
	}
	for _, candidate := range candidates {
		view := strings.TrimSpace(candidate)
		switch view {
		case "article", "big_card", "row_article":
			view = "article_view"
		}
		if view == "price_chart" && !chartAllowed {
			continue
		}
		switch view {
		case "card", "article_view", "table", "normal", "transposed", "tree", "ticket", "product_card", "calendar", "map", "price_chart", "settings", "cloud_management":
			return view
		}
	}
	return "card"
}

type defaultViewDatasetShape struct {
	dataset string
	columns map[string]string
	tree    bool
}

var defaultChartTemporalType = regexp.MustCompile(`^(date|time(\(\d+\))?( with(out)? time zone)?|timetz|timestamp(\(\d+\))?( with(out)? time zone)?|timestamptz)$`)
var defaultChartNumericType = regexp.MustCompile(`^(smallint|integer|bigint|int[248]?|smallserial|serial|bigserial|serial[248]|numeric(\(\d+(,\s*\d+)?\))?|decimal(\(\d+(,\s*\d+)?\))?|real|double precision|float[48]?)$`)

func readDefaultViewDatasetShape(q dbutils.Querier, dataset string, uid int) (defaultViewDatasetShape, error) {
	shape := defaultViewDatasetShape{dataset: dataset, columns: map[string]string{}}
	rows, err := q.Query(`SELECT c.column_name, CASE WHEN c.data_type='USER-DEFINED'
	 THEN pg_catalog.format_type(a.atttypid,a.atttypmod) ELSE c.data_type END
	 FROM information_schema.columns c LEFT JOIN public.system_column_details d
	 ON d.table_uid=$1 AND d.column_name=c.column_name
	 JOIN pg_class t ON t.relname=c.table_name JOIN pg_namespace n ON n.oid=t.relnamespace AND n.nspname=c.table_schema
	 JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=c.column_name AND NOT a.attisdropped
	 WHERE c.table_schema='public' AND c.table_name=$2
	 AND NOT COALESCE(d.hide_everywhere,false) AND COALESCE(d.client_delivery_mode,'include')='include'`, uid, dataset)
	if err != nil {
		return shape, err
	}
	for rows.Next() {
		var name, dataType string
		if err = rows.Scan(&name, &dataType); err != nil {
			rows.Close()
			return shape, err
		}
		shape.columns[strings.ToLower(name)] = strings.ToLower(dataType)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return shape, err
	}
	rows, err = q.Query(`SELECT parent.attname, referenced.attname FROM pg_constraint f
	 JOIN pg_class t ON t.oid=f.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
	 JOIN pg_attribute parent ON parent.attrelid=t.oid AND parent.attnum=f.conkey[1]
	 JOIN pg_attribute referenced ON referenced.attrelid=t.oid AND referenced.attnum=f.confkey[1]
	 WHERE f.contype='f' AND f.conrelid=f.confrelid AND cardinality(f.conkey)=1
	 AND n.nspname='public' AND t.relname=$1`, dataset)
	if err != nil {
		return shape, err
	}
	defer rows.Close()
	for rows.Next() {
		var parent, referenced string
		if err := rows.Scan(&parent, &referenced); err != nil {
			return shape, err
		}
		if parent != referenced && shape.columns[strings.ToLower(parent)] != "" && shape.columns[strings.ToLower(referenced)] != "" {
			shape.tree = true
		}
	}
	return shape, rows.Err()
}

func (shape defaultViewDatasetShape) offers(view string) bool {
	switch view {
	case "card", "article_view", "table", "normal", "transposed", "ticket", "product_card", "calendar":
		return true // Calendar also renders undated rows in its existing undated group.
	case "tree":
		return shape.tree || shape.dataset == "system_table_folders" || shape.dataset == "system_db_tables"
	case "price_chart":
		temporal, numeric := false, false
		for _, dataType := range shape.columns {
			temporal = temporal || defaultChartTemporalType.MatchString(dataType)
			numeric = numeric || defaultChartNumericType.MatchString(dataType)
		}
		return temporal && numeric
	case "map":
		for _, dataType := range shape.columns {
			if strings.HasSuffix(dataType, "geometry(point,4326)") || strings.HasSuffix(dataType, "geography(point,4326)") {
				return true
			}
		}
		for _, pair := range [][2]string{{"latitude", "longitude"}, {"lat", "lon"}, {"lat", "lng"}, {"y", "x"}, {"latitude", "lon"}, {"latitude", "lng"}, {"lat", "longitude"}} {
			if shape.columns[pair[0]] != "" && shape.columns[pair[1]] != "" {
				return true
			}
		}
		return false
	case "settings":
		key, valueType, value := false, false, false
		for name := range shape.columns {
			key = key || strings.Contains(name, "key")
			valueType = valueType || strings.Contains(name, "value_type")
			value = value || strings.Contains(name, "bool") || strings.Contains(name, "json") || strings.Contains(name, "text") || strings.Contains(name, "int")
		}
		return key && valueType && value
	default:
		// Cloud management is a separate operational tool; image_first_view has no dataset renderer.
		return false
	}
}

func defaultViewPermissionRoute(view string) string {
	switch view {
	case "normal":
		return "/ui/view/list"
	case "card", "article_view", "table", "transposed", "tree", "ticket", "settings", "price_chart":
		return "/ui/view/" + view
	default:
		return "" // These registry entries have no separate UI capability.
	}
}
