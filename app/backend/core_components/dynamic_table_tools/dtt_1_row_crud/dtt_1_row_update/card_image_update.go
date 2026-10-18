// card_image_update.go
// Extends the existing row-update request with one atomic image-use operation.
// Reuses its request transaction, parent lock, mutation policy and actor marks.
// Explicit adoption and optimistic versions prevent changing another image use.
package dtt_1_row_update

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	links "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	pictures "easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"easelect/backend/core_components/event_bus"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/permissions"
	"github.com/lib/pq"
)

type cardImageUpdate struct {
	Use   pictures.CardImageUse `json:"use"`
	Adopt bool                  `json:"adopt"`
	pictures.CardImageSettings
}

func (update *cardImageUpdate) UnmarshalJSON(data []byte) error {
	type plain cardImageUpdate
	var decoded plain
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for _, key := range []string{"use", "presentation", "focal"} {
		if _, ok := fields[key]; !ok {
			return fmt.Errorf("%s is required; use explicit null to inherit or center", key)
		}
	}
	if decoded.Focal != nil {
		var point map[string]*float64
		if err := json.Unmarshal(fields["focal"], &point); err != nil {
			return err
		}
		if len(point) != 2 || point["x"] == nil || point["y"] == nil {
			return errors.New("both focal coordinates are required")
		}
	}
	if err := decoded.CardImageSettings.Validate(); err != nil {
		return err
	}
	if decoded.Use.Dataset == "" || decoded.Use.RowID <= 0 || decoded.Use.Column == "" || decoded.Use.RelationID <= 0 || decoded.Use.LinkRowID < 0 || len(decoded.Use.Version) != 64 {
		return errors.New("an exact image use and source version are required")
	}
	if decoded.Adopt != (decoded.Use.LinkRowID == 0) {
		return errors.New("adoption must be explicit for an unlinked image")
	}
	*update = cardImageUpdate(decoded)
	return nil
}

func cardImageRefusal(status int, message string) error {
	return &httpresponse.Refusal{Status: status, Message: message}
}

func requireCardImageRoute(q dbutils.Querier, table, route string, userID int) error {
	uid, err := getTableUID(table, q)
	if err != nil {
		return err
	}
	allowed, err := permissions.CheckRouteTablePermission(q, route, userID, permissions.RouteTableScope{TableName: table, TableUID: strconv.Itoa(uid)}, permissions.AccessControlRouteTableOptions(false))
	if err != nil {
		return err
	}
	if !allowed {
		return cardImageRefusal(403, "row update permission required")
	}
	return nil
}

func requireCardImageColumns(q dbutils.Querier, table string, id int64, columns []string) error {
	uid, err := getTableUID(table, q)
	if err != nil {
		return err
	}
	updates := make([]updateRowFieldUpdate, 0, len(columns))
	for _, column := range columns {
		editable, err := isColumnEditable(uid, column, q)
		if err != nil {
			return err
		}
		if !editable {
			return cardImageRefusal(403, "column is not editable")
		}
		updates = append(updates, updateRowFieldUpdate{Column: column})
	}
	return validateRowActorUpdates(q, table, id, updates)
}

