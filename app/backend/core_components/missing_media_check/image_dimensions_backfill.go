// image_dimensions_backfill.go
// Measures headers outside transactions and commits guarded public-gallery updates.
// Connects resolved schema/table identities, stored references and dimension patches.
// Bounds changes per call so repeated calls advance past sized or skipped rows.
package missing_media_check

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"easelect/backend/core_components/media_utils"
	"github.com/lib/pq"
)

const dimensionBatchSize = 100

type dimensionWrite struct {
	target    dimensionGallery
	id        int64
	reference string
	patch     []byte
}

func runImageDimensionsBackfill(ctx context.Context, db *sql.DB, root string, actor dbutils.RequestActorContext, input imageDimensionsRequest) ImageDimensionsCounts {
	counts := ImageDimensionsCounts{}
	if !actor.IsAdmin || db == nil || input.MaxRows < 1 || input.MaxRows > 1000 {
		counts.Failed++
		return counts
	}
	reader := readOnlyQuerier{ctx: ctx, database: db}
	targets, unsupported, err := dimensionGalleries(reader)
	if err != nil {
		if ctx.Err() == nil {
			counts.Failed++
		}
		return counts
	}
	counts.Galleries = len(targets)
	counts.SkippedUnsupportedGallery = unsupported
	var writable []dimensionGallery
	for _, target := range targets {
		ok, err := dimensionGalleryWritable(reader, target)
		if err != nil {
			if ctx.Err() == nil {
				counts.Failed++
			}
		} else if !ok {
			counts.SkippedUnsupportedGallery++
		} else {
			writable = append(writable, target)
		}
	}
	var pending []dimensionWrite
	flush := func() {
		if len(pending) == 0 || input.DryRun || ctx.Err() != nil {
			pending = nil
			return
		}
		written, err := commitDimensionBatch(ctx, db, actor, pending)
		if err != nil && ctx.Err() == nil {
			counts.Failed += len(pending)
		}
		counts.Written += written
		pending = nil
	}
	for _, target := range writable {
		if ctx.Err() != nil || counts.WouldWrite >= input.MaxRows {
			break
		}
		var kind string
		err := reader.QueryRow(`SELECT data_type FROM "information_schema"."columns" WHERE table_schema=$1 AND table_name=$2 AND column_name='metadata_json'`, target.Schema, target.AssetTable).Scan(&kind)
		if err == sql.ErrNoRows {
			counts.SkippedNoMetadataColumn++
			continue
		}
		if err != nil {
			if ctx.Err() == nil {
				counts.Failed++
			}
			continue
		}
		if kind != "jsonb" {
			counts.SkippedNotJSONB++
			continue
		}
		after := int64(math.MinInt64)
		for ctx.Err() == nil && counts.WouldWrite < input.MaxRows {
			page, err := readDimensionPage(reader, target, after)
			if err != nil {
				if ctx.Err() == nil {
					counts.Failed++
				}
				break
			}
			for _, row := range page {
				if ctx.Err() != nil || counts.WouldWrite >= input.MaxRows {
					break
				}
				after = row.id
				counts.RowsSeen++
				write, ok := measureDimensionRow(root, target, row, &counts)
				if !ok {
					continue
				}
				counts.WouldWrite++
				pending = append(pending, write)
				if len(pending) == dimensionBatchSize {
					flush()
				}
			}
			if len(page) < dimensionBatchSize {
				break
			}
		}
	}
	flush()
	return counts
}

type dimensionRow struct {
	id, parentID int64
	reference    string
	metadata     []byte
}

