// missing_media_checker.go
// Reads a bounded sample of media-referencing rows and reports the files that are gone.
// Between the registered file-upload relations, the storage directory and the stored result.
// Exists because a lost picture is currently silent: the row still exists, the page
// simply shows nothing, and nobody learns that the file left the disk.
package missing_media_check

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	links "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	media_utils "easelect/backend/core_components/media_utils"

	"github.com/lib/pq"
)

// ResultSchemaVersion lets a later release recognise a stored result's shape.
const ResultSchemaVersion = 1

// Trigger values say who asked for the run.
const (
	TriggerStartup = "startup"
	TriggerManual  = "manual"
)

// datasetMediaFolder is the dataset-level cover/background folder that lives
// beside the row folders. Rows never reference it, so the unused-file direction
// must leave it alone instead of reporting every cover image as unused.
const datasetMediaFolder = "dataset_media"

// MissingMediaRow is one row whose picture is not on disk any more.
type MissingMediaRow struct {
	Dataset      string `json:"dataset"`
	AssetTable   string `json:"asset_table"`
	AssetRowID   int64  `json:"asset_row_id"`
	ParentRowID  int64  `json:"parent_row_id"`
	StoredValue  string `json:"stored_value"`
	ExpectedPath string `json:"expected_path"`
	Reason       string `json:"reason"`
	Legacy       bool   `json:"legacy_flat_filename"`
}

// Missing-row reasons, kept stable so the interface can translate them.
const (
	ReasonNoFileInAnyVariant = "no_file_in_any_variant"
	ReasonUnresolvedValue    = "unresolved_reference"
)

// DatasetSummary is what one dataset contributed to the run.
type DatasetSummary struct {
	Dataset       string `json:"dataset"`
	AssetTable    string `json:"asset_table"`
	RowCount      int    `json:"row_count"`
	PlannedRows   int    `json:"planned_rows"`
	CheckedRows   int    `json:"checked_rows"`
	MissingRows   int    `json:"missing_rows"`
	Complete      bool   `json:"complete"`
	UnusedFiles   int    `json:"unused_files"`
	UnusedSkipped bool   `json:"unused_files_skipped"`
}

// Result is the stored answer an administrator sees without re-running the check.
type Result struct {
	SchemaVersion int    `json:"schema_version"`
	Trigger       string `json:"trigger"`
	StartedAt     string `json:"started_at"`
	FinishedAt    string `json:"finished_at"`
	DurationMs    int64  `json:"duration_ms"`

	MaxTotalRowsChecked int `json:"max_total_rows_checked"`
	DatasetsTotal       int `json:"datasets_total"`
	DatasetsChecked     int `json:"datasets_checked"`
	RowsTotal           int `json:"rows_total"`
	RowsPlanned         int `json:"rows_planned"`
	RowsChecked         int `json:"rows_checked"`

	MissingCount     int               `json:"missing_count"`
	MissingRows      []MissingMediaRow `json:"missing_rows"`
	MissingTruncated bool              `json:"missing_truncated"`

	RowBudgetReached     bool `json:"row_budget_reached"`
	TimeBudgetReached    bool `json:"time_budget_reached"`
	DatasetsExceedBudget bool `json:"datasets_exceed_budget"`
	UncheckedDatasets    int  `json:"unchecked_datasets"`
	MinimumPerDatasetMet bool `json:"minimum_per_dataset_met"`

	UnusedFilesRequested bool     `json:"unused_files_requested"`
	UnusedFilesCount     int      `json:"unused_files_count"`
	UnusedFiles          []string `json:"unused_files"`
	UnusedFilesTruncated bool     `json:"unused_files_truncated"`

	Datasets []DatasetSummary `json:"datasets"`
	Errors   []string         `json:"errors"`
}

// relationTarget is one registered file-upload relation, resolved to storage terms.
type relationTarget struct {
	Dataset        string
	AssetTable     string
	ForeignKey     string
	FilenameColumn string
	ParentTableUID string
}

// fileExistsFunc is the filesystem probe for one storage-root-relative path.
type fileExistsFunc func(relativePath string) bool

// CheckInput carries everything one run needs, so the scan itself stays testable.
type CheckInput struct {
	Database    *sql.DB
	StorageRoot string
	Settings    Settings
	Trigger     string
	Now         func() time.Time
}

