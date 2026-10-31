// Isolates optional dimension writes from the surrounding successful upload or attach.
// Only object metadata is merged; callers log a value-free failure if needed.
package media_utils

import (
	"database/sql"
	"fmt"

	"github.com/lib/pq"
)

type ImageSizeQuerier interface {
	Exec(string, ...interface{}) (sql.Result, error)
	QueryRow(string, ...interface{}) *sql.Row
}

// WithImageSizeSavepoint rolls back failed SQL before control returns to the
// writer. This must be called on its current transaction, never on a pool.
func WithImageSizeSavepoint(q ImageSizeQuerier, write func() error) error {
	if _, err := q.Exec("SAVEPOINT displayed_image_size_write"); err != nil {
		return err
	}
	err := write()
	if err != nil {
		if _, rollbackErr := q.Exec("ROLLBACK TO SAVEPOINT displayed_image_size_write"); rollbackErr != nil {
			return rollbackErr
		}
	}
	_, releaseErr := q.Exec("RELEASE SAVEPOINT displayed_image_size_write")
	if err != nil {
		return err
	}
	return releaseErr
}

// MergeUploadedImageSize drops any client-sent size, including for an unmeasurable
// upload. A missing/incompatible column or non-object is left untouched.
func MergeUploadedImageSize(q ImageSizeQuerier, table string, id int64, size *DisplayedImageSize) error {
	return WithImageSizeSavepoint(q, func() error { return MergeImageSize(q, table, id, size, true) })
}

// MergeImageSize runs within the caller's savepoint, preserving all other keys.
func MergeImageSize(q ImageSizeQuerier, table string, id int64, size *DisplayedImageSize, replace bool) error {
	var kind string
	err := q.QueryRow(`SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='metadata_json'`, table).Scan(&kind)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if kind != "jsonb" && kind != "json" {
		return nil
	}
	base := "COALESCE(metadata_json::jsonb, '{}'::jsonb)"
	if replace {
		base = "(" + base + " - 'displayed_image_size')"
	}
	_, err = q.Exec(fmt.Sprintf(`UPDATE public.%s SET metadata_json = (%s || $2::jsonb)::%s
		WHERE id=$1 AND (metadata_json IS NULL OR jsonb_typeof(metadata_json::jsonb)='object')`, pq.QuoteIdentifier(table), base, kind), id, string(ImageSizePatch(size)))
	return err
}
