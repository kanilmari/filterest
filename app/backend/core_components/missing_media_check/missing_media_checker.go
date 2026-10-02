// missing_media_checker.go
// Reads a bounded sample of media-referencing rows and reports the files that are gone.
// Between the registered file-upload relations, the storage directory and the stored result.
// Exists because a lost picture is otherwise silent: the row still exists, the page
// simply shows nothing, and nobody learns that the file left the disk.
package missing_media_check

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
	"time"

	links "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	media_utils "easelect/backend/core_components/media_utils"
)

// ResultSchemaVersion 2 added the installation a run checked, the sampling method,
// estimated counts, unreached datasets, failed runs and the unused-file walk status.
// Version 3 added the card picture pass: its counts and completeness, missing card
// pictures, pictures that could not be checked, card pictures kept from another row's
// folder (K121), and why an unused-file list was withheld. An older result still
// decodes: every added field reads as its zero value.
const ResultSchemaVersion = 3

// Reasons the unused-file list was withheld, kept stable so the interface can translate them.
const (
	UnusedWithheldDatasetsIncomplete = "datasets_incomplete"
	UnusedWithheldCardPassIncomplete = "card_pass_incomplete"
)

// Trigger values say who asked for the run.
const (
	TriggerStartup = "startup"
	TriggerManual  = "manual"
	// TriggerUpdate is the automatic run after an application or database update.
	TriggerUpdate = "update"
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

// Reasons a dataset was not reached, kept stable so the interface can translate them.
const (
	UnreachedLookupFailed = "lookup_failed"
	UnreachedCountFailed  = "count_failed"
	UnreachedReadFailed   = "read_failed"
	UnreachedTimeLimit    = "time_limit"
	UnreachedNoBudget     = "no_budget"
)

// UnreachedDataset is a dataset of which the run checked not a single row, and why.
type UnreachedDataset struct {
	Dataset    string `json:"dataset"`
	AssetTable string `json:"asset_table"`
	Reason     string `json:"reason"`
	Detail     string `json:"detail,omitempty"`
}

// DatasetSummary is what one dataset contributed to the run.
type DatasetSummary struct {
	Dataset           string `json:"dataset"`
	AssetTable        string `json:"asset_table"`
	RowCount          int    `json:"row_count"`
	RowCountEstimated bool   `json:"row_count_estimated"`
	PlannedRows       int    `json:"planned_rows"`
	CheckedRows       int    `json:"checked_rows"`
	MissingRows       int    `json:"missing_rows"`
	Complete          bool   `json:"complete"`
	UnusedFiles       int    `json:"unused_files"`
	UnusedSkipped     bool   `json:"unused_files_skipped"`
}

// Result is the stored answer an administrator sees without re-running the check.
type Result struct {
	SchemaVersion int    `json:"schema_version"`
	Trigger       string `json:"trigger"`
	StartedAt     string `json:"started_at"`
	FinishedAt    string `json:"finished_at"`
	DurationMs    int64  `json:"duration_ms"`

	// The installation the run checked. Another application or database version at
	// the next start is an update; the build is recorded for information only.
	AppVersion string `json:"app_version"`
	DBVersion  string `json:"db_version"`
	BuildID    string `json:"build_id,omitempty"`

	// Failed marks a run that stopped before it could finish; Errors say why.
	Failed bool `json:"failed"`

	Sampling     string `json:"sampling"`
	SamplingSeed int64  `json:"sampling_seed,omitempty"`

	MaxTotalRowsChecked int  `json:"max_total_rows_checked"`
	DatasetsTotal       int  `json:"datasets_total"`
	DatasetsChecked     int  `json:"datasets_checked"`
	RowsTotal           int  `json:"rows_total"`
	RowCountEstimated   bool `json:"row_count_estimated"`
	RowsPlanned         int  `json:"rows_planned"`
	RowsChecked         int  `json:"rows_checked"`

	MissingCount     int               `json:"missing_count"`
	MissingRows      []MissingMediaRow `json:"missing_rows"`
	MissingTruncated bool              `json:"missing_truncated"`
	// UncheckedFilesCount counts gallery rows whose file could not be looked at, for
	// example on an unreadable disk; they are not called missing.
	UncheckedFilesCount int `json:"unchecked_files_count"`

	RowBudgetReached     bool `json:"row_budget_reached"`
	TimeBudgetReached    bool `json:"time_budget_reached"`
	DatasetsExceedBudget bool `json:"datasets_exceed_budget"`
	UncheckedDatasets    int  `json:"unchecked_datasets"`
	MinimumPerDatasetMet bool `json:"minimum_per_dataset_met"`

	UnusedFilesRequested    bool     `json:"unused_files_requested"`
	UnusedFilesCount        int      `json:"unused_files_count"`
	UnusedFiles             []string `json:"unused_files"`
	UnusedFilesTruncated    bool     `json:"unused_files_truncated"`
	UnusedFilesWalkComplete bool     `json:"unused_files_walk_complete"`
	// UnusedFilesWithheld says why no file was called unused: any dataset's row can
	// point into any folder, so the list needs every gallery and every picture field read.
	UnusedFilesWithheld string `json:"unused_files_withheld,omitempty"`

	// The card picture pass: every picture field of every dataset.
	CardPicturesChecked        int                  `json:"card_pictures_checked"`
	CardPassComplete           bool                 `json:"card_pass_complete"`
	MissingCardPicturesCount   int                  `json:"missing_card_pictures_count"`
	MissingCardPictures        []CardPictureFinding `json:"missing_card_pictures"`
	UncheckedCardPicturesCount int                  `json:"unchecked_card_pictures_count"`
	UncheckedCardPictures      []CardPictureFinding `json:"unchecked_card_pictures"`
	KeptCardPicturesCount      int                  `json:"kept_card_pictures_count"`
	KeptCardPictures           []CardPictureFinding `json:"kept_card_pictures"`
	CardListsTruncated         bool                 `json:"card_lists_truncated"`

	Datasets          []DatasetSummary   `json:"datasets"`
	UnreachedDatasets []UnreachedDataset `json:"unreached_datasets"`
	Errors            []string           `json:"errors"`
}

// relationTarget is one registered file-upload relation, resolved to storage terms.
type relationTarget struct {
	Dataset        string
	AssetTable     string
	ForeignKey     string
	FilenameColumn string
	ParentTableUID string
}

// CheckInput carries everything one run needs, so the scan itself stays testable.
type CheckInput struct {
	Database    *sql.DB
	StorageRoot string
	Settings    Settings
	Trigger     string
	Identity    RunIdentity
	Now         func() time.Time
	// Seed fixes a random sample; zero draws a new seed from the clock.
	Seed int64
}

// checkRun is the state of one run while it reads datasets.
type checkRun struct {
	result            *Result
	settings          Settings
	reader            readOnlyQuerier
	fileState         func(relativePath string) media_utils.StoredFileStatus
	now               func() time.Time
	deadline          time.Time
	seed              int64
	referencedByOwner map[string]map[string]bool
}

// Run performs one bounded check and returns its result. It never writes to the
// database or to storage: a lost file is reported, never recreated, and a row whose
// file is gone is never deleted. On an error it still returns what it had found.
func Run(ctx context.Context, input CheckInput) (Result, error) {
	now := input.Now
	if now == nil {
		now = time.Now
	}
	settings := input.Settings.Sanitize()
	startedAt := now().UTC()
	result := newResult(settings, input, startedAt)
	if input.Database == nil {
		finishResult(&result, now().UTC(), startedAt)
		return result, errors.New("missing media check: no database connection")
	}

	// Every statement runs under the run's own time limit, so one slow statement can
	// spend the budget but never outlive it.
	runLimit := time.Duration(settings.MaxRunSeconds) * time.Second
	runCtx, cancel := context.WithTimeout(ctx, runLimit)
	defer cancel()
	run := &checkRun{
		result:            &result,
		settings:          settings,
		reader:            readOnlyQuerier{ctx: runCtx, database: input.Database},
		fileState:         media_utils.StoredFileState(input.StorageRoot),
		now:               now,
		deadline:          startedAt.Add(runLimit),
		seed:              result.SamplingSeed,
		referencedByOwner: map[string]map[string]bool{},
	}

	targets, unreachedTargets, err := listRelationTargets(run.reader)
	if err != nil {
		finishResult(&result, now().UTC(), startedAt)
		return result, err
	}
	result.UnreachedDatasets = append(result.UnreachedDatasets, unreachedTargets...)
	result.DatasetsTotal = len(targets) + len(unreachedTargets)

	counts, uncounted := countDatasetRows(run.reader, targets, settings.ExactCountMaxRows)
	run.addUnreached(uncounted)

	// The card picture pass reads from the same row limit: a fifth of it is kept for
	// that pass, and the pass also gets whatever the gallery pass leaves unused.
	galleryBudget := settings.MaxTotalRowsChecked - settings.MaxTotalRowsChecked/cardPassReservedShare
	plan := PlanRowBudget(counts, galleryBudget, settings.MinRowsPerDataset)
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
	for _, budget := range plan.Datasets {
		target, ok := targetsByTable[budget.AssetTable]
		if !ok {
			continue
		}
		result.RowCountEstimated = result.RowCountEstimated || budget.Estimated
		result.Datasets = append(result.Datasets, run.checkDataset(target, budget))
	}

	run.runCardPass()

	if settings.ReportUnusedFiles {
		if reason := unusedFilesWithheldReason(&result); reason != "" {
			result.UnusedFilesWithheld = reason
			for index := range result.Datasets {
				result.Datasets[index].UnusedSkipped = true
			}
		} else {
			collectUnusedFiles(&result, settings, input.StorageRoot, targetsByTable, run.referencedByOwner, run.timeLeft)
		}
	}
	finishResult(&result, now().UTC(), startedAt)
	return result, nil
}

// unusedFilesWithheldReason says why no file may be called unused, or nothing when it
// may: a row of any dataset can point into any folder, so a file is unused only when
// every gallery was read completely and every picture field was read.
func unusedFilesWithheldReason(result *Result) string {
	if len(result.UnreachedDatasets) > 0 {
		return UnusedWithheldDatasetsIncomplete
	}
	for _, summary := range result.Datasets {
		if !summary.Complete {
			return UnusedWithheldDatasetsIncomplete
		}
	}
	if !result.CardPassComplete {
		return UnusedWithheldCardPassIncomplete
	}
	return ""
}

func newResult(settings Settings, input CheckInput, startedAt time.Time) Result {
	result := Result{
		SchemaVersion:         ResultSchemaVersion,
		Trigger:               strings.TrimSpace(input.Trigger),
		StartedAt:             startedAt.Format(time.RFC3339),
		AppVersion:            input.Identity.AppVersion,
		DBVersion:             input.Identity.DBVersion,
		BuildID:               input.Identity.BuildID,
		Sampling:              settings.Sampling,
		MaxTotalRowsChecked:   settings.MaxTotalRowsChecked,
		MissingRows:           []MissingMediaRow{},
		UnusedFiles:           []string{},
		MissingCardPictures:   []CardPictureFinding{},
		UncheckedCardPictures: []CardPictureFinding{},
		KeptCardPictures:      []CardPictureFinding{},
		Datasets:              []DatasetSummary{},
		UnreachedDatasets:     []UnreachedDataset{},
		Errors:                []string{},
		UnusedFilesRequested:  settings.ReportUnusedFiles,
		MinimumPerDatasetMet:  true,
	}
	if result.Trigger == "" {
		result.Trigger = TriggerManual
	}
	if settings.Sampling == SamplingRandom {
		result.SamplingSeed = input.Seed
		if result.SamplingSeed == 0 {
			result.SamplingSeed = startedAt.UnixNano()
		}
	}
	return result
}

func finishResult(result *Result, finishedAt time.Time, startedAt time.Time) {
	result.FinishedAt = finishedAt.Format(time.RFC3339)
	result.DurationMs = finishedAt.Sub(startedAt).Milliseconds()
}

// timeLeft reports whether the run may still start or continue work.
func (run *checkRun) timeLeft() bool {
	return !run.reader.timeUp() && !run.now().UTC().After(run.deadline)
}

func (run *checkRun) addUnreached(unreached []UnreachedDataset) {
	for _, dataset := range unreached {
		if dataset.Reason == UnreachedTimeLimit {
			run.result.TimeBudgetReached = true
		}
		run.result.UnreachedDatasets = append(run.result.UnreachedDatasets, dataset)
	}
}

// checkDataset checks the rows one dataset's budget allows and summarises them. The
// summary counts the rows actually checked, which a sample over sparse ids can make
// fewer than the rows planned.
func (run *checkRun) checkDataset(target relationTarget, budget DatasetBudget) DatasetSummary {
	summary := DatasetSummary{
		Dataset:           budget.Dataset,
		AssetTable:        budget.AssetTable,
		RowCount:          budget.RowCount,
		RowCountEstimated: budget.Estimated,
		PlannedRows:       budget.PlannedRows,
	}
	if budget.PlannedRows <= 0 {
		run.addUnreached([]UnreachedDataset{unreachedDataset(target, UnreachedNoBudget, "")})
		return summary
	}
	if !run.timeLeft() {
		run.addUnreached([]UnreachedDataset{unreachedDataset(target, UnreachedTimeLimit, "")})
		return summary
	}

	stoppedByTime := false
	sample := rowSample{Method: run.settings.Sampling, Seed: datasetSeed(run.seed, target.AssetTable)}
	reachedEnd, err := readSampledRows(run.reader, target, budget, sample, func(row sampledAssetRow) bool {
		if !run.timeLeft() {
			stoppedByTime = true
			return false
		}
		if summary.CheckedRows >= budget.PlannedRows {
			// Rows added after the count are not read: the run keeps to its row limit,
			// which also holds the card pass's share, and the dataset counts as not
			// read to its end.
			run.result.RowBudgetReached = true
			return false
		}
		summary.CheckedRows++
		run.result.RowsChecked++
		run.checkRow(target, &summary, row)
		return true
	})
	if err != nil && run.reader.timeUp() {
		stoppedByTime, err = true, nil
	}
	if stoppedByTime {
		run.result.TimeBudgetReached = true
	}
	switch {
	case err != nil && summary.CheckedRows == 0:
		run.addUnreached([]UnreachedDataset{unreachedDataset(target, UnreachedReadFailed, err.Error())})
	case err != nil:
		run.result.Errors = append(run.result.Errors, fmt.Sprintf("%s: reading rows stopped: %v", target.Dataset, err))
	case stoppedByTime && summary.CheckedRows == 0:
		run.addUnreached([]UnreachedDataset{unreachedDataset(target, UnreachedTimeLimit, "")})
	}
	if summary.CheckedRows > 0 {
		run.result.DatasetsChecked++
	}
	summary.Complete = budget.Complete && reachedEnd && err == nil && !stoppedByTime
	return summary
}

// checkRow looks for one row's file in every size the storage route could serve.
func (run *checkRun) checkRow(target relationTarget, summary *DatasetSummary, row sampledAssetRow) {
	reference, resolved := ResolveReference(row.StoredValue, target.ParentTableUID, row.ParentRowID)
	missing := MissingMediaRow{
		Dataset:     target.Dataset,
		AssetTable:  target.AssetTable,
		AssetRowID:  row.AssetRowID,
		ParentRowID: row.ParentRowID,
		StoredValue: row.StoredValue,
	}
	if !resolved {
		missing.Reason = ReasonUnresolvedValue
		run.recordMissing(summary, missing)
		return
	}
	if run.settings.ReportUnusedFiles {
		owner := run.referencedByOwner[reference.OwnerFolder]
		if owner == nil {
			owner = map[string]bool{}
			run.referencedByOwner[reference.OwnerFolder] = owner
		}
		owner[reference.Filename] = true
	}
	switch media_utils.StoredPictureState(reference.RelativePaths, run.fileState) {
	case media_utils.StoredFileExists:
		return
	case media_utils.StoredFileUnknown:
		// Not called missing, as the card pass does not call such a picture missing.
		run.result.UncheckedFilesCount++
		return
	}
	missing.ExpectedPath = reference.RelativePaths[0]
	missing.Reason = ReasonNoFileInAnyVariant
	missing.Legacy = reference.Legacy
	run.recordMissing(summary, missing)
}

func (run *checkRun) recordMissing(summary *DatasetSummary, row MissingMediaRow) {
	summary.MissingRows++
	run.result.MissingCount++
	appendMissingRow(run.result, run.settings, row)
}

func appendMissingRow(result *Result, settings Settings, row MissingMediaRow) {
	if len(result.MissingRows) >= settings.MaxReportedMissing {
		result.MissingTruncated = true
		return
	}
	result.MissingRows = append(result.MissingRows, row)
}

func unreachedDataset(target relationTarget, reason string, detail string) UnreachedDataset {
	return UnreachedDataset{Dataset: target.Dataset, AssetTable: target.AssetTable, Reason: reason, Detail: detail}
}

// listRelationTargets returns every registered file-upload relation, which is the
// application's own list of datasets that can hold media. A relation whose dataset
// folder cannot be looked up is returned as unreached rather than silently dropped.
func listRelationTargets(reader readOnlyQuerier) ([]relationTarget, []UnreachedDataset, error) {
	statuses, err := links.ListFileUploadRelationStatuses(reader, "")
	if err != nil {
		return nil, nil, fmt.Errorf("list file upload relations: %w", err)
	}
	targets := make([]relationTarget, 0, len(statuses))
	unreached := []UnreachedDataset{}
	for _, status := range statuses {
		if status.ForeignKeyColumn == "" || status.ChildTable == "" || status.ParentTable == "" {
			continue
		}
		filenameColumn := status.UploadConfig.FilenameColumn
		if strings.TrimSpace(filenameColumn) == "" {
			filenameColumn = "filename"
		}
		target := relationTarget{
			Dataset:        status.ParentTable,
			AssetTable:     status.ChildTable,
			ForeignKey:     status.ForeignKeyColumn,
			FilenameColumn: filenameColumn,
		}
		parentTableUID, uidErr := links.LookupParentTableUID(reader, status.ParentTable)
		if uidErr != nil {
			reason := UnreachedLookupFailed
			if reader.timeUp() {
				reason = UnreachedTimeLimit
			}
			unreached = append(unreached, unreachedDataset(target, reason, uidErr.Error()))
			continue
		}
		target.ParentTableUID = fmt.Sprintf("%d", parentTableUID)
		targets = append(targets, target)
	}
	sort.SliceStable(targets, func(first, second int) bool {
		return targets[first].AssetTable < targets[second].AssetTable
	})
	return targets, unreached, nil
}

// collectUnusedFiles reports stored files that no checked row uses. It only looks
// at datasets whose rows were all read: after sampling, a file could look unused
// merely because the row that uses it was not in the sample. The walk stops when
// the run's time is up and then says it is incomplete.
func collectUnusedFiles(
	result *Result,
	settings Settings,
	storageRoot string,
	targetsByTable map[string]relationTarget,
	referencedByOwner map[string]map[string]bool,
	timeLeft func() bool,
) {
	result.UnusedFilesWalkComplete = true
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

	resolvedRoot := storageRoot
	if resolved, err := filepath.EvalSymlinks(storageRoot); err == nil {
		resolvedRoot = resolved
	}

	tableUIDs := make([]string, 0, len(completeTableUIDs))
	for tableUID, complete := range completeTableUIDs {
		if complete {
			tableUIDs = append(tableUIDs, tableUID)
		}
	}
	sort.Strings(tableUIDs)
	unusedByTableUID := map[string]int{}
	for _, tableUID := range tableUIDs {
		if !timeLeft() {
			result.UnusedFilesWalkComplete = false
			break
		}
		tableRoot := filepath.Join(resolvedRoot, tableUID)
		walkErr := filepath.WalkDir(tableRoot, func(currentPath string, entry fs.DirEntry, walkErr error) error {
			if !timeLeft() {
				result.UnusedFilesWalkComplete = false
				return fs.SkipAll
			}
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
	if !result.UnusedFilesWalkComplete {
		result.TimeBudgetReached = true
	}

	for index, summary := range result.Datasets {
		target, ok := targetsByTable[summary.AssetTable]
		if !ok || result.Datasets[index].UnusedSkipped {
			continue
		}
		result.Datasets[index].UnusedFiles = unusedByTableUID[target.ParentTableUID]
	}
}
