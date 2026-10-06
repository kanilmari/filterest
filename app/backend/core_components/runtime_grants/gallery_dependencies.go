// gallery_dependencies.go
// Models the card-picture rule's actual writes and narrow supporting reads.
// Reuses the canonical gallery and upload relation metadata on the audit snapshot.
// Keeps direct picture adoption separate from executed gallery settlement.
package runtime_grants

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
)

func loadGalleryRequirements(ctx context.Context, tx *sql.Tx, snapshot *GrantSnapshot, parent, child int64, gallery *dtt_card_picture.PictureRelation) error {
	mutations := Insert | Update | Delete
	reads := []string{gallery.FilenameColumn, gallery.ForeignKey}
	for _, column := range []string{"id", "asset_kind", "created", "is_primary", "sort_order"} {
		if snapshot.Objects[child].hasColumn(column) {
			reads = append(reads, column)
		}
	}
	if gallery.Columns.SortOrder {
		// Only SettleNewGalleryRows/AppendGalleryRows writes ordering, after
		// an actual insert. The choice/adoption rule only reads is_primary.
		snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: child, TargetOID: child, Kind: "gallery", When: Insert, Columns: []string{"sort_order"}, ReadColumns: reads})
	}
	snapshot.Dependencies = append(snapshot.Dependencies,
		Dependency{SourceOID: child, TargetOID: parent, Kind: "gallery", When: mutations, Columns: []string{"cached_image"}, ReadColumns: []string{"id"}},
		Dependency{SourceOID: parent, TargetOID: parent, Kind: "gallery", When: Insert | Update, Columns: []string{"cached_image"}, ReadColumns: []string{"id"}},
		Dependency{SourceOID: child, TargetOID: child, Kind: "gallery_read", When: mutations, Columns: reads},
		Dependency{SourceOID: parent, TargetOID: child, Kind: "gallery_read", When: Insert | Update, Columns: reads})
	if gallery.Shared {
		// card_picture_rule.go:163 can preserve the old picture after choosing a
		// primary, even with only the child's update route (no child add right).
		snapshot.Dependencies = append(snapshot.Dependencies,
			Dependency{SourceOID: parent, TargetOID: child, Kind: "gallery_insert", When: Insert | Update},
			Dependency{SourceOID: child, TargetOID: child, Kind: "gallery_insert", When: mutations})
	}
	statuses, err := dtt_card_picture.ListRelationStatuses(snapshotQueryer{ctx, tx}, snapshot.Objects[parent].Name)
	if err != nil {
		return fmt.Errorf("read gallery picture-reference requirements: %w", err)
	}
	for _, status := range statuses {
		target := oidByName(snapshot, status.ChildTable)
		filename := strings.TrimSpace(status.UploadConfig.FilenameColumn)
		if filename == "" {
			filename = "filename"
		}
		// card_picture_rule.go:303 reads every upload child's filename and FK,
		// including attachment-only siblings with no independent read rights.
		for _, source := range []int64{parent, child} {
			when := mutations
			if source == parent {
				when = Insert | Update
			}
			snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: source, TargetOID: target,
				Kind: "gallery_read", When: when, Columns: []string{filename, status.ForeignKeyColumn}})
		}
	}
	return nil
}
