// missing_media_checker_test.go
// Verifies the unused-file direction of the missing-media check on a real storage folder.
// Between the rows a run checked and the files the dataset folders hold.
// Exists so a stray file is reported only from a dataset read completely, the dataset media
// folder is left alone, and a walk the time limit stopped says it is incomplete.
package missing_media_check

import (
	"fmt"
	"reflect"
	"testing"
)

func unusedFileFixture(t *testing.T, complete bool) (string, *Result, map[string]relationTarget, map[string]map[string]bool) {
	t.Helper()
	storageRoot := t.TempDir()
	writeStorageFile(t, storageRoot, "117/1/original/117_1_1.jpg")
	writeStorageFile(t, storageRoot, "117/1/300/117_1_1.jpg")
	writeStorageFile(t, storageRoot, "117/2/original/stray.jpg")
	writeStorageFile(t, storageRoot, "117/dataset_media/cover.jpg")
	result := &Result{
		Datasets:    []DatasetSummary{{Dataset: "about", AssetTable: "about_assets", Complete: complete}},
		UnusedFiles: []string{},
		Errors:      []string{},
	}
	targets := map[string]relationTarget{"about_assets": {Dataset: "about", AssetTable: "about_assets", ParentTableUID: "117"}}
	referenced := map[string]map[string]bool{"117/1": {"117_1_1.jpg": true}}
	return storageRoot, result, targets, referenced
}

func TestUnusedFileWalkReportsStrayFilesOfACompletelyReadDataset(t *testing.T) {
	storageRoot, result, targets, referenced := unusedFileFixture(t, true)

	collectUnusedFiles(result, DefaultSettings(), storageRoot, targets, referenced, func() bool { return true })

	if !reflect.DeepEqual(result.UnusedFiles, []string{"117/2/original/stray.jpg"}) || result.UnusedFilesCount != 1 {
		t.Fatalf("unused files = %v (%d), want only the stray file", result.UnusedFiles, result.UnusedFilesCount)
	}
	if !result.UnusedFilesWalkComplete || result.TimeBudgetReached || result.Datasets[0].UnusedFiles != 1 {
		t.Fatalf("result = %+v, want a complete walk crediting the dataset", result)
	}
}

func TestUnusedFileWalkLeavesASampledDatasetAlone(t *testing.T) {
	storageRoot, result, targets, referenced := unusedFileFixture(t, false)

	collectUnusedFiles(result, DefaultSettings(), storageRoot, targets, referenced, func() bool { return true })

	if result.UnusedFilesCount != 0 || !result.Datasets[0].UnusedSkipped || !result.UnusedFilesWalkComplete {
		t.Fatalf("result = %+v, want a sampled dataset skipped rather than its files called unused", result)
	}
}

func TestUnusedFileWalkStopsWhenTheTimeIsUpAndSaysSo(t *testing.T) {
	storageRoot, result, targets, referenced := unusedFileFixture(t, true)
	for row := 3; row < 40; row++ {
		writeStorageFile(t, storageRoot, fmt.Sprintf("117/%d/original/stray.jpg", row))
	}
	checks := 0
	timeLeft := func() bool {
		checks++
		return checks <= 3
	}

	collectUnusedFiles(result, DefaultSettings(), storageRoot, targets, referenced, timeLeft)

	if result.UnusedFilesWalkComplete || !result.TimeBudgetReached {
		t.Fatalf("result = %+v, want the walk reported incomplete and the time limit reached", result)
	}
	if result.UnusedFilesCount >= 38 {
		t.Fatalf("unused files = %d, want the walk to stop before it saw every stray file", result.UnusedFilesCount)
	}
}
