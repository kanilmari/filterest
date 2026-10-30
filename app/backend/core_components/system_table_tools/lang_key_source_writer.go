// lang_key_source_writer.go
// Buffers only changed or day-old source evidence in bounded, deduplicated chunks.
// Connects every population stage to current database dates and short writes.
// Keeps scan counts, last-write wins and empty-only explanations without row churn.
package system_table_tools

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"github.com/lib/pq"
)

const (
	langKeySourceChunkRows       = 5_000
	langKeySourceDeadlockRetries = 3
	langKeySourceRetryBackoff    = 10 * time.Millisecond
)

type langKeySourceIdentity struct {
	id               int64
	sourceType, high string
}

// Dates are calendar dates supplied by PostgreSQL, encoded as YYYYMMDD. No Go
// clock or timezone conversion participates in deciding whether a row is old.
type langKeySourceState struct {
	low              string
	lastSeen         int32
	lowNull          bool
	explanationEmpty bool
}

type langKeySourceWriteStats struct {
	seen, inserted, updated, explanations, chunks int64
	deadlockRetries                               int64
}

type langKeySourceWriter struct {
	db           *sql.DB
	today        int32
	chunkRows    int
	index        map[langKeySourceIdentity]langKeySourceState
	pending      map[langKeySourceIdentity]string
	explanations map[langKeySourceIdentity]string
	stats        langKeySourceWriteStats
	err          error // A failed writer cannot later report a successful flush.
}

func sourceCalendarDate(date time.Time) int32 {
	year, month, day := date.Date()
	return int32(year*10000 + int(month)*100 + day)
}

