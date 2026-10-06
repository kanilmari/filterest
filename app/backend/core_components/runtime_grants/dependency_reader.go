// dependency_reader.go
// Discovers label, linking, upload, gallery, automation and embedding dependencies.
// Reuses the label resolver and canonical gallery discovery on the same transaction.
// Stores identifiers and required operations only, never configuration values.
package runtime_grants

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"

	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"easelect/backend/core_components/fk_display"
)

func loadDependencies(ctx context.Context, tx *sql.Tx, snapshot *GrantSnapshot) (err error) {
	defer func() {
		if err != nil {
			err = metadataReaderError("loadDependencies", err, snapshot.Roles)
		}
	}()
	cachedLabels, actors := map[string]bool{}, map[string]bool{}
	var caches []uploadCacheDependency
	marksOID := oidByName(snapshot, "system_row_actor_columns")
	if marksOID != 0 {
		query := `SELECT m.table_uid,m.table_uid,m.actor_role,m.column_name,true FROM public.system_row_actor_columns m`
		legacy := !snapshot.Objects[marksOID].hasColumn("table_uid")
		if legacy {
			// Preserve legacy rows even when their registry join is dangling.
			query = `SELECT m.table_id,d.table_uid,m.actor_role,m.column_name,d.id IS NOT NULL FROM public.system_row_actor_columns m LEFT JOIN public.system_db_tables d ON d.id=m.table_id`
		}
		if err := readRows(ctx, tx, query, nil, func(rows *sql.Rows) error {
			var key, uid sql.NullInt64
			var actor, column sql.NullString
			var registered bool
			if err := rows.Scan(&key, &uid, &actor, &column, &registered); err != nil {
				return err
			}
			keyColumn := "table_uid"
			if legacy {
				keyColumn = "table_id"
			}
			row := fmt.Sprintf("(%s=%d, actor_role=%s)", keyColumn, key.Int64, actor.String)
			if legacy && key.Valid && !registered {
				metadataFinding(snapshot, "system_row_actor_columns", row, "blocker", fmt.Sprintf("missing registry table_id=%d", key.Int64))
				return nil
			}
			// app_row_actor_column joins registry.table_uid (or legacy id).
			// A NULL identity cannot suppress a label used by that application path.
			oids, ok := metadataUIDObjects(snapshot, "system_row_actor_columns", row, metadataUID{"table_uid", uid})
			if !ok {
				return nil
			}
			if !column.Valid || !snapshot.Objects[oids[0]].hasColumn(column.String) {
				metadataFinding(snapshot, "system_row_actor_columns", row, "blocker", "missing actor column on snapshot table")
				return nil
			}
			actors[fmt.Sprintf("%d/%s", oids[0], column.String)] = true
			return nil
		}); err != nil {
			return fmt.Errorf("read actor metadata: %w", err)
		}
	}
	if oidByName(snapshot, "system_foreign_key_relations_1_m") != 0 {
		// getOneToManyRelations, updateCacheTargetsBase and ListRelationStatuses
		// join both UIDs to system_db_tables. NULL on either side cannot reach a
		// dataset child/cache/gallery path. Load all consumers in this one pass
		// so unusable rows get exactly one finding, even with upload/cache specs.
		// Direct uploads are different: loadFileUploadConfigForUpload joins only
		// the source UID (saveUploadedFiles also accepts a main-row upload). A
		// usable config with a NULL parent therefore needs a blocker: simply
		// skipping its filename UPDATE would under-grant a reachable path. The
		// pure policy must refuse it until that identity contract is resolved.
		withTargetColumn := snapshot.Objects[oidByName(snapshot, "system_foreign_key_relations_1_m")].hasColumn("target_column_name")
		query := `SELECT id,source_table_uid,target_table_uid,source_column_name,COALESCE(cached_name_col_in_src,''),insert_new_source_with_target,target_insert_specs`
		if withTargetColumn {
			query += `,target_column_name`
		}
		query += ` FROM public.system_foreign_key_relations_1_m ORDER BY id`
		if err := readRows(ctx, tx, query, nil, func(rows *sql.Rows) error {
			var id int64
			var sourceUID, targetUID sql.NullInt64
			var column, targetColumn sql.NullString
			var cached string
			var owned sql.NullBool
			var specs []byte
			fields := []any{&id, &sourceUID, &targetUID, &column, &cached, &owned, &specs}
			if withTargetColumn {
				fields = append(fields, &targetColumn)
			}
			if err := rows.Scan(fields...); err != nil {
				return err
			}
			row := fmt.Sprintf("id %d", id)
			if sourceUID.Valid && !targetUID.Valid && column.Valid {
				source := oidByUID(snapshot, sourceUID.Int64)
				if _, usable := dtt_card_picture.ParseUploadConfig(specs); source != 0 && snapshot.Objects[source].hasColumn("filename") && usable {
					metadataFinding(snapshot, "system_foreign_key_relations_1_m", row, "blocker", fmt.Sprintf("NULL target_table_uid but direct upload still uses source_table_uid=%d; source-only upload identity contract requires review before omitting filename UPDATE", sourceUID.Int64))
				}
			}
			oids, ok := metadataUIDObjects(snapshot, "system_foreign_key_relations_1_m", row, metadataUID{"source_table_uid", sourceUID}, metadataUID{"target_table_uid", targetUID})
			if !ok {
				return nil
			}
			source, target := oids[0], oids[1]
			if !column.Valid || !snapshot.Objects[source].hasColumn(column.String) {
				metadataFinding(snapshot, "system_foreign_key_relations_1_m", row, "blocker", "missing source_column_name on snapshot table")
				return nil
			}
			if withTargetColumn && (!targetColumn.Valid || !snapshot.Objects[target].hasColumn(targetColumn.String)) {
				metadataFinding(snapshot, "system_foreign_key_relations_1_m", row, "blocker", "missing target_column_name on snapshot table")
				return nil
			}
			if cached != "" {
				cachedLabels[fmt.Sprintf("%d/%s", source, column.String)] = true
			}
			if owned.Valid && owned.Bool {
				snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: target, TargetOID: source, Kind: "child", When: Insert, Requires: Insert})
			}
			// Existing 1:M links require the child's own strict update capability.
			snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: target, TargetOID: source, Kind: "child", When: Insert, Requires: Update})
			var envelope struct {
				FileUpload *struct {
					CacheTargets []struct{ Table, Column string } `json:"cache_targets"`
				} `json:"file_upload"`
			}
			if len(specs) == 0 {
				return nil
			}
			if err := json.Unmarshal(specs, &envelope); err != nil {
				metadataFinding(snapshot, "system_foreign_key_relations_1_m", row, "blocker", "invalid file_upload/cache_targets metadata shape")
				return nil
			}
			if envelope.FileUpload == nil {
				return nil
			}
			for _, cache := range envelope.FileUpload.CacheTargets {
				destination := oidByName(snapshot, cache.Table)
				if destination == 0 || !snapshot.Objects[destination].hasColumn(cache.Column) {
					metadataFinding(snapshot, "system_foreign_key_relations_1_m", row, "blocker", fmt.Sprintf("missing cache destination table=%s column=%s", cache.Table, cache.Column))
					continue
				}
				caches = append(caches, uploadCacheDependency{id, source, target, destination, cache.Column})
			}
			return nil
		}); err != nil {
			return fmt.Errorf("read child/cache/upload dependencies: %w", err)
		}
	}
	if err := loadUploadCachePredicates(ctx, tx, snapshot, caches); err != nil {
		return err
	}
	if err := readRows(ctx, tx, `SELECT c.oid,c.conrelid,c.confrelid,src.attname,tgt.attname
	 FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey,c.confkey) keys(source_key,target_key)
	 JOIN pg_attribute src ON src.attrelid=c.conrelid AND src.attnum=keys.source_key
	 JOIN pg_attribute tgt ON tgt.attrelid=c.confrelid AND tgt.attnum=keys.target_key
	 WHERE c.contype='f' AND EXISTS(SELECT 1 FROM pg_class rel JOIN pg_namespace ns ON ns.oid=rel.relnamespace WHERE rel.oid=c.conrelid AND ns.nspname !~ '^pg_' AND ns.nspname<>'information_schema') ORDER BY c.oid,src.attnum`, nil, func(rows *sql.Rows) error {
		var id, source, target int64
		var sourceColumn, keyColumn string
		if err := rows.Scan(&id, &source, &target, &sourceColumn, &keyColumn); err != nil {
			return err
		}
		sourceObject, sourceKnown := snapshot.Objects[source]
		targetObject, targetKnown := snapshot.Objects[target]
		if !sourceKnown || !targetKnown {
			snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Kind: "table", ObjectOID: source, Object: "pg_catalog.pg_constraint", Finding: "blocker", Reason: fmt.Sprintf("pg_constraint row OID %d: missing snapshot identity conrelid=%d or confrelid=%d", id, source, target)})
			return nil
		}
		if sourceObject.DatasetUID == 0 {
			return nil
		}
		class, err := ClassifyTable(sourceObject)
		if err != nil {
			snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Kind: "table", ObjectOID: source, Object: sourceObject.Identifier(), Finding: "blocker", Reason: err.Error()})
			return nil
		}
		if class != Content {
			return nil
		}
		if !actors[fmt.Sprintf("%d/%s", source, sourceColumn)] && !cachedLabels[fmt.Sprintf("%d/%s", source, sourceColumn)] {
			display := targetObject.DisplayColumn
			if !targetObject.hasColumn(display) {
				textColumns := []string{}
				for _, column := range targetObject.Columns {
					if column.Text {
						textColumns = append(textColumns, column.Name)
					}
				}
				display, _ = fk_display.Resolve(targetObject.Name, textColumns)
			}
			// A missing text label produces no join in today's row reader.
			if display != "" {
				snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: source, TargetOID: target, Kind: "label", When: Read, Columns: []string{keyColumn, display}})
			}
		}
		if !targetObject.Protected && !accountTables[targetObject.Name] {
			snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: source, TargetOID: target, Kind: "lock", When: Insert | Update, Requires: Read, Columns: []string{"id"}})
		}
		return nil
	}); err != nil {
		return fmt.Errorf("read foreign-key dependencies failed: %w", err)
	}
	if oidByName(snapshot, "system_foreign_key_relations_m_m") != 0 {
		query := `SELECT id,table_a_uid,table_b_uid,bridging_table_uid`
		withColumns := snapshot.Objects[oidByName(snapshot, "system_foreign_key_relations_m_m")].hasColumn("bridging_col_a")
		if withColumns {
			query += `,bridging_col_a,bridging_col_b,table_a_column,table_b_column`
		}
		query += ` FROM public.system_foreign_key_relations_m_m ORDER BY id`
		if err := readRows(ctx, tx, query, nil, func(rows *sql.Rows) error {
			var id int64
			var aUID, bUID, bridgeUID sql.NullInt64
			var bridgeA, bridgeB, columnA, columnB sql.NullString
			fields := []any{&id, &aUID, &bUID, &bridgeUID}
			if withColumns {
				fields = append(fields, &bridgeA, &bridgeB, &columnA, &columnB)
			}
			if err := rows.Scan(fields...); err != nil {
				return err
			}
			// resolveManyToManyExistingLink/getManyToMany join all three UIDs;
			// no NULL identity can reach the bridge writer, so skipping is safe.
			oids, ok := metadataUIDObjects(snapshot, "system_foreign_key_relations_m_m", fmt.Sprintf("id %d", id), metadataUID{"table_a_uid", aUID}, metadataUID{"table_b_uid", bUID}, metadataUID{"bridging_table_uid", bridgeUID})
			if !ok {
				return nil
			}
			a, b, bridge := oids[0], oids[1], oids[2]
			if withColumns && (!bridgeA.Valid || !bridgeB.Valid || !columnA.Valid || !columnB.Valid ||
				!snapshot.Objects[bridge].hasColumn(bridgeA.String) || !snapshot.Objects[bridge].hasColumn(bridgeB.String) ||
				!snapshot.Objects[a].hasColumn(columnA.String) || !snapshot.Objects[b].hasColumn(columnB.String)) {
				metadataFinding(snapshot, "system_foreign_key_relations_m_m", fmt.Sprintf("id %d", id), "blocker", "missing bridge or referenced column on snapshot table")
				return nil
			}
			for _, pair := range [][2]int64{{a, b}, {b, a}} {
				snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: pair[0], TargetOID: bridge, RelatedOID: pair[1], Kind: "bridge", When: Insert, Requires: Insert})
				// A lock on the related target is conditional on both its read and
				// the independently stored bridge add right, evaluated by policy.
				snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: pair[0], TargetOID: pair[1], RelatedOID: bridge, Kind: "lock", When: Insert, Requires: Read, Columns: []string{"id"}})
			}
			return nil
		}); err != nil {
			return fmt.Errorf("read bridge dependencies failed: %w", err)
		}
	}
	if oidByName(snapshot, "system_triggers") != 0 {
		if err := readRows(ctx, tx, `SELECT id,source_table,target_table,action_values FROM public.system_triggers ORDER BY id`, nil, func(rows *sql.Rows) error {
			var id int64
			var sourceName, targetName sql.NullString
			var values []byte
			if err := rows.Scan(&id, &sourceName, &targetName, &values); err != nil {
				return err
			}
			row := fmt.Sprintf("id %d", id)
			// fetchTriggersForTable selects WHERE source_table=$1: NULL source
			// cannot run. A matched source with a NULL target is broken active SQL,
			// so report a blocker rather than treating it as an unused relation.
			if !sourceName.Valid {
				metadataFinding(snapshot, "system_triggers", row, "preserved_outside_scope", "no source_table identity; no automation grant follows")
				return nil
			}
			source, target := oidByName(snapshot, sourceName.String), oidByName(snapshot, targetName.String)
			if source == 0 || target == 0 {
				metadataFinding(snapshot, "system_triggers", row, "blocker", fmt.Sprintf("missing snapshot identity source_table=%s or target_table=%s", sourceName.String, targetName.String))
				return nil
			}
			columns := map[string]json.RawMessage{}
			if len(values) > 0 {
				if err := json.Unmarshal(values, &columns); err != nil {
					metadataFinding(snapshot, "system_triggers", row, "blocker", "invalid action_values metadata shape")
					return nil
				}
			}
			columnNames := make([]string, 0, len(columns))
			for column := range columns {
				columnNames = append(columnNames, column)
			}
			sort.Strings(columnNames)
			for _, column := range columnNames {
				if !snapshot.Objects[target].hasColumn(column) {
					metadataFinding(snapshot, "system_triggers", row, "blocker", "missing automation destination column "+column)
					return nil
				}
			}
			snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: source, TargetOID: target, Kind: "automation", When: Insert})
			return nil
		}); err != nil {
			return fmt.Errorf("read automation destinations: %w", err)
		}
	}
	for _, oid := range sortedObjectOIDs(*snapshot) {
		object := snapshot.Objects[oid]
		if object.Kind != "table" {
			continue
		}
		if host := oidByName(snapshot, trimEmbeddingSuffix(object.Name)); host != 0 && host != oid {
			snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: host, TargetOID: oid, Kind: "embedding", When: Read})
		}
		if object.DatasetUID == 0 {
			continue
		}
		class, err := ClassifyTable(object)
		if err != nil {
			snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Kind: "table", ObjectOID: oid, Object: object.Identifier(), Finding: "blocker", Reason: err.Error()})
			continue
		}
		if class != Content && class != Product && class != Dedicated {
			continue
		}
		// add_row_files.go:71,219,317 also accepts a main-row upload with no
		// relation/configuration. Its filename UPDATE needs no general edit right.
		if class == Content && object.hasColumn("filename") {
			snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: oid, TargetOID: oid, Kind: "cache", When: Insert, Columns: []string{"filename"}, ReadColumns: []string{"id"}})
		}
		if !object.hasColumn("cached_image") || oidByName(snapshot, "system_foreign_key_relations_1_m") == 0 {
			continue
		}
		gallery, err := dtt_card_picture.PictureRelationOf(snapshotQueryer{ctx: ctx, tx: tx}, object.Name)
		if err != nil {
			return fmt.Errorf("read gallery dependency for %s: %w", object.Identifier(), err)
		}
		if gallery == nil {
			continue
		}
		child := oidByName(snapshot, gallery.ChildTable)
		if child == 0 {
			snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Kind: "table", ObjectOID: oid, Object: object.Identifier(), Finding: "blocker", Reason: "gallery destination missing from snapshot: " + gallery.ChildTable})
			continue
		}
		if err := loadGalleryRequirements(ctx, tx, snapshot, oid, child, gallery); err != nil {
			return err
		}
	}
	return nil
}

// The canonical gallery helper uses the legacy Querier shape. Bind its reads
// to the audit deadline and refuse Exec so it cannot become a policy writer.
type snapshotQueryer struct {
	ctx context.Context
	tx  *sql.Tx
}

func (q snapshotQueryer) Query(query string, args ...any) (*sql.Rows, error) {
	return q.tx.QueryContext(q.ctx, query, args...)
}
func (q snapshotQueryer) QueryRow(query string, args ...any) *sql.Row {
	return q.tx.QueryRowContext(q.ctx, query, args...)
}
func (q snapshotQueryer) Exec(string, ...any) (sql.Result, error) {
	return nil, fmt.Errorf("snapshot metadata cannot execute mutations")
}

func trimEmbeddingSuffix(name string) string {
	const suffix = "_lang_embeddings"
	if len(name) > len(suffix) && name[len(name)-len(suffix):] == suffix {
		return name[:len(name)-len(suffix)]
	}
	return ""
}