// Run performs one bounded check and returns its result. It never writes to the
// database rows or to storage: a lost file is reported, never recreated, and a
// row whose file is gone is never deleted.
func Run(ctx context.Context, input CheckInput) (Result, error) {
	now := input.Now
	if now == nil {
		now = time.Now
	}
	settings := input.Settings.Sanitize()
	startedAt := now().UTC()
	result := Result{
		SchemaVersion:        ResultSchemaVersion,
		Trigger:              strings.TrimSpace(input.Trigger),
		StartedAt:            startedAt.Format(time.RFC3339),
		MaxTotalRowsChecked:  settings.MaxTotalRowsChecked,
		MissingRows:          []MissingMediaRow{},
		UnusedFiles:          []string{},
		Datasets:             []DatasetSummary{},
		Errors:               []string{},
		UnusedFilesRequested: settings.ReportUnusedFiles,
		MinimumPerDatasetMet: true,
	}
	if result.Trigger == "" {
		result.Trigger = TriggerManual
	}

	targets, err := listRelationTargets(input.Database)
	if err != nil {
		return result, err
	}
	result.DatasetsTotal = len(targets)

	counts, countErrors := countDatasetRows(ctx, input.Database, targets)
	result.Errors = append(result.Errors, countErrors...)

	plan := PlanRowBudget(counts, settings.MaxTotalRowsChecked, settings.MinRowsPerDataset)
	result.RowsTotal = plan.TotalRows
	result.RowsPlanned = plan.PlannedRows
	result.DatasetsExceedBudget = plan.DatasetsExceedBudget
	result.UncheckedDatasets = plan.UncheckedDatasets
	result.MinimumPerDatasetMet = plan.MinimumPerDatasetMet
	result.RowBudgetReached = plan.PlannedRows < plan.TotalRows

	targetsByTable := make(map[string]relationTarget, len(targets))
	for _, target := range targets {
		targetsByTable[target.AssetTable] = target
	}

	deadline := startedAt.Add(time.Duration(settings.MaxRunSeconds) * time.Second)
	exists := storageFileExists(input.StorageRoot)
	referencedByOwner := map[string]map[string]bool{}

	for _, budget := range plan.Datasets {
		target, ok := targetsByTable[budget.AssetTable]
		if !ok {
			continue
		}
		summary := DatasetSummary{
			Dataset:     budget.Dataset,
			AssetTable:  budget.AssetTable,
			RowCount:    budget.RowCount,
			PlannedRows: budget.PlannedRows,
			Complete:    budget.Complete,
		}
		if budget.PlannedRows <= 0 {
			result.Datasets = append(result.Datasets, summary)
			continue
		}
		if now().UTC().After(deadline) {
			result.TimeBudgetReached = true
			result.Datasets = append(result.Datasets, summary)
			continue
		}

		rows, readErr := readSampledRows(ctx, input.Database, target, budget)
		if readErr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", budget.Dataset, readErr))
			result.Datasets = append(result.Datasets, summary)
			continue
		}

		for _, row := range rows {
			if now().UTC().After(deadline) {
				result.TimeBudgetReached = true
				summary.Complete = false
				break
			}
			summary.CheckedRows++
			result.RowsChecked++

			reference, resolved := ResolveReference(row.StoredValue, target.ParentTableUID, row.ParentRowID)
			if !resolved {
				summary.MissingRows++
				result.MissingCount++
				appendMissingRow(&result, settings, MissingMediaRow{
					Dataset:      budget.Dataset,
					AssetTable:   budget.AssetTable,
					AssetRowID:   row.AssetRowID,
					ParentRowID:  row.ParentRowID,
					StoredValue:  row.StoredValue,
					ExpectedPath: "",
					Reason:       ReasonUnresolvedValue,
				})
				continue
			}

			if settings.ReportUnusedFiles {
				owner := referencedByOwner[reference.OwnerFolder]
				if owner == nil {
					owner = map[string]bool{}
					referencedByOwner[reference.OwnerFolder] = owner
				}
				owner[reference.Filename] = true
			}

			if anyVariantExists(exists, reference.RelativePaths) {
				continue
			}
			summary.MissingRows++
			result.MissingCount++
			appendMissingRow(&result, settings, MissingMediaRow{
				Dataset:      budget.Dataset,
				AssetTable:   budget.AssetTable,
				AssetRowID:   row.AssetRowID,
				ParentRowID:  row.ParentRowID,
				StoredValue:  row.StoredValue,
				ExpectedPath: reference.RelativePaths[0],
				Reason:       ReasonNoFileInAnyVariant,
				Legacy:       reference.Legacy,
			})
		}

		if summary.CheckedRows > 0 {
			result.DatasetsChecked++
		}
		summary.Complete = summary.CheckedRows >= budget.RowCount
		result.Datasets = append(result.Datasets, summary)
	}

	if settings.ReportUnusedFiles {
		collectUnusedFiles(&result, settings, input.StorageRoot, targetsByTable, referencedByOwner)
	}

	finishedAt := now().UTC()
	result.FinishedAt = finishedAt.Format(time.RFC3339)
	result.DurationMs = finishedAt.Sub(startedAt).Milliseconds()
	return result, nil
}