// Read once after the scan lock, closing the reader before any save. The LEFT
// JOIN also supplies CURRENT_DATE when the source table is empty. NULL legacy
// identities cannot conflict with a scanner identity and remain untouched.
func newLangKeySourceWriter(chunkRows int) (*langKeySourceWriter, error) {
	if chunkRows < 1 || chunkRows > langKeySourceChunkRows {
		return nil, fmt.Errorf("invalid source chunk size: %d", chunkRows)
	}
	w := &langKeySourceWriter{
		db: backend.Db, chunkRows: chunkRows,
		index:        make(map[langKeySourceIdentity]langKeySourceState),
		pending:      make(map[langKeySourceIdentity]string),
		explanations: make(map[langKeySourceIdentity]string),
	}
	err := readSourceRows(`SELECT CURRENT_DATE, s.lang_key_id, s.source_type, s.source_high,
        s.source_low, s.last_seen, (s.usage_explanation IS NULL OR s.usage_explanation='')
        FROM (SELECT 1) calendar LEFT JOIN system_lang_key_sources s ON true`, func(rows *sql.Rows) error {
		var today time.Time
		var id sql.NullInt64
		var sourceType, high, low sql.NullString
		var lastSeen sql.NullTime
		var empty bool
		if err := rows.Scan(&today, &id, &sourceType, &high, &low, &lastSeen, &empty); err != nil {
			return err
		}
		w.today = sourceCalendarDate(today)
		if !id.Valid || !sourceType.Valid || !high.Valid {
			return nil
		}
		state := langKeySourceState{low: low.String, lowNull: !low.Valid, explanationEmpty: empty}
		if lastSeen.Valid {
			state.lastSeen = sourceCalendarDate(lastSeen.Time)
		}
		w.index[langKeySourceIdentity{id.Int64, sourceType.String, high.String}] = state
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("read source index: %w", err)
	}
	if w.today == 0 {
		return nil, fmt.Errorf("source index has no database date")
	}
	return w, nil
}

func (w *langKeySourceWriter) upsertSource(id int64, sourceType, high, low string) error {
	if w.err != nil {
		return w.err
	}
	if id == 0 {
		return fmt.Errorf("source has no language-key identity")
	}
	w.stats.seen++
	key := langKeySourceIdentity{id, sourceType, high}
	state, exists := w.index[key]
	if exists && !state.lowNull && state.low == low && state.lastSeen >= w.today {
		return nil
	}
	if !exists {
		state.explanationEmpty = true
	}
	state.low, state.lowNull, state.lastSeen = low, false, w.today
	w.index[key] = state
	// Replace the pending value, even when it returns to the original value.
	// PostgreSQL must never receive the same conflict identity twice in a chunk.
	w.pending[key] = low
	if len(w.pending) >= w.chunkRows {
		return w.flush()
	}
	return nil
}

func (w *langKeySourceWriter) updateSourceUsageExplanationIfEmpty(id int64, sourceType, high, explanation string) error {
	if w.err != nil {
		return w.err
	}
	if id == 0 || strings.TrimSpace(explanation) == "" {
		return nil
	}
	key := langKeySourceIdentity{id, sourceType, high}
	state, exists := w.index[key]
	if !exists || !state.explanationEmpty {
		return nil
	}
	// The first nonblank offer wins within a chunk, just as sequential updates
	// did. The SQL repeats the empty-only guard for concurrent authored changes.
	state.explanationEmpty = false
	w.index[key] = state
	w.explanations[key] = explanation
	if len(w.explanations) >= w.chunkRows {
		return w.flush()
	}
	return nil
}

func (w *langKeySourceWriter) saveExplainedSource(id int64, sourceType, high, low, explanation string) error {
	if err := w.upsertSource(id, sourceType, high, low); err != nil {
		return err
	}
	return w.updateSourceUsageExplanationIfEmpty(id, sourceType, high, explanation)
}

// Each statement autocommits a bounded chunk, releasing its locks immediately.
// Other source writers keep their existing conflict behavior: queued evidence
// may replace their source_low, while skipped evidence leaves it alone. The next
// scan reloads their committed state and converges. Authored explanations survive.
func (w *langKeySourceWriter) flush() error {
	if w.err != nil {
		return w.err
	}
	var today time.Time
	if err := w.db.QueryRow("SELECT CURRENT_DATE").Scan(&today); err != nil {
		w.err = fmt.Errorf("read source flush date: %w", err)
		return w.err
	}
	w.today = sourceCalendarDate(today)
	// Skips between midnight and this refresh can lag one day within the seven-day cleanup margin.
	if len(w.pending) > 0 {
		ids, types, highs, lows := sourceChunkArrays(w.pending)
		var inserted, updated int64
		w.err = w.retryChunk(func() error {
			return w.db.QueryRow(`WITH saved AS (
            INSERT INTO system_lang_key_sources
                (lang_key_id, source_type, source_high, source_low, last_seen)
            SELECT id, source_type, high, low, CURRENT_DATE
            FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[]) AS src(id, source_type, high, low)
            WHERE true
            ORDER BY id, source_type COLLATE "C", high COLLATE "C"
            ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
            SET source_low=EXCLUDED.source_low, last_seen=CURRENT_DATE
            RETURNING (xmax=0) AS inserted)
            SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted) FROM saved`,
				pq.Array(ids), pq.Array(types), pq.Array(highs), pq.Array(lows)).Scan(&inserted, &updated)
		})
		if w.err != nil {
			w.err = fmt.Errorf("save source chunk: %w", w.err)
			return w.err
		}
		w.stats.inserted += inserted
		w.stats.updated += updated
		w.stats.chunks++
		for key := range w.pending {
			state := w.index[key]
			state.lastSeen = w.today
			w.index[key] = state
		}
		clear(w.pending)
	}
	// Source rows must exist before the explanation statement uses them.
	if len(w.explanations) > 0 {
		ids, types, highs, explanations := sourceChunkArrays(w.explanations)
		var affected int64
		err := w.retryChunk(func() error {
			// UPDATE FROM may reorder its input: acquire row locks explicitly in
			// the same identity order as source upserts before changing explanations.
			result, err := w.db.Exec(`WITH locked AS MATERIALIZED (
                SELECT s.id, src.explanation FROM system_lang_key_sources s
                JOIN unnest($1::bigint[], $2::text[], $3::text[], $4::text[]) AS src(id, source_type, high, explanation)
                ON s.lang_key_id=src.id AND s.source_type=src.source_type AND s.source_high=src.high
                WHERE s.usage_explanation IS NULL OR s.usage_explanation=''
                ORDER BY s.lang_key_id, s.source_type COLLATE "C", s.source_high COLLATE "C"
                FOR UPDATE OF s)
                UPDATE system_lang_key_sources AS s SET usage_explanation=locked.explanation
                FROM locked WHERE s.id=locked.id
                AND (s.usage_explanation IS NULL OR s.usage_explanation='')`,
				pq.Array(ids), pq.Array(types), pq.Array(highs), pq.Array(explanations))
			if err != nil {
				return err
			}
			affected, err = result.RowsAffected()
			return err
		})
		if err != nil {
			w.err = fmt.Errorf("explain source chunk: %w", err)
			return w.err
		}
		w.stats.explanations += affected
		w.stats.chunks++
		clear(w.explanations)
	}
	return nil
}

// PostgreSQL deadlocks roll back the entire autocommitted statement. Other
// failures stay failures, including result errors after a possible commit.
func (w *langKeySourceWriter) retryChunk(write func() error) error {
	for retries := 0; ; retries++ {
		err := write()
		var pgErr *pq.Error
		if !errors.As(err, &pgErr) || pgErr.Code != "40P01" || retries >= langKeySourceDeadlockRetries {
			return err
		}
		w.stats.deadlockRetries++
		time.Sleep(time.Duration(retries+1) * langKeySourceRetryBackoff)
	}
}

func (w *langKeySourceWriter) finishStage(stage string) error {
	if err := w.flush(); err != nil {
		return &sourceSubScanError{stage, err}
	}
	return nil
}

func sourceChunkArrays(chunk map[langKeySourceIdentity]string) ([]int64, []string, []string, []string) {
	ids := make([]int64, 0, len(chunk))
	types, highs, values := make([]string, 0, len(chunk)), make([]string, 0, len(chunk)), make([]string, 0, len(chunk))
	keys := make([]langKeySourceIdentity, 0, len(chunk))
	for key := range chunk {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].id != keys[j].id {
			return keys[i].id < keys[j].id
		}
		if keys[i].sourceType != keys[j].sourceType {
			return keys[i].sourceType < keys[j].sourceType
		}
		return keys[i].high < keys[j].high
	})
	for _, key := range keys {
		ids, types = append(ids, key.id), append(types, key.sourceType)
		highs, values = append(highs, key.high), append(values, chunk[key])
	}
	return ids, types, highs, values
}
