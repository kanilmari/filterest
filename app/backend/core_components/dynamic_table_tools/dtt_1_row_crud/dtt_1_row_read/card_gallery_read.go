// card_gallery_read.go
// Shares gallery discovery and authorized image results within one response page.
// Optional enrichment and mandatory cache authorization consume the same read result.
// Never shared across requests or streamed packets; failures never trigger an admin content read.
package dtt_1_row_read

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"easelect/backend/core_components/permissions"
)

type cardGalleryRead struct {
	relation       *dtt_card_picture.PictureRelation
	parentTableUID string
	discovered     bool
	discoveryErr   error
	contentRead    bool
	images         map[string]canonicalAssetImageValue
	contentErr     error
}

func (gallery *cardGalleryRead) discover(q dbutils.Querier, parentTable string) error {
	if gallery.discovered {
		return gallery.discoveryErr
	}
	gallery.discovered = true
	relation, err := dtt_card_picture.PictureRelationOf(q, parentTable)
	if (relation == nil || err != nil) && backend.Db != nil && q != backend.Db {
		fallback, fallbackErr := dtt_card_picture.PictureRelationOf(backend.Db, parentTable)
		if fallbackErr == nil && fallback != nil {
			relation, err = fallback, nil
		} else if err == nil {
			err = fallbackErr
		}
	}
	gallery.relation, gallery.discoveryErr = relation, err
	if err != nil || relation == nil {
		return err
	}
	metadata := q
	if backend.Db != nil {
		metadata = backend.Db
	}
	gallery.parentTableUID, gallery.discoveryErr = getTableUID(parentTable, metadata)
	return gallery.discoveryErr
}

func (gallery *cardGalleryRead) visibleImages(q dbutils.Querier, rowIDs []int64, actor dbutils.RequestActorContext) (map[string]canonicalAssetImageValue, error) {
	if gallery.contentRead {
		return gallery.images, gallery.contentErr
	}
	gallery.contentRead = true
	allowed, err := permissions.CheckRouteTablePermission(q, "/api/get-results", actor.UserID,
		permissions.RouteTableScope{TableName: gallery.relation.ChildTable}, permissions.AccessControlRouteTableOptions(false))
	if err == nil && allowed {
		gallery.images, err = fetchCanonicalAssetImageValues(q, *gallery.relation, rowIDs, actor)
	}
	gallery.contentErr = err
	return gallery.images, err
}
