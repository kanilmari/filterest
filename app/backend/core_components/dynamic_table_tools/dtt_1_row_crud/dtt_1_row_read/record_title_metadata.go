// record_title_metadata.go
// Delivers the natural record label only when the current presentation may read it.
// Connects cached dataset metadata to the request's SELECT and visibility intersection.
// Keeps authorization out of the shared cache and never fetches a missing title value.
package dtt_1_row_read

import (
	"log"
	"maps"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"

	"github.com/lib/pq"
)

// Only schema facts are cached: authorization remains with the requesting query.
// A missing catalogue entry is deliberately unproven, rather than a safe default.
type recordTitleTargetMetadata struct {
	DataType           string
	IsMultilingual     bool
	HideEverywhere     bool
	ClientDeliveryMode string
}

// fetchRecordTitleAliasTargets reads all actual join targets in one schema lookup
// on a join-cache miss. It never reads target row values or authorizes a field.
func fetchRecordTitleAliasTargets(db dbutils.Querier, keys map[string]dtt_utils.ForeignKey) (map[string]recordTitleTargetMetadata, error) {
	sources, tables, columns := []string{}, []string{}, []string{}
	for source, key := range keys {
		if key.ReferencedTable != "" && key.NameColumn != "" {
			sources = append(sources, source)
			tables = append(tables, key.ReferencedTable)
			columns = append(columns, key.NameColumn)
		}
	}
	targets := make(map[string]recordTitleTargetMetadata)
	if len(sources) == 0 {
		return targets, nil
	}
	rows, err := db.Query(`
		SELECT title_sources.source_column,
		       CASE WHEN physical.data_type = 'USER-DEFINED' THEN physical.udt_name ELSE physical.data_type END,
		       COALESCE(details.is_multilingual, false), COALESCE(details.hide_everywhere, false),
		       COALESCE(details.client_delivery_mode, 'include')
		FROM unnest($1::text[], $2::text[], $3::text[])
		     AS title_sources(source_column, target_table, target_column)
		JOIN public.system_db_tables AS datasets ON datasets.table_name = title_sources.target_table
		 AND COALESCE(datasets.schema_name, 'public') = 'public'
		JOIN public.system_column_details AS details
		  ON details.table_uid = datasets.table_uid AND details.column_name = title_sources.target_column
		JOIN information_schema.columns AS physical
		  ON physical.table_schema = 'public' AND physical.table_name = title_sources.target_table
		 AND physical.column_name = title_sources.target_column`, pq.Array(sources), pq.Array(tables), pq.Array(columns))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var source string
		var target recordTitleTargetMetadata
		if err := rows.Scan(&source, &target.DataType, &target.IsMultilingual, &target.HideEverywhere, &target.ClientDeliveryMode); err != nil {
			return nil, err
		}
		targets[source] = target
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return targets, nil
}

// authorizedRecordTitleMeta filters a value copy after the authorized query. A
// schema cache entry is shared by actors; never redact or authorize it in place.
func authorizedRecordTitleMeta(meta dtt_models.TableReadMeta, visibleColumns []string, types map[string]interface{}) dtt_models.TableReadMeta {
	column := meta.FKDisplayColumn
	visible := false
	for _, name := range visibleColumns {
		if name == column {
			visible = true
			break
		}
	}
	description, present := types[column].(map[string]interface{})
	if !visible || !present || description["hide_everywhere"] == true ||
		(description["client_delivery_mode"] != nil && description["client_delivery_mode"] != "include") {
		meta.FKDisplayColumn = ""
	}
	return meta
}

// recordTitleAliasSources copies schema facts about the actual alias target onto
// this response. Query construction already loaded them; this never loads row
// values, authorizes a field, or modifies a shared schema/cache entry.
func recordTitleAliasSources(tableName string, types map[string]interface{}) map[string]interface{} {
	metadata, found := getCachedJoinMetadata(tableName)
	if !found {
		return types
	}
	return withRecordTitleAliasTargets(types, metadata.foreignKeys, metadata.titleTargets)
}

// relatedRecordTitleAliasSources uses the related query's authorized join set.
// That query does not populate the listing join cache; batch schema facts here
// without reading another record or publishing request permissions to a cache.
func relatedRecordTitleAliasSources(db dbutils.Querier, keys map[string]dtt_utils.ForeignKey, types map[string]interface{}) map[string]interface{} {
	if backend.Db != nil {
		db = backend.Db
	}
	targets, err := fetchRecordTitleAliasTargets(db, keys)
	if err != nil {
		log.Printf("\033[31merror: reading related relation title metadata: %v\033[0m", err)
	}
	return withRecordTitleAliasTargets(types, keys, targets)
}

func withRecordTitleAliasTargets(types map[string]interface{}, keys map[string]dtt_utils.ForeignKey, targets map[string]recordTitleTargetMetadata) map[string]interface{} {
	result := maps.Clone(types)
	for column, foreignKey := range keys {
		description, ok := types[column].(map[string]interface{})
		if !ok {
			continue
		}
		copy := maps.Clone(description)
		copy["foreign_display_column"] = foreignKey.NameColumn
		delete(copy, "foreign_display_metadata")
		if target, proven := targets[column]; proven {
			copy["foreign_display_metadata"] = map[string]interface{}{
				"data_type":            target.DataType,
				"is_multilingual":      target.IsMultilingual,
				"hide_everywhere":      target.HideEverywhere,
				"client_delivery_mode": target.ClientDeliveryMode,
			}
		}
		result[column] = copy
	}
	return result
}
