// card_image_usage_read.go
// Delivers exact per-field image-use identities with the authorized gallery read.
// Source and link versions make a later row update refuse a changed image.
// Hidden gallery rows never contribute their settings or identity.
package dtt_1_row_read

import (
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"fmt"
	"github.com/lib/pq"
	"strconv"
)

// AppendReadRowPolicyToWhereClause lets the image-use writer verify the same
// visible gallery fallback as the card reader, on the request transaction.
func AppendReadRowPolicyToWhereClause(q dbutils.Querier, table, role string, userID int, where string, args []interface{}) (string, []interface{}, error) {
	policy, err := getLegacyMustTrueReadPolicy(q, table)
	if err != nil {
		return where, args, err
	}
	where, args = appendReadPolicyToWhereClause(table, role, userID, policy, where, args)
	return where, args, nil
}

func enrichExactCardImageUses(q dbutils.Querier, table string, rows []map[string]interface{}, ids []int64, actor dbutils.RequestActorContext, gallery *cardGalleryRead) error {
	var relationID int64
	var parentUID string
	err := q.QueryRow(`SELECT r.id,p.table_uid::text FROM public.system_foreign_key_relations_1_m r
		JOIN public.system_db_tables p ON p.table_uid=r.target_table_uid
		JOIN public.system_db_tables c ON c.table_uid=r.source_table_uid
		WHERE p.table_name=$1 AND c.table_name=$2 AND r.source_column_name=$3
		AND p.schema_name='public' AND c.schema_name='public' ORDER BY r.id LIMIT 1`, table, gallery.relation.ChildTable, gallery.relation.ForeignKey).Scan(&relationID, &parentUID)
	if err != nil {
		return err
	}
	policy, err := getLegacyMustTrueReadPolicy(q, table)
	if err != nil {
		return err
	}
	query := fmt.Sprintf(`SELECT id,xmin::text FROM %s WHERE id=ANY($1)`, pq.QuoteIdentifier(table))
	condition, args := buildReadRowPolicyCondition(table, actor.UserRole, actor.UserID, policy, 2)
	values := []interface{}{pq.Array(ids)}
	if condition != "" {
		query += " AND (" + condition + ")"
		values = append(values, args...)
	}
	versions, err := q.Query(query, values...)
	if err != nil {
		return err
	}
	parentVersions := map[int64]string{}
	for versions.Next() {
		var id int64
		var version string
		if err := versions.Scan(&id, &version); err != nil {
			versions.Close()
			return err
		}
		parentVersions[id] = version
	}
	err = versions.Err()
	versions.Close()
	if err != nil {
		return err
	}
	fields, err := dtt_card_picture.ReadOwnPictureFields(q, table)
	if err != nil {
		return err
	}
	for _, row := range rows {
		id, ok := coerceCardSupportRowID(row["id"])
		if !ok || parentVersions[id] == "" {
			continue
		}
		images := gallery.images[strconv.FormatInt(id, 10)].uses
		applyExactCardImageUses(row, table, id, parentVersions[id], relationID, parentUID, fields.Columns(), images)
	}
	return nil
}

func applyExactCardImageUses(row map[string]interface{}, table string, id int64, parentVersion string, relationID int64, tableUID string, columns []string, images []canonicalAssetImageValue) {
	for _, column := range columns {
		value := normalizeCardSupportValue(row[column])
		if value == "" {
			continue
		}
		use := dtt_card_picture.CardImageUse{Dataset: table, RowID: id, Column: column, RelationID: relationID,
			Version: dtt_card_picture.CardImageVersion(parentVersion, "", value)}
		var matched *canonicalAssetImageValue
		ambiguous := false
		for index := range images {
			image := &images[index]
			if value != image.filename && !cardImageFilenameMatches(value, image.filename, tableUID, id) {
				continue
			}
			if matched != nil {
				ambiguous = true
				break
			}
			matched = image
		}
		// Two links to the same file do not identify a unique use. Refuse editing
		// rather than silently changing the first link's presentation.
		if ambiguous {
			continue
		}
		if matched != nil {
			use.LinkRowID = matched.linkID
			use.Version = dtt_card_picture.CardImageVersion(parentVersion, matched.linkVersion, value)
			row[column+"_presentation"] = matched.presentation
			row[column+"_focal_x"], row[column+"_focal_y"] = matched.focalX, matched.focalY
			row[column+"_type_id"] = matched.typeID
			row[column+"_metadata_json"] = matched.metadataJSON
			row[column+"_title"], row[column+"_original_name"] = matched.title, matched.originalName
		}
		row[column+"_usage"] = use
	}
}
