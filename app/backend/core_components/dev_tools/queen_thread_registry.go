// queen_thread_registry.go
// File-backed thread registry helpers for thread-first Queen browser UX.
// Bridges managed-session starts and transcript summaries with a shared conversation container.
// Exists to let browser continuations attach to one logical thread without changing the underlying run/session substrate.
package devtools

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"time"
)

type queenThreadManifest struct {
	ID              string   `json:"id"`
	ProjectRoot     string   `json:"project_root"`
	Title           string   `json:"title"`
	TaskID          *int     `json:"task_id,omitempty"`
	RunFilenames    []string `json:"run_filenames"`
	LastRunFilename string   `json:"last_run_filename"`
	CreatedAt       string   `json:"created_at"`
	UpdatedAt       string   `json:"updated_at"`
}

type queenThreadRecord struct {
	ID              string
	ProjectRoot     string
	Title           string
	TaskID          *int
	RunFilenames    []string
	LastRunFilename string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type queenThreadRunLink struct {
	ThreadID    string
	ThreadTitle string
	ThreadRuns  int
}

var queenThreadIDCounter uint64

func ensureQueenThreadForStart(
	projectRoot string,
	threadID string,
	continueFromRunFilename string,
	currentRunFilename string,
	titleHint string,
	taskID *int,
) (*queenThreadRecord, error) {
	currentRunFilename = normalizeQueenRunFilename(currentRunFilename)
	seedRunFilename := normalizeQueenRunFilename(continueFromRunFilename)
	if currentRunFilename == "" {
		return nil, fmt.Errorf("current run filename is required")
	}

	now := time.Now()
	if strings.TrimSpace(threadID) != "" {
		record, err := loadQueenThreadRecord(projectRoot, threadID)
		if err != nil {
			return nil, err
		}
		record.UpdatedAt = now
		if record.Title == "" {
			record.Title = buildQueenThreadTitle(titleHint, seedRunFilename, currentRunFilename)
		}
		if record.TaskID == nil {
			record.TaskID = taskID
		}
		record.RunFilenames = appendUniqueQueenRunFilename(record.RunFilenames, seedRunFilename)
		record.RunFilenames = appendUniqueQueenRunFilename(record.RunFilenames, currentRunFilename)
		record.LastRunFilename = currentRunFilename
		if err := persistQueenThreadRecord(record); err != nil {
			return nil, err
		}
		return record, nil
	}

	record := &queenThreadRecord{
		ID:              newQueenThreadID(),
		ProjectRoot:     projectRoot,
		Title:           buildQueenThreadTitle(titleHint, seedRunFilename, currentRunFilename),
		TaskID:          taskID,
		RunFilenames:    []string{},
		LastRunFilename: currentRunFilename,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	record.RunFilenames = appendUniqueQueenRunFilename(record.RunFilenames, seedRunFilename)
	record.RunFilenames = appendUniqueQueenRunFilename(record.RunFilenames, currentRunFilename)
	if err := persistQueenThreadRecord(record); err != nil {
		return nil, err
	}
	return record, nil
}

func queenThreadRegistryDir(projectRoot string) string {
	return filepath.Join(projectRoot, ".queen", "thread_registry")
}

func queenThreadRegistryDirFromTranscriptDir(transcriptDir string) string {
	return filepath.Join(filepath.Dir(transcriptDir), "thread_registry")
}

func queenThreadManifestPath(projectRoot string, threadID string) string {
	return filepath.Join(queenThreadRegistryDir(projectRoot), fmt.Sprintf("queen_thread_%s.json", threadID))
}

func loadQueenThreadRunIndex(registryDir string) (map[string]queenThreadRunLink, error) {
	threads, err := loadQueenThreadRegistryFromDir(registryDir)
	if err != nil {
		return nil, err
	}

	index := make(map[string]queenThreadRunLink, len(threads))
	for _, thread := range threads {
		link := queenThreadRunLink{
			ThreadID:    thread.ID,
			ThreadTitle: thread.Title,
			ThreadRuns:  len(thread.RunFilenames),
		}
		for _, filename := range thread.RunFilenames {
			if strings.TrimSpace(filename) == "" {
				continue
			}
			index[filename] = link
		}
	}
	return index, nil
}

func loadQueenThreadRecord(projectRoot string, threadID string) (*queenThreadRecord, error) {
	manifestPath := queenThreadManifestPath(projectRoot, threadID)
	payload, err := os.ReadFile(manifestPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("queen thread not found: %s", threadID)
		}
		return nil, err
	}

	var manifest queenThreadManifest
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return nil, err
	}
	return queenThreadRecordFromManifest(manifest, projectRoot)
}

