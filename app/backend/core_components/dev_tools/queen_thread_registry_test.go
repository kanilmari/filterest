package devtools

import (
	"path/filepath"
	"testing"
)

func TestEnsureQueenThreadForStartCreatesThreadAndSeedsRunHistory(t *testing.T) {
	projectRoot := t.TempDir()

	record, err := ensureQueenThreadForStart(
		projectRoot,
		"",
		"queen_run_seed.jsonl",
		"queen_run_current.jsonl",
		"Continue the browser conversation",
		nil,
	)
	if err != nil {
		t.Fatalf("ensureQueenThreadForStart returned error: %v", err)
	}

	if record.ID == "" {
		t.Fatal("expected thread id")
	}
	if record.Title != "Continue the browser conversation" {
		t.Fatalf("title = %q, want %q", record.Title, "Continue the browser conversation")
	}
	if len(record.RunFilenames) != 2 {
		t.Fatalf("run count = %d, want 2", len(record.RunFilenames))
	}
	if record.RunFilenames[0] != "queen_run_seed.jsonl" {
		t.Fatalf("seed run = %q, want queen_run_seed.jsonl", record.RunFilenames[0])
	}
	if record.LastRunFilename != "queen_run_current.jsonl" {
		t.Fatalf("last run = %q, want queen_run_current.jsonl", record.LastRunFilename)
	}
}

func TestEnsureQueenThreadForStartAppendsToExistingThread(t *testing.T) {
	projectRoot := t.TempDir()

	first, err := ensureQueenThreadForStart(
		projectRoot,
		"",
		"",
		"queen_run_first.jsonl",
		"Initial Queen task",
		nil,
	)
	if err != nil {
		t.Fatalf("first ensureQueenThreadForStart returned error: %v", err)
	}

	second, err := ensureQueenThreadForStart(
		projectRoot,
		first.ID,
		"",
		"queen_run_second.jsonl",
		"Follow-up task",
		nil,
	)
	if err != nil {
		t.Fatalf("second ensureQueenThreadForStart returned error: %v", err)
	}

	if second.ID != first.ID {
		t.Fatalf("thread id = %q, want %q", second.ID, first.ID)
	}
	if len(second.RunFilenames) != 2 {
		t.Fatalf("run count = %d, want 2", len(second.RunFilenames))
	}
	if second.LastRunFilename != "queen_run_second.jsonl" {
		t.Fatalf("last run = %q, want queen_run_second.jsonl", second.LastRunFilename)
	}
}

func TestLoadQueenThreadRunIndexMapsEachRunToThreadMetadata(t *testing.T) {
	projectRoot := t.TempDir()

	record, err := ensureQueenThreadForStart(
		projectRoot,
		"",
		"queen_run_seed.jsonl",
		"queen_run_current.jsonl",
		"Investigate browser path",
		nil,
	)
	if err != nil {
		t.Fatalf("ensureQueenThreadForStart returned error: %v", err)
	}

	index, err := loadQueenThreadRunIndex(filepath.Join(projectRoot, ".queen", "thread_registry"))
	if err != nil {
		t.Fatalf("loadQueenThreadRunIndex returned error: %v", err)
	}

	link, ok := index["queen_run_seed.jsonl"]
	if !ok {
		t.Fatal("expected seed run to be indexed")
	}
	if link.ThreadID != record.ID {
		t.Fatalf("thread id = %q, want %q", link.ThreadID, record.ID)
	}
	if link.ThreadTitle != record.Title {
		t.Fatalf("thread title = %q, want %q", link.ThreadTitle, record.Title)
	}
	if link.ThreadRuns != 2 {
		t.Fatalf("thread runs = %d, want 2", link.ThreadRuns)
	}
}
