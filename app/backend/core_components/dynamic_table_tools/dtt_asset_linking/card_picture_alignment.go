// card_picture_alignment.go
// Brings card pictures stored under the old "newest upload wins" behaviour to the one rule, once per start.
// Between startup maintenance and every parent table that has a gallery and a cached_image column.
// Exists because read time keeps a stored card picture as it is, so a choice the old upload rule
// made would otherwise stay until the row's gallery changed next and then switch by itself —
// the very behaviour the owner's decision K120 (30.9.2026) removes.
package dtt_asset_linking

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"time"

	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"

	"github.com/lib/pq"
)

const (
	cardPictureAlignmentPage        = 500
	cardPictureAlignmentLockTimeout = "2s"
)

// CardPictureAlignment counts what one alignment did.
type CardPictureAlignment struct {
	Changed int
	// Skipped rows could not be locked in time; they stay candidates for the next start.
	Skipped int
	Failed  int
	// Complete is false when the time limit stopped the alignment.
	Complete bool
}

// alignmentTable is one parent table the alignment visits, with its gallery.
type alignmentTable struct {
	Parent  string
	Gallery *dtt_card_picture.PictureRelation
}

// AlignCardPictures applies the card picture rule to every row whose stored card picture
// a gallery row carries but which differs from the gallery's choice, and to every row
// whose card picture is empty although its gallery has pictures. It never handles a
// card-only picture (kept, adoptable or broken): those follow the rule on the row's next
// gallery change, so the alignment needs no look at storage and a disk that cannot be
// read never turns a picture into a missing one. Rows that already follow the rule are
// not selected, so once a run has completed, later starts find nothing to write. Each row
// is handled in its own transaction, waits for its lock at most briefly and is checked
// again under the lock. The time limit bounds every statement, the lookups included.
func AlignCardPictures(ctx context.Context, db *sql.DB, timeLimit time.Duration) (CardPictureAlignment, error) {
	result := CardPictureAlignment{}
	if db == nil {
		return result, nil
	}
	ctx, cancel := context.WithTimeout(ctx, timeLimit)
	defer cancel()

	tables, err := listAlignmentTables(ctx, db)
	if err != nil {
		if alignmentTimeUp(ctx, err) {
			return result, nil
		}
		return result, err
	}
	for _, table := range tables {
		if err := alignParentTable(ctx, db, table, &result); err != nil {
			if alignmentTimeUp(ctx, err) {
				return result, nil
			}
			return result, err
		}
	}
	result.Complete = ctx.Err() == nil
	return result, nil
}

// alignmentTimeUp tells the time limit running out, which leaves the alignment incomplete,
// from a real failure: the context's end, or a statement time limit (SQLSTATE 57014) set
// from it that fired a moment earlier.
func alignmentTimeUp(ctx context.Context, err error) bool {
	var pqErr *pq.Error
	return ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &pqErr) && pqErr.Code == "57014")
}

// listAlignmentTables finds, in one read-only transaction bounded by the time limit, the
// parent tables that have a gallery and a cached_image column.
func listAlignmentTables(ctx context.Context, db *sql.DB) ([]alignmentTable, error) {
	tables := make([]alignmentTable, 0)
	err := inBoundedTransaction(ctx, db, true, func(tx *sql.Tx) error {
		statuses, err := dtt_card_picture.ListRelationStatuses(tx, "")
		if err != nil {
			return err
		}
		seen := make(map[string]bool, len(statuses))
		for _, status := range statuses {
			if seen[status.ParentTable] {
				continue
			}
			seen[status.ParentTable] = true
			gallery, err := dtt_card_picture.PictureRelationOf(tx, status.ParentTable)
			if err != nil {
				return fmt.Errorf("find the gallery of %s: %w", status.ParentTable, err)
			}
			if gallery == nil {
				continue
			}
			hasCachedImage, err := parentTableHasCachedImageColumn(tx, status.ParentTable)
			if err != nil {
				return err
			}
			if hasCachedImage {
				tables = append(tables, alignmentTable{Parent: status.ParentTable, Gallery: gallery})
			}
		}
		return nil
	})
	return tables, err
}