func loadQueenThreadRegistryFromDir(registryDir string) ([]*queenThreadRecord, error) {
	entries, err := os.ReadDir(registryDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []*queenThreadRecord{}, nil
		}
		return nil, err
	}

	threads := make([]*queenThreadRecord, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		payload, err := os.ReadFile(filepath.Join(registryDir, entry.Name()))
		if err != nil {
			return nil, err
		}

		var manifest queenThreadManifest
		if err := json.Unmarshal(payload, &manifest); err != nil {
			return nil, err
		}

		record, err := queenThreadRecordFromManifest(manifest, "")
		if err != nil {
			return nil, err
		}
		threads = append(threads, record)
	}

	slices.SortFunc(threads, func(left *queenThreadRecord, right *queenThreadRecord) int {
		if left == nil && right == nil {
			return 0
		}
		if left == nil {
			return 1
		}
		if right == nil {
			return -1
		}
		switch {
		case left.UpdatedAt.After(right.UpdatedAt):
			return -1
		case left.UpdatedAt.Before(right.UpdatedAt):
			return 1
		default:
			return strings.Compare(left.ID, right.ID)
		}
	})

	return threads, nil
}

func queenThreadRecordFromManifest(manifest queenThreadManifest, fallbackProjectRoot string) (*queenThreadRecord, error) {
	projectRoot := strings.TrimSpace(manifest.ProjectRoot)
	if projectRoot == "" {
		projectRoot = fallbackProjectRoot
	}

	createdAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(manifest.CreatedAt))
	if err != nil {
		return nil, err
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(manifest.UpdatedAt))
	if err != nil {
		return nil, err
	}

	runFilenames := make([]string, 0, len(manifest.RunFilenames))
	for _, filename := range manifest.RunFilenames {
		runFilenames = appendUniqueQueenRunFilename(runFilenames, filename)
	}

	return &queenThreadRecord{
		ID:              manifest.ID,
		ProjectRoot:     projectRoot,
		Title:           manifest.Title,
		TaskID:          manifest.TaskID,
		RunFilenames:    runFilenames,
		LastRunFilename: normalizeQueenRunFilename(manifest.LastRunFilename),
		CreatedAt:       createdAt,
		UpdatedAt:       updatedAt,
	}, nil
}

func persistQueenThreadRecord(record *queenThreadRecord) error {
	if record == nil || strings.TrimSpace(record.ProjectRoot) == "" {
		return nil
	}

	registryDir := queenThreadRegistryDir(record.ProjectRoot)
	if err := os.MkdirAll(registryDir, 0o755); err != nil {
		return err
	}

	payload, err := json.Marshal(record.manifest())
	if err != nil {
		return err
	}

	manifestPath := queenThreadManifestPath(record.ProjectRoot, record.ID)
	tmpFile, err := os.CreateTemp(registryDir, filepath.Base(manifestPath)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer func() {
		_ = os.Remove(tmpPath)
	}()

	if _, err := tmpFile.Write(append(payload, '\n')); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Chmod(0o644); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	return os.Rename(tmpPath, manifestPath)
}

func (record *queenThreadRecord) manifest() queenThreadManifest {
	return queenThreadManifest{
		ID:              record.ID,
		ProjectRoot:     record.ProjectRoot,
		Title:           record.Title,
		TaskID:          record.TaskID,
		RunFilenames:    slices.Clone(record.RunFilenames),
		LastRunFilename: record.LastRunFilename,
		CreatedAt:       record.CreatedAt.Format(time.RFC3339Nano),
		UpdatedAt:       record.UpdatedAt.Format(time.RFC3339Nano),
	}
}

func appendUniqueQueenRunFilename(runFilenames []string, filename string) []string {
	trimmed := normalizeQueenRunFilename(filename)
	if trimmed == "" {
		return runFilenames
	}
	for _, existing := range runFilenames {
		if existing == trimmed {
			return runFilenames
		}
	}
	return append(runFilenames, trimmed)
}

func buildQueenThreadTitle(titleHint string, seedRunFilename string, currentRunFilename string) string {
	if preview := queenPromptPreview(titleHint); preview != "" {
		return preview
	}
	if trimmed := normalizeQueenRunFilename(seedRunFilename); trimmed != "" {
		return trimmed
	}
	if trimmed := normalizeQueenRunFilename(currentRunFilename); trimmed != "" {
		return trimmed
	}
	return "Queen conversation"
}

func normalizeQueenRunFilename(filename string) string {
	trimmed := strings.TrimSpace(filename)
	if trimmed == "" {
		return ""
	}
	base := filepath.Base(trimmed)
	if base == "." {
		return ""
	}
	return base
}

func newQueenThreadID() string {
	sequence := atomic.AddUint64(&queenThreadIDCounter, 1)
	return fmt.Sprintf("qt_%s_%03d", time.Now().Format("20060102_150405"), sequence%1000)
}
