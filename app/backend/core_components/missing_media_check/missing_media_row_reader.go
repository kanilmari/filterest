// missing_media_row_reader.go
// Counts and reads the media-referencing rows of one dataset within one run's limits.
// Between the check's row budget and the per-dataset asset tables in PostgreSQL.
// Exists so a large dataset is sampled evenly or at random across its whole id range,
// newest rows included, a small one is read completely page by page, and no statement
// of a run outlives the run's time limit or writes anything.
package missing_media_check

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"math/bits"
	"math/rand"
	"sort"

	"github.com/lib/pq"
)

// fullReadPageSize is how many rows one page of a completely checked dataset holds.
const fullReadPageSize = 1000

// sampleTargetsPerQuery is how many sample points one lookup statement resolves.
const sampleTargetsPerQuery = 500

// readOnlyQuerier sends every statement of a run under the run deadline, including the
// shared relation readers', and refuses to write: the check reports and never changes
// anything.
type readOnlyQuerier struct {
	ctx      context.Context
	database *sql.DB
}

// Exec is never allowed; it exists only so shared readers can accept this querier.
func (reader readOnlyQuerier) Exec(string, ...interface{}) (sql.Result, error) {
	return nil, errors.New("missing media check: the check never writes")
}

func (reader readOnlyQuerier) Query(query string, args ...interface{}) (*sql.Rows, error) {
	return reader.database.QueryContext(reader.ctx, query, args...)
}

func (reader readOnlyQuerier) QueryRow(query string, args ...interface{}) *sql.Row {
	return reader.database.QueryRowContext(reader.ctx, query, args...)
}

// timeUp reports whether the run deadline has cancelled the run's statements.
func (reader readOnlyQuerier) timeUp() bool {
	return reader.ctx.Err() != nil
}

type sampledAssetRow struct {
	AssetRowID  int64
	ParentRowID int64
	StoredValue string
}

// rowSample is how a sampled dataset picks its rows.
type rowSample struct {
	Method string
	Seed   int64
}

// storedValueCondition keeps the rows that name a file at all.
func storedValueCondition(target relationTarget) string {
	return fmt.Sprintf("btrim(asset_rows.%s::text) <> ''", pq.QuoteIdentifier(target.FilenameColumn))
}

// countDatasetRows counts each dataset's media rows. A dataset whose count cannot be
// read is returned as unreached instead of failing the run.
func countDatasetRows(reader readOnlyQuerier, targets []relationTarget, exactCountMaxRows int) ([]DatasetRowCount, []UnreachedDataset) {
	counts := make([]DatasetRowCount, 0, len(targets))
	unreached := []UnreachedDataset{}
	for _, target := range targets {
		count, err := countOneDataset(reader, target, exactCountMaxRows)
		if err != nil {
			if reader.timeUp() {
				unreached = append(unreached, unreachedDataset(target, UnreachedTimeLimit, ""))
				continue
			}
			unreached = append(unreached, unreachedDataset(target, UnreachedCountFailed, err.Error()))
			continue
		}
		counts = append(counts, count)
	}
	return counts, unreached
}

// countOneDataset counts at most exactCountMaxRows+1 rows, so counting a huge dataset
// costs no more than that. Past the bound it takes the larger of what it counted and
// PostgreSQL's own estimate of the table, and says the number is an estimate.
func countOneDataset(reader readOnlyQuerier, target relationTarget, exactCountMaxRows int) (DatasetRowCount, error) {
	count := DatasetRowCount{Dataset: target.Dataset, AssetTable: target.AssetTable}
	boundedQuery := fmt.Sprintf(
		`SELECT count(*) FROM (SELECT 1 FROM public.%s AS asset_rows WHERE %s LIMIT $1) AS bounded`,
		pq.QuoteIdentifier(target.AssetTable),
		storedValueCondition(target),
	)
	var bounded int64
	if err := reader.QueryRow(boundedQuery, int64(exactCountMaxRows)+1).Scan(&bounded); err != nil {
		return count, fmt.Errorf("count failed: %w", err)
	}
	if bounded <= int64(exactCountMaxRows) {
		count.RowCount = int(bounded)
		return count, nil
	}

	const estimateQuery = `SELECT COALESCE((SELECT reltuples::bigint FROM pg_class WHERE oid = to_regclass($1)), -1)`
	var estimate int64
	if err := reader.QueryRow(estimateQuery, "public."+pq.QuoteIdentifier(target.AssetTable)).Scan(&estimate); err != nil {
		return count, fmt.Errorf("estimate failed: %w", err)
	}
	count.RowCount = int(max(bounded, estimate))
	count.Estimated = true
	return count, nil
}

// readSampledRows visits the rows the budget allows and reports whether it reached
// the end of what it meant to read. A dataset planned in full is read in id order,
// page by page; any other is sampled across its whole id range. visit returns false
// to stop early, when the run's time is up.
func readSampledRows(
	reader readOnlyQuerier,
	target relationTarget,
	budget DatasetBudget,
	sample rowSample,
	visit func(sampledAssetRow) bool,
) (bool, error) {
	if budget.PlannedRows <= 0 {
		return true, nil
	}
	if budget.Complete {
		return readEveryRow(reader, target, visit)
	}
	lowestID, highestID, found, err := readIDRange(reader, target)
	if err != nil || !found {
		return err == nil, err
	}
	return readTargetRows(reader, target, sampleTargets(sample, lowestID, highestID, budget.PlannedRows), visit)
}

func assetRowColumns(target relationTarget) string {
	return fmt.Sprintf(
		"asset_rows.id, asset_rows.%s, asset_rows.%s::text",
		pq.QuoteIdentifier(target.ForeignKey),
		pq.QuoteIdentifier(target.FilenameColumn),
	)
}