func alignParentTable(ctx context.Context, db *sql.DB, table alignmentTable, result *CardPictureAlignment) error {
	query := cardPictureCandidateQuery(table, `p.id > $1`, fmt.Sprintf(`ORDER BY p.id LIMIT %d`, cardPictureAlignmentPage))
	lastID := int64(0)
	for {
		ids, err := selectCardPictureCandidates(ctx, db, query, lastID)
		if err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		for _, id := range ids {
			lastID = id
			switch alignOneRow(ctx, db, table, id) {
			case alignChanged:
				result.Changed++
			case alignSkipped:
				result.Skipped++
			case alignFailed:
				result.Failed++
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
		}
	}
}

// cardPictureCandidateQuery selects the rows whose stored card picture differs from the
// gallery's choice while a gallery row carries it, or is empty while the gallery has
// pictures. Only an exact stored value counts as carried here; another spelling of the
// same file is left for the rule on the row's next change. rowFilter picks the rows
// ($1 is an id) and tail orders and limits them.
func cardPictureCandidateQuery(table alignmentTable, rowFilter string, tail string) string {
	gallery := table.Gallery
	child := pq.QuoteIdentifier(gallery.ChildTable)
	foreignKey := pq.QuoteIdentifier(gallery.ForeignKey)
	filename := pq.QuoteIdentifier(gallery.FilenameColumn)
	pictures := gallery.PictureCondition("g")
	order := dtt_card_picture.GalleryOrderClause(gallery.Columns, "g")
	if order != "" {
		order = "ORDER BY " + order
	}
	return fmt.Sprintf(`
		SELECT p.id
		  FROM %[1]s AS p
		  JOIN LATERAL (
		        SELECT g.%[4]s::text AS first_value
		          FROM %[2]s AS g
		         WHERE g.%[3]s = p.id AND %[5]s
		         %[6]s
		         LIMIT 1
		       ) AS best ON true
		 WHERE %[7]s
		   AND (NULLIF(TRIM(p.cached_image::text), '') IS NULL
		        OR (p.cached_image::text <> best.first_value
		            AND EXISTS (SELECT 1 FROM %[2]s AS c WHERE c.%[3]s = p.id AND c.%[4]s::text = p.cached_image::text)))
		 %[8]s`,
		pq.QuoteIdentifier(table.Parent), child, foreignKey, filename, pictures, order, rowFilter, tail)
}

func selectCardPictureCandidates(ctx context.Context, db *sql.DB, query string, afterID int64) ([]int64, error) {
	ids := make([]int64, 0, cardPictureAlignmentPage)
	err := inBoundedTransaction(ctx, db, true, func(tx *sql.Tx) error {
		rows, err := tx.Query(query, afterID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	})
	return ids, err
}

type alignOutcome int

const (
	alignChanged alignOutcome = iota + 1
	alignSkipped
	alignFailed
	// alignNotNeeded: under the lock the row was no candidate any more; someone changed
	// it after the selection, and the change decides.
	alignNotNeeded
)

// alignOneRow applies the rule to one row in its own transaction. The row is locked first
// and its candidacy checked again under the lock: the alignment must never hand the rule a
// card-only picture that was written after the selection.
func alignOneRow(ctx context.Context, db *sql.DB, table alignmentTable, id int64) alignOutcome {
	outcome := alignFailed
	err := inBoundedTransaction(ctx, db, false, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`SET LOCAL lock_timeout = '` + cardPictureAlignmentLockTimeout + `'`); err != nil {
			return err
		}
		var before sql.NullString
		lockQuery := fmt.Sprintf(`SELECT cached_image::text FROM %s WHERE id = $1 FOR NO KEY UPDATE`, pq.QuoteIdentifier(table.Parent))
		if err := tx.QueryRow(lockQuery, id).Scan(&before); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				outcome = alignNotNeeded
				return nil
			}
			if isLockNotAvailable(err) {
				outcome = alignSkipped
			}
			return err
		}
		var stillCandidate int64
		if err := tx.QueryRow(cardPictureCandidateQuery(table, `p.id = $1`, ""), id).Scan(&stillCandidate); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				outcome = alignNotNeeded
				return nil
			}
			return err
		}
		if err := ApplyCardPictureRule(tx, table.Parent, table.Gallery, []int64{id}, nil); err != nil {
			return err
		}
		var after sql.NullString
		if err := tx.QueryRow(fmt.Sprintf(`SELECT cached_image::text FROM %s WHERE id = $1`, pq.QuoteIdentifier(table.Parent)), id).Scan(&after); err != nil {
			return err
		}
		outcome = alignChanged
		if sameSharedAssetPreviewValue(before.String, after.String) {
			// The rule left the row as it was; it stays a candidate for the next start.
			outcome = alignSkipped
		}
		return nil
	})
	if err != nil && outcome != alignSkipped {
		return alignFailed
	}
	return outcome
}

// isLockNotAvailable reports PostgreSQL's lock timeout (SQLSTATE 55P03).
func isLockNotAvailable(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == "55P03"
}

// inBoundedTransaction runs work in a transaction tied to ctx whose statements may each
// run at most the time ctx has left (statement_timeout), so no statement outlives the
// alignment's limit even when a cancellation does not get through. The transaction
// commits only when work succeeds.
func inBoundedTransaction(ctx context.Context, db *sql.DB, readOnly bool, work func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: readOnly})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if deadline, ok := ctx.Deadline(); ok {
		left := time.Until(deadline).Milliseconds()
		if left < 1 {
			return context.DeadlineExceeded
		}
		if _, err := tx.Exec(`SELECT set_config('statement_timeout', $1, true)`, strconv.FormatInt(left, 10)); err != nil {
			return err
		}
	}
	if err := work(tx); err != nil {
		return err
	}
	return tx.Commit()
}
