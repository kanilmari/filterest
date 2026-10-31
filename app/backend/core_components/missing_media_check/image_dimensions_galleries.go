// image_dimensions_galleries.go
// Combines card-gallery discovery and upload relations with registry identities.
// Connects the name-based discovery readers to explicitly qualified backfill targets.
// Keeps same-named physical galleries separate and refuses uncertain ownership.
package missing_media_check

import (
	"sort"
	"strings"

	"easelect/backend/core_components/dbutils"
	links "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
)

type dimensionGallery struct {
	relationTarget
	Schema   string
	resolved bool
}

type dimensionRelation struct {
	dimensionGallery
	ID int
}

// The relation id and table UIDs, never a bare name, establish schema ownership.
func dimensionRelations(q dbutils.Querier) ([]dimensionRelation, error) {
	rows, err := q.Query(`SELECT fk.id, COALESCE(src.schema_name, ''), COALESCE(src.table_name, ''),
		COALESCE(tgt.table_name, ''), COALESCE(tgt.table_uid::text, ''), COALESCE(fk.source_column_name, '')
		FROM "public"."system_foreign_key_relations_1_m" fk
		LEFT JOIN "public"."system_db_tables" src ON src.table_uid=fk.source_table_uid
		LEFT JOIN "public"."system_db_tables" tgt ON tgt.table_uid=fk.target_table_uid
		ORDER BY fk.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var relations []dimensionRelation
	for rows.Next() {
		var relation dimensionRelation
		if err := rows.Scan(&relation.ID, &relation.Schema, &relation.AssetTable, &relation.Dataset, &relation.ParentTableUID, &relation.ForeignKey); err != nil {
			return nil, err
		}
		relation.resolved = relation.Schema != "" && relation.AssetTable != "" && relation.ParentTableUID != "" && relation.ForeignKey != ""
		relations = append(relations, relation)
	}
	return relations, rows.Err()
}

// The separate count retains unsupported structural galleries omitted by the
// public-only card reader, without making them row-read or write targets.
func dimensionGalleries(q dbutils.Querier) ([]dimensionGallery, int, error) {
	relations, err := dimensionRelations(q)
	if err != nil {
		return nil, 0, err
	}
	rows, err := q.Query(`SELECT table_name, table_uid::text FROM "public"."system_db_tables" WHERE schema_name='public' ORDER BY table_name`)
	if err != nil {
		return nil, 0, err
	}
	parents := map[string]string{}
	var names []string
	for rows.Next() {
		var name, uid string
		if err := rows.Scan(&name, &uid); err != nil {
			rows.Close()
			return nil, 0, err
		}
		parents[name] = uid
		names = append(names, name)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, 0, err
	}
	type identity struct{ schema, table string }
	seen := map[identity]int{}
	var targets []dimensionGallery
	add := func(target dimensionGallery, file string) {
		target.FilenameColumn = file
		key := identity{target.Schema, target.AssetTable}
		if index, exists := seen[key]; exists {
			previous := &targets[index]
			// Conflicting storage/column ownership of one physical table is unsafe.
			if previous.relationTarget != target.relationTarget || !target.resolved {
				previous.resolved = false
			}
			return
		}
		seen[key] = len(targets)
		targets = append(targets, target)
	}
	for _, name := range names {
		gallery, err := dtt_card_picture.PictureRelationOf(q, name)
		if err != nil {
			return nil, 0, err
		}
		if gallery != nil {
			matched := false
			for _, relation := range relations {
				if relation.ParentTableUID == parents[name] && relation.AssetTable == gallery.ChildTable && relation.ForeignKey == gallery.ForeignKey {
					add(relation.dimensionGallery, gallery.FilenameColumn)
					matched = true
				}
			}
			if !matched {
				// A conventional <parent>_assets fallback is not proof of ownership.
				add(dimensionGallery{relationTarget: relationTarget{Dataset: name, ParentTableUID: parents[name], AssetTable: gallery.ChildTable}}, gallery.FilenameColumn)
			}
		}
	}
	statuses, err := links.ListFileUploadRelationStatuses(q, "")
	if err != nil {
		return nil, 0, err
	}
	for _, status := range statuses {
		file := strings.TrimSpace(status.UploadConfig.FilenameColumn)
		if file == "" {
			file = "filename"
		}
		var matches []dimensionGallery
		for _, relation := range relations {
			if relation.ID == status.RelationID {
				matches = append(matches, relation.dimensionGallery)
			}
		}
		if len(matches) == 1 {
			add(matches[0], file)
		} else {
			add(dimensionGallery{relationTarget: relationTarget{AssetTable: status.ChildTable}}, file)
		}
	}
	unsupported := map[identity]bool{}
	for _, relation := range relations {
		key := identity{relation.Schema, relation.AssetTable}
		if !relation.resolved || relation.Schema == "public" || parents[relation.Dataset] != relation.ParentTableUID || unsupported[key] {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		// Match structural discovery's asset kind, stored-name and FK columns using
		// catalog metadata only. Unlike information_schema, this also sees columns
		// when the application has no permission to read the non-public gallery.
		var structural bool
		err := q.QueryRow(`SELECT COALESCE(bool_or(a.attname='asset_kind')
			AND bool_or(a.attname IN ('filename', 'stored_filename', 'original_name'))
			AND bool_or(a.attname=$3), false)
			FROM "pg_catalog"."pg_attribute" a
			JOIN "pg_catalog"."pg_class" c ON c.oid=a.attrelid
			JOIN "pg_catalog"."pg_namespace" n ON n.oid=c.relnamespace
			WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind IN ('r', 'p', 'v', 'f')
			AND a.attnum>0 AND NOT a.attisdropped`, relation.Schema, relation.AssetTable, relation.ForeignKey).Scan(&structural)
		if err != nil {
			return nil, 0, err
		}
		if structural {
			unsupported[key] = true
		}
	}
	sort.Slice(targets, func(i, j int) bool {
		if targets[i].Schema != targets[j].Schema {
			return targets[i].Schema < targets[j].Schema
		}
		return targets[i].AssetTable < targets[j].AssetTable
	})
	return targets, len(unsupported), nil
}

// Only one real public table is writable. ONLY in row SQL also excludes inherited
// tables, which can belong to another schema even when the parent is public.
func dimensionGalleryWritable(q dbutils.Querier, target dimensionGallery) (bool, error) {
	if !target.resolved || target.Schema != "public" {
		return false, nil
	}
	var exists bool
	err := q.QueryRow(`SELECT count(*)=1 FROM "pg_catalog"."pg_class" c
		JOIN "pg_catalog"."pg_namespace" n ON n.oid=c.relnamespace
		WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind='r'`, target.Schema, target.AssetTable).Scan(&exists)
	return exists, err
}