// readEveryRow pages through all rows in id order, a page of fullReadPageSize at a time.
// The page start is a bigint: an integer id column would otherwise type the parameter
// as integer, which cannot hold the first page's start.
func readEveryRow(reader readOnlyQuerier, target relationTarget, visit func(sampledAssetRow) bool) (bool, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM public.%s AS asset_rows WHERE asset_rows.id > $1::bigint AND %s ORDER BY asset_rows.id LIMIT %d`,
		assetRowColumns(target),
		pq.QuoteIdentifier(target.AssetTable),
		storedValueCondition(target),
		fullReadPageSize,
	)
	after := int64(math.MinInt64)
	for {
		page, err := queryAssetRows(reader, query, after)
		if err != nil {
			return false, err
		}
		for _, row := range page {
			if !visit(row) {
				return false, nil
			}
			after = row.AssetRowID
		}
		if len(page) < fullReadPageSize {
			return true, nil
		}
	}
}

func readIDRange(reader readOnlyQuerier, target relationTarget) (int64, int64, bool, error) {
	query := fmt.Sprintf(
		`SELECT min(asset_rows.id), max(asset_rows.id) FROM public.%s AS asset_rows WHERE %s`,
		pq.QuoteIdentifier(target.AssetTable),
		storedValueCondition(target),
	)
	var lowest, highest sql.NullInt64
	if err := reader.QueryRow(query).Scan(&lowest, &highest); err != nil {
		return 0, 0, false, err
	}
	return lowest.Int64, highest.Int64, lowest.Valid && highest.Valid, nil
}

// readTargetRows reads, for every sample point, the first media row whose id is at
// least that point, sampleTargetsPerQuery points per statement. The points are in
// ascending order, so the rows come in ascending order too, and a row two points
// land on is visited once.
func readTargetRows(reader readOnlyQuerier, target relationTarget, targets []int64, visit func(sampledAssetRow) bool) (bool, error) {
	query := fmt.Sprintf(`
		SELECT picked.id, picked.parent_row_id, picked.stored_value
		FROM unnest($1::bigint[]) WITH ORDINALITY AS target(id, position)
		CROSS JOIN LATERAL (
			SELECT asset_rows.id,
			       asset_rows.%s AS parent_row_id,
			       asset_rows.%s::text AS stored_value
			FROM public.%s AS asset_rows
			WHERE asset_rows.id >= target.id AND %s
			ORDER BY asset_rows.id
			LIMIT 1
		) AS picked
		ORDER BY target.position`,
		pq.QuoteIdentifier(target.ForeignKey),
		pq.QuoteIdentifier(target.FilenameColumn),
		pq.QuoteIdentifier(target.AssetTable),
		storedValueCondition(target),
	)
	visited := false
	lastVisited := int64(0)
	for start := 0; start < len(targets); start += sampleTargetsPerQuery {
		end := min(start+sampleTargetsPerQuery, len(targets))
		rows, err := queryAssetRows(reader, query, pq.Int64Array(targets[start:end]))
		if err != nil {
			return false, err
		}
		for _, row := range rows {
			if visited && row.AssetRowID <= lastVisited {
				continue
			}
			if !visit(row) {
				return false, nil
			}
			visited = true
			lastVisited = row.AssetRowID
		}
	}
	return true, nil
}

func queryAssetRows(reader readOnlyQuerier, query string, argument interface{}) ([]sampledAssetRow, error) {
	rows, err := reader.Query(query, argument)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []sampledAssetRow{}
	for rows.Next() {
		var assetRowID int64
		var parentRowID sql.NullInt64
		var storedValue sql.NullString
		if err := rows.Scan(&assetRowID, &parentRowID, &storedValue); err != nil {
			return nil, err
		}
		result = append(result, sampledAssetRow{
			AssetRowID:  assetRowID,
			ParentRowID: parentRowID.Int64,
			StoredValue: storedValue.String,
		})
	}
	return result, rows.Err()
}

// sampleTargets returns count ascending sample points between lowestID and highestID.
// "even" spaces them evenly and always includes both ends, so the newest rows are
// checked as surely as the oldest; a single point is the newest id. "random" draws
// them from the seed, so a stored seed repeats the same sample. A range with fewer
// ids than points is covered id by id.
func sampleTargets(sample rowSample, lowestID, highestID int64, count int) []int64 {
	if count <= 0 || highestID < lowestID {
		return nil
	}
	span := uint64(highestID) - uint64(lowestID)
	if span < uint64(count) {
		targets := make([]int64, 0, int(span)+1)
		for offset := uint64(0); offset <= span; offset++ {
			targets = append(targets, int64(uint64(lowestID)+offset))
		}
		return targets
	}
	targets := make([]int64, count)
	if sample.Method == SamplingRandom {
		generator := rand.New(rand.NewSource(sample.Seed))
		for index := range targets {
			offset := generator.Uint64()
			if span < math.MaxUint64 {
				offset %= span + 1
			}
			targets[index] = int64(uint64(lowestID) + offset)
		}
		sort.Slice(targets, func(first, second int) bool { return targets[first] < targets[second] })
		return targets
	}
	if count == 1 {
		return []int64{highestID}
	}
	divisor := uint64(count - 1)
	for index := range targets {
		// index*span/(count-1) never exceeds span, so the 128-bit product always
		// divides back into 64 bits.
		high, low := bits.Mul64(uint64(index), span)
		step, _ := bits.Div64(high, low, divisor)
		targets[index] = int64(uint64(lowestID) + step)
	}
	return targets
}

// datasetSeed gives each dataset its own random stream from the run's one seed, so a
// dataset's sample does not change when another dataset is added or removed.
func datasetSeed(runSeed int64, assetTable string) int64 {
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(assetTable))
	return runSeed ^ int64(hash.Sum64())
}
