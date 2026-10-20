// article_after_reader.go
// Exports materialized article bundles using the same settings evidence as BEFORE.
// Connects the offline tooling to one enforced read-only PostgreSQL snapshot.
// Phase guards prevent a legacy resolver or incomplete upgrade from posing as AFTER.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"errors"
)

var ErrArticleBaselineUpgraded = errors.New("BEFORE requires a pre-upgrade copy without article bundle schema; use article_presentation_after for upgraded databases")
var ErrArticleAfterIncomplete = errors.New("AFTER requires completed article bundle materialization with valid bundles")

// ReadArticlePresentationAfter reads saved effective projections, not rendered rows.
// It never starts the application or runs a migration, and always rolls back.
func ReadArticlePresentationAfter(ctx context.Context, db *sql.DB) (ArticleBaselineReport, error) {
	return readArticlePresentationSnapshot(ctx, db, true)
}

func articlePresentationPhase(tx *sql.Tx, after bool) error {
	var upgraded bool
	if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
 WHERE table_schema='public' AND table_name='system_column_field_sets' AND column_name='article_family')`).Scan(&upgraded); err != nil {
		return err
	}
	if !after {
		if upgraded {
			return ErrArticleBaselineUpgraded
		}
		return nil
	}
	if !upgraded {
		return ErrArticleAfterIncomplete
	}
	var completed bool
	if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM public.system_data_repair_records
 WHERE migration='article_bundle_materialization' AND action='completed')`).Scan(&completed); err != nil {
		return err
	}
	if !completed {
		return ErrArticleAfterIncomplete
	}
	var findings int
	if err := tx.QueryRow(`SELECT count(*) FROM public.app_check_article_bundles()`).Scan(&findings); err != nil {
		return err
	}
	if findings != 0 {
		return ErrArticleAfterIncomplete
	}
	return nil
}