func appendMissingRow(result *Result, settings Settings, row MissingMediaRow) {
	if len(result.MissingRows) >= settings.MaxReportedMissing {
		result.MissingTruncated = true
		return
	}
	result.MissingRows = append(result.MissingRows, row)
}

func anyVariantExists(exists fileExistsFunc, relativePaths []string) bool {
	for _, relativePath := range relativePaths {
		if exists(relativePath) {
			return true
		}
	}
	return false
}

func storageFileExists(storageRoot string) fileExistsFunc {
	resolvedRoot := storageRoot
	// Native and container installations may reach storage through a symlink.
	if resolved, err := filepath.EvalSymlinks(storageRoot); err == nil {
		resolvedRoot = resolved
	}
	return func(relativePath string) bool {
		info, err := os.Stat(filepath.Join(resolvedRoot, filepath.FromSlash(relativePath)))
		return err == nil && info.Mode().IsRegular()
	}
}

// listRelationTargets returns every registered file-upload relation, which is the
// application's own list of datasets that can hold media.
func listRelationTargets(database *sql.DB) ([]relationTarget, error) {
	if database == nil {
		return nil, fmt.Errorf("missing media check: no database connection")
	}
	statuses, err := links.ListFileUploadRelationStatuses(database, "")
	if err != nil {
		return nil, fmt.Errorf("list file upload relations: %w", err)
	}
	targets := make([]relationTarget, 0, len(statuses))
	for _, status := range statuses {
		if status.ForeignKeyColumn == "" || status.ChildTable == "" || status.ParentTable == "" {
			continue
		}
		parentTableUID, uidErr := links.LookupParentTableUID(database, status.ParentTable)
		if uidErr != nil {
			continue
		}
		filenameColumn := status.UploadConfig.FilenameColumn
		if strings.TrimSpace(filenameColumn) == "" {
			filenameColumn = "filename"
		}
		targets = append(targets, relationTarget{
			Dataset:        status.ParentTable,
			AssetTable:     status.ChildTable,
			ForeignKey:     status.ForeignKeyColumn,
			FilenameColumn: filenameColumn,
			ParentTableUID: fmt.Sprintf("%d", parentTableUID),
		})
	}
	sort.SliceStable(targets, func(first, second int) bool {
		return targets[first].AssetTable < targets[second].AssetTable
	})
	return targets, nil
}

func countDatasetRows(ctx context.Context, database *sql.DB, targets []relationTarget) ([]DatasetRowCount, []string) {
	counts := make([]DatasetRowCount, 0, len(targets))
	failures := []string{}
	for _, target := range targets {
		query := fmt.Sprintf(
			`SELECT COUNT(*) FROM public.%s WHERE COALESCE(NULLIF(TRIM(%s::text), ''), '') <> ''`,
			pq.QuoteIdentifier(target.AssetTable),
			pq.QuoteIdentifier(target.FilenameColumn),
		)
		var rowCount int
		if err := database.QueryRowContext(ctx, query).Scan(&rowCount); err != nil {
			failures = append(failures, fmt.Sprintf("%s: count failed: %v", target.Dataset, err))
			continue
		}
		counts = append(counts, DatasetRowCount{
			Dataset:    target.Dataset,
			AssetTable: target.AssetTable,
			RowCount:   rowCount,
		})
	}
	return counts, failures
}

type sampledAssetRow struct {
	AssetRowID  int64
	ParentRowID int64
	StoredValue string
}

