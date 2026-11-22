// dataset_presentation_picture_reader.go
// Reads the picture settings and default views the side menu needs for every dataset the viewer may open.
// Bridges the media registry and the canonical appearance resolver with the dataset catalogue.
// Exists so the side menu can decide its tab shape before any dataset is opened (owner 2026-11-22).
package system_table_tools

import (
	"database/sql"
	"fmt"
	"log"

	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
	appearance "easelect/frontend/shared/dataset_appearance"

	"github.com/lib/pq"
)

// readPresentationPictures returns the picture settings of the given datasets, which the caller has already
// proved the viewer may open. The media semantics match the get-results reader
// (dtt_1_row_read.fetchDatasetPresentationMedia): a role is set when it has a stored file and hidden when any
// of its rows is hidden. The cover strengths come from the same appearance resolver get-results returns.
// It reads settings only and decides nothing: the browser's side_menu_tab_shape.js owns the rule.
func readPresentationPictures(q dbutils.Querier, uids []int64, development bool) (map[int64]*dtt_models.DatasetPresentationPicture, error) {
	pictures := make(map[int64]*dtt_models.DatasetPresentationPicture, len(uids))
	if len(uids) == 0 {
		return pictures, nil
	}
	for _, uid := range uids {
		pictures[uid] = &dtt_models.DatasetPresentationPicture{}
	}
	rows, err := q.Query(`
		SELECT media.table_uid,
			COALESCE(BOOL_OR(media.media_role = 'cover' AND media.storage_key IS NOT NULL), FALSE)
				AND NOT COALESCE(BOOL_OR(media.hidden) FILTER (WHERE media.media_role = 'cover'), FALSE),
			COALESCE(BOOL_OR(media.media_role = 'background' AND media.storage_key IS NOT NULL), FALSE)
				AND NOT COALESCE(BOOL_OR(media.hidden) FILTER (WHERE media.media_role = 'background'), FALSE)
		FROM public.system_dataset_media AS media
		WHERE media.table_uid = ANY($1)
		  AND media.media_role IN ('cover', 'background')
		GROUP BY media.table_uid`, pq.Array(uids))
	if err != nil {
		return nil, fmt.Errorf("read dataset presentation pictures: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var uid int64
		var cover, background bool
		if err := rows.Scan(&uid, &cover, &background); err != nil {
			return nil, fmt.Errorf("scan dataset presentation pictures: %w", err)
		}
		if picture := pictures[uid]; picture != nil {
			picture.Cover, picture.Background = cover, background
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read dataset presentation pictures: %w", err)
	}
	rows.Close()
	for _, uid := range uids {
		picture := pictures[uid]
		if !picture.Cover {
			continue
		}
		snapshot, err := store.ReadAppearance(q, int(uid), development)
		if err != nil {
			// Without its strengths the browser counts the cover as shown: box-like tabs are the safe shape.
			log.Printf("[readPresentationPictures] appearance of dataset %d: %v", uid, err)
			continue
		}
		picture.CoverThemes = &dtt_models.DatasetCoverPictureThemes{
			Light: coverPictureStrength(snapshot.Effective.Light),
			Dark:  coverPictureStrength(snapshot.Effective.Dark),
		}
	}
	return pictures, nil
}

// readDefaultViews returns the own default view of the given datasets, which the caller has already proved the
// viewer may open, as get-results reports it (system_db_tables.default_view_id → system_table_views.name); a null
// name inherits the site's default. The browser resolves and decides (side_menu_tab_shape.js).
func readDefaultViews(q dbutils.Querier, uids []int64) (map[int64]*dtt_models.DatasetDefaultView, error) {
	views := make(map[int64]*dtt_models.DatasetDefaultView, len(uids))
	if len(uids) == 0 {
		return views, nil
	}
	rows, err := q.Query(`
		SELECT tables.table_uid, views.name
		FROM public.system_db_tables AS tables
		LEFT JOIN public.system_table_views AS views ON views.id = tables.default_view_id
		WHERE tables.table_uid = ANY($1)`, pq.Array(uids))
	if err != nil {
		return nil, fmt.Errorf("read dataset default views: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var uid int64
		var name sql.NullString
		if err := rows.Scan(&uid, &name); err != nil {
			return nil, fmt.Errorf("scan dataset default views: %w", err)
		}
		view := &dtt_models.DatasetDefaultView{}
		if name.Valid {
			view.Name = &name.String
		}
		views[uid] = view
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read dataset default views: %w", err)
	}
	return views, nil
}

func coverPictureStrength(values appearance.DatasetCoverThemeValues) dtt_models.DatasetCoverPictureStrength {
	return dtt_models.DatasetCoverPictureStrength{
		ImageOpacity:   values.ImageOpacity,
		OverlayOpacity: values.OverlayOpacity,
		OvalEnabled:    values.OvalEnabled,
		CenterOpacity:  values.CenterOpacity,
		MidOpacity:     values.MidOpacity,
		EdgeOpacity:    values.EdgeOpacity,
	}
}