func readDimensionPage(reader readOnlyQuerier, target dimensionGallery, after int64) ([]dimensionRow, error) {
	if !target.resolved || target.Schema != "public" {
		return nil, fmt.Errorf("unsupported dimension gallery")
	}
	query := fmt.Sprintf(`SELECT id, %s, %s::text, metadata_json FROM ONLY %s.%s WHERE id > $1::bigint ORDER BY id LIMIT %d`, pq.QuoteIdentifier(target.ForeignKey), pq.QuoteIdentifier(target.FilenameColumn), pq.QuoteIdentifier(target.Schema), pq.QuoteIdentifier(target.AssetTable), dimensionBatchSize)
	rows, err := reader.Query(query, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var page []dimensionRow
	for rows.Next() {
		var row dimensionRow
		var parent sql.NullInt64
		var reference sql.NullString
		if err := rows.Scan(&row.id, &parent, &reference, &row.metadata); err != nil {
			return nil, err
		}
		row.parentID, row.reference = parent.Int64, reference.String
		page = append(page, row)
	}
	return page, rows.Err()
}

func measureDimensionRow(root string, target dimensionGallery, row dimensionRow, counts *ImageDimensionsCounts) (dimensionWrite, bool) {
	write := dimensionWrite{target: target, id: row.id, reference: row.reference}
	var metadata map[string]json.RawMessage
	if row.metadata != nil && (json.Unmarshal(row.metadata, &metadata) != nil || metadata == nil) {
		counts.SkippedNonObjectMetadata++
		return write, false
	}
	if row.reference == "" {
		counts.SkippedNoFile++
		return write, false
	}
	resolved, ok := resolveDimensionReference(row.reference, target.ParentTableUID, row.parentID)
	if !ok {
		counts.SkippedUnresolvedReference++
		return write, false
	}
	owner := filepath.Join(root, resolved.OwnerFolder)
	if tag := media_utils.JPEGOrientation(filepath.Join(owner, "original", resolved.Filename)); tag >= 2 && tag <= 8 {
		counts.OriginalsRotatedByTag++
	}
	size, _ := media_utils.MeasureDisplayedImageSize(owner, resolved.Filename, resolved.MediaLibrary)
	if size == nil {
		counts.SkippedNoFile++
		return write, false
	}
	write.patch = media_utils.ImageSizePatch(size)
	var patch map[string]json.RawMessage
	_ = json.Unmarshal(write.patch, &patch)
	// jsonb equality ignores object key order, just as the UPDATE predicate does.
	var old, wanted interface{}
	_ = json.Unmarshal(metadata[media_utils.DisplayedImageSizeKey], &old)
	_ = json.Unmarshal(patch[media_utils.DisplayedImageSizeKey], &wanted)
	oldJSON, _ := json.Marshal(old)
	wantedJSON, _ := json.Marshal(wanted)
	if string(oldJSON) == string(wantedJSON) {
		counts.AlreadySized++
		return write, false
	}
	return write, true
}

// ResolveReference supplies placement, but its historical fallback accepts more
// shapes than this writer can prove. Never unpack language maps or URL suffixes.
func resolveDimensionReference(reference, uid string, parentID int64) (ResolvedReference, bool) {
	resolved, ok := ResolveReference(reference, uid, parentID)
	if !ok || json.Valid([]byte(reference)) || strings.ContainsAny(reference, `?#\`) {
		return ResolvedReference{}, false
	}
	if !resolved.MediaLibrary {
		if _, _, _, valid := dtt_card_picture.ResolveStoredPictureLocation(reference, uid, parentID); !valid {
			return ResolvedReference{}, false
		}
	}
	return resolved, true
}

func commitDimensionBatch(ctx context.Context, db *sql.DB, actor dbutils.RequestActorContext, writes []dimensionWrite) (int, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if err := dbutils.ApplyRequestActorToTx(tx, actor); err != nil {
		return 0, err
	}
	written := 0
	for _, write := range writes {
		if !write.target.resolved || write.target.Schema != "public" {
			return 0, fmt.Errorf("unsupported dimension gallery")
		}
		query := fmt.Sprintf(`UPDATE ONLY %s.%s SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $3::jsonb
		WHERE id=$1 AND %s=$2
		AND (metadata_json IS NULL OR jsonb_typeof(metadata_json)='object')
		AND metadata_json -> 'displayed_image_size' IS DISTINCT FROM ($3::jsonb -> 'displayed_image_size')`, pq.QuoteIdentifier(write.target.Schema), pq.QuoteIdentifier(write.target.AssetTable), pq.QuoteIdentifier(write.target.FilenameColumn))
		result, err := tx.ExecContext(ctx, query, write.id, write.reference, string(write.patch))
		if err != nil {
			return 0, err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return 0, err
		}
		written += int(n)
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return written, nil
}