// readSampledRows takes an even sample across the dataset's rows: one row out of
// every `stride`, ordered by id. An even spread reaches old and new rows alike,
// and repeats identically, so two runs of the same installation are comparable.
func readSampledRows(ctx context.Context, database *sql.DB, target relationTarget, budget DatasetBudget) ([]sampledAssetRow, error) {
	stride := 1
	if budget.PlannedRows > 0 && budget.RowCount > budget.PlannedRows {
		stride = budget.RowCount / budget.PlannedRows
	}
	if stride < 1 {
		stride = 1
	}
	query := fmt.Sprintf(`
		SELECT sampled.asset_row_id, sampled.parent_row_id, sampled.stored_value
		FROM (
			SELECT
				asset_rows.id AS asset_row_id,
				asset_rows.%s AS parent_row_id,
				asset_rows.%s::text AS stored_value,
				ROW_NUMBER() OVER (ORDER BY asset_rows.id) AS sample_position
			FROM public.%s AS asset_rows
			WHERE COALESCE(NULLIF(TRIM(asset_rows.%s::text), ''), '') <> ''
		) AS sampled
		WHERE (sampled.sample_position - 1) %% $1 = 0
		ORDER BY sampled.sample_position
		LIMIT $2`,
		pq.QuoteIdentifier(target.ForeignKey),
		pq.QuoteIdentifier(target.FilenameColumn),
		pq.QuoteIdentifier(target.AssetTable),
		pq.QuoteIdentifier(target.FilenameColumn),
	)
	rows, err := database.QueryContext(ctx, query, stride, budget.PlannedRows)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sampled := make([]sampledAssetRow, 0, budget.PlannedRows)
	for rows.Next() {
		var assetRowID int64
		var parentRowID sql.NullInt64
		var storedValue sql.NullString
		if scanErr := rows.Scan(&assetRowID, &parentRowID, &storedValue); scanErr != nil {
			return nil, scanErr
		}
		sampled = append(sampled, sampledAssetRow{
			AssetRowID:  assetRowID,
			ParentRowID: parentRowID.Int64,
			StoredValue: storedValue.String,
		})
	}
	return sampled, rows.Err()
}

// collectUnusedFiles reports stored files that no checked row uses. It only looks
// at datasets whose rows were all read: after sampling, a file could look unused
// merely because the row that uses it was not in the sample.
func collectUnusedFiles(
	result *Result,
	settings Settings,
	storageRoot string,
	targetsByTable map[string]relationTarget,
	referencedByOwner map[string]map[string]bool,
) {
	// A parent dataset can own more than one media relation, and they all store
	// into the same `<table_uid>/` folder. A file is only safely called unused
	// when every relation that writes into that folder was read completely.
	completeTableUIDs := map[string]bool{}
	for _, summary := range result.Datasets {
		target, ok := targetsByTable[summary.AssetTable]
		if !ok {
			continue
		}
		if previous, seen := completeTableUIDs[target.ParentTableUID]; seen {
			completeTableUIDs[target.ParentTableUID] = previous && summary.Complete
			continue
		}
		completeTableUIDs[target.ParentTableUID] = summary.Complete
	}
	for index, summary := range result.Datasets {
		target, ok := targetsByTable[summary.AssetTable]
		if !ok || !completeTableUIDs[target.ParentTableUID] {
			result.Datasets[index].UnusedSkipped = true
		}
	}
	scannable := false
	for _, complete := range completeTableUIDs {
		if complete {
			scannable = true
			break
		}
	}
	if !scannable {
		return
	}

	resolvedRoot := storageRoot
	if resolved, err := filepath.EvalSymlinks(storageRoot); err == nil {
		resolvedRoot = resolved
	}

	unusedByTableUID := map[string]int{}
	for tableUID, complete := range completeTableUIDs {
		if !complete {
			continue
		}
		tableRoot := filepath.Join(resolvedRoot, tableUID)
		walkErr := filepath.WalkDir(tableRoot, func(currentPath string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				if entry != nil && entry.IsDir() && currentPath != tableRoot {
					return fs.SkipDir
				}
				return nil
			}
			if entry.IsDir() {
				if entry.Name() == datasetMediaFolder {
					return fs.SkipDir
				}
				return nil
			}
			if !entry.Type().IsRegular() {
				return nil
			}
			relativePath, relErr := filepath.Rel(resolvedRoot, currentPath)
			if relErr != nil {
				return nil
			}
			parts := strings.Split(filepath.ToSlash(relativePath), "/")
			if len(parts) != 4 || !media_utils.IsKnownVariant(parts[2]) {
				return nil
			}
			ownerFolder := parts[0] + "/" + parts[1]
			if referencedByOwner[ownerFolder][parts[3]] {
				return nil
			}
			result.UnusedFilesCount++
			unusedByTableUID[tableUID]++
			if len(result.UnusedFiles) >= settings.MaxReportedUnusedFiles {
				result.UnusedFilesTruncated = true
				return nil
			}
			result.UnusedFiles = append(result.UnusedFiles, filepath.ToSlash(relativePath))
			return nil
		})
		if walkErr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("unused files in %s: %v", tableUID, walkErr))
		}
	}

	for index, summary := range result.Datasets {
		target, ok := targetsByTable[summary.AssetTable]
		if !ok || result.Datasets[index].UnusedSkipped {
			continue
		}
		result.Datasets[index].UnusedFiles = unusedByTableUID[target.ParentTableUID]
	}
}