// saveCardImageUpdate is called only after UpdateRowHandler's parent mutation
// lock. Parent and child route rights are independent; runtime grants already
// provision the child's update and insert only when those routes are granted.
func saveCardImageUpdate(tx *sql.Tx, request *http.Request, table string, id int64, update *cardImageUpdate, userID int, role string) (pictures.CardImageUse, error) {
	use := update.Use
	if userID <= 1 {
		return use, cardImageRefusal(403, "signed-in row editor required")
	}
	if use.Dataset != table || use.RowID != id {
		return use, cardImageRefusal(400, "image use conflicts with the authorized dataset or row")
	}
	if err := requireCardImageRoute(tx, table, "/api/update-row", userID); err != nil {
		return use, err
	}
	if err := requireCardImageRoute(tx, table, "/api/get-results", userID); err != nil {
		return use, err
	}
	gallery, err := pictures.PictureRelationOf(tx, table)
	if err != nil {
		return use, err
	}
	if gallery == nil || !gallery.HasCardImageSettings {
		return use, cardImageRefusal(409, "card_image_not_linkable")
	}
	var relationID int64
	err = tx.QueryRow(`SELECT r.id FROM public.system_foreign_key_relations_1_m r
		JOIN public.system_db_tables p ON p.table_uid=r.target_table_uid
		JOIN public.system_db_tables c ON c.table_uid=r.source_table_uid
		WHERE p.table_name=$1 AND c.table_name=$2 AND r.source_column_name=$3
		AND p.schema_name='public' AND c.schema_name='public' ORDER BY r.id LIMIT 1`, table, gallery.ChildTable, gallery.ForeignKey).Scan(&relationID)
	if err != nil {
		return use, err
	}
	if relationID != use.RelationID {
		return use, cardImageRefusal(400, "image relation conflicts with the authorized dataset")
	}
	for _, route := range []string{"/api/get-results", "/api/update-row"} {
		if err := requireCardImageRoute(tx, gallery.ChildTable, route, userID); err != nil {
			return use, err
		}
	}
	fields, err := pictures.ReadOwnPictureFields(tx, table)
	if err != nil {
		return use, err
	}
	known := false
	for _, field := range fields.Columns() {
		known = known || field == use.Column
	}
	if !known {
		return use, cardImageRefusal(400, "source is not a delivered card image field")
	}
	if err := requireCardImageColumns(tx, table, id, []string{use.Column}); err != nil {
		return use, err
	}
	var current sql.NullString
	var parentVersion string
	err = tx.QueryRow(fmt.Sprintf(`SELECT %s::text,xmin::text FROM %s WHERE id=$1`, pq.QuoteIdentifier(use.Column), pq.QuoteIdentifier(table)), id).Scan(&current, &parentVersion)
	if err != nil {
		return use, err
	}
	childID := use.LinkRowID
	sourceValue := strings.TrimSpace(current.String)
	linkVersion := ""
	if childID != 0 {
		readable, err := read.RowsVisibleForRead(tx, gallery.ChildTable, role, userID, []int64{childID})
		if err != nil {
			return use, err
		}
		if !readable {
			return use, cardImageRefusal(403, "gallery row is not readable")
		}
		visible, err := read.LockRowsVisibleForMutation(tx, gallery.ChildTable, role, userID, []int64{childID})
		if err != nil {
			return use, err
		}
		if !visible {
			return use, cardImageRefusal(403, "gallery row is not editable")
		}
		var parentID int64
		var filename string
		err = tx.QueryRow(fmt.Sprintf(`SELECT %s,%s,xmin::text FROM %s WHERE id=$1 AND %s`, pq.QuoteIdentifier(gallery.ForeignKey), pq.QuoteIdentifier(gallery.FilenameColumn), pq.QuoteIdentifier(gallery.ChildTable), gallery.PictureCondition("")), childID).Scan(&parentID, &filename, &linkVersion)
		if err == sql.ErrNoRows {
			return use, cardImageRefusal(409, "image use changed")
		}
		if err != nil {
			return use, err
		}
		if parentID != id {
			return use, cardImageRefusal(400, "image use belongs to another row")
		}
		filename = strings.TrimSpace(filename)
		// An empty cached field is the read-time gallery fallback. Prove that
		// this link is still the first visible image instead of trusting its URL.
		if strings.TrimSpace(current.String) == "" && use.Column == "cached_image" {
			var first int64
			where, args, err := read.AppendReadRowPolicyToWhereClause(tx, gallery.ChildTable, role, userID, fmt.Sprintf(` WHERE %s=$1 AND %s`, pq.QuoteIdentifier(gallery.ForeignKey), gallery.PictureCondition("")), []interface{}{id})
			if err != nil {
				return use, err
			}
			err = tx.QueryRow(fmt.Sprintf(`SELECT id FROM %s%s ORDER BY %s LIMIT 1`, pq.QuoteIdentifier(gallery.ChildTable), where, pictures.GalleryOrderClause(gallery.Columns, "")), args...).Scan(&first)
			if err != nil {
				return use, err
			}
			if first != childID {
				return use, cardImageRefusal(409, "displayed image changed")
			}
			sourceValue = filename
		} else if !sameCardImageReference(current.String, filename, table, id, tx) {
			return use, cardImageRefusal(409, "displayed image changed")
		}
	}
	if pictures.CardImageVersion(parentVersion, linkVersion, sourceValue) != use.Version {
		return use, cardImageRefusal(409, "image source version changed")
	}
	columns := []string{"card_image_presentation", "card_image_focal_x", "card_image_focal_y"}
	if err := requireCardImageColumns(tx, gallery.ChildTable, childID, columns); err != nil {
		return use, err
	}
	if update.Adopt {
		if !gallery.Shared {
			return use, cardImageRefusal(409, "card_image_not_linkable")
		}
		if err := requireCardImageRoute(tx, gallery.ChildTable, "/api/add-row-multipart", userID); err != nil {
			return use, err
		}
		references, _, err := links.ReadParentPictureReferences(tx, table, id)
		if err != nil {
			return use, err
		}
		parentUID, err := getTableUID(table, tx)
		if err != nil {
			return use, err
		}
		uid := strconv.Itoa(parentUID)
		class, _ := links.ClassifyCardPicture(current.String, references, uid, id, true, links.CardImageStoredFileState)
		if class != pictures.CurrentAdoptable {
			return use, cardImageRefusal(409, "card_image_not_linkable")
		}
		childID, err = links.InsertAdoptedCardImage(tx, gallery, id, current.String, use.Column)
		if err != nil {
			return use, err
		}
		// Adoption does not rewrite a different image field into cached_image.
	}
	var x, y interface{}
	if update.Focal != nil {
		x, y = update.Focal.X, update.Focal.Y
	}
	editable, err := read.LockRowsVisibleForMutation(tx, table, role, userID, []int64{id})
	if err != nil {
		return use, err
	}
	if !editable {
		return use, cardImageRefusal(403, "parent row is not editable")
	}
	where, args, err := read.AppendUpdateRowPolicyToWhereClause(tx, gallery.ChildTable, role, userID, ` WHERE id=$4`, []interface{}{update.Presentation, x, y, childID})
	if err != nil {
		return use, err
	}
	result, err := tx.Exec(fmt.Sprintf(`UPDATE %s SET card_image_presentation=$1,card_image_focal_x=$2,card_image_focal_y=$3%s`, pq.QuoteIdentifier(gallery.ChildTable), where), args...)
	if err != nil {
		return use, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return use, err
	}
	if count != 1 {
		return use, cardImageRefusal(403, "gallery row is not editable")
	}
	if err := tx.QueryRow(fmt.Sprintf(`SELECT xmin::text FROM %s WHERE id=$1`, pq.QuoteIdentifier(gallery.ChildTable)), childID).Scan(&linkVersion); err != nil {
		return use, err
	}
	use.LinkRowID, use.Version = childID, pictures.CardImageVersion(parentVersion, linkVersion, sourceValue)
	dbutils.RegisterAfterCommitHook(request.Context(), func() {
		action := "update"
		if update.Adopt {
			action = "insert"
		}
		event_bus.Bus.Publish(gallery.ChildTable, event_bus.Event{Table: gallery.ChildTable, RowID: childID, Action: action, ChangedFields: columns})
		event_bus.Bus.Publish(table, event_bus.Event{Table: table, RowID: id, Action: "update", ChangedFields: []string{use.Column}})
	})
	return use, nil
}

func sameCardImageReference(source, filename, table string, id int64, q dbutils.Querier) bool {
	if strings.TrimSpace(source) == strings.TrimSpace(filename) {
		return true
	}
	uid, err := getTableUID(table, q)
	if err != nil {
		return false
	}
	st, sr, sf, ok := pictures.ResolveStoredPictureLocation(source, strconv.Itoa(uid), id)
	ft, fr, ff, valid := pictures.ResolveStoredPictureLocation(filename, strconv.Itoa(uid), id)
	return ok && valid && st == ft && sr == fr && sf == ff
}
