// lang_key_source_population.go
// Coordinates source discovery and daily evidence refreshes for translation keys.
// Connects code/schema/data scanners to bounded source writes and scan trust.
// Keeps incomplete scans from authorizing orphan marking or stale-source cleanup.
package system_table_tools

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/runtimepaths"
)

const langKeySourceVacuumMinWrites = 10_000

var (
	additionalLangKeySourceRoots   []string
	additionalLangKeySourceRootsMu sync.RWMutex
	currentLangKeyRuntimePaths     = runtimepaths.Current
	walkLangKeySourceTree          = filepath.Walk
	// Private seams keep the public scan path testable at small fixture sizes.
	langKeySourceVacuumThreshold = int64(langKeySourceVacuumMinWrites)
	runLangKeySourceVacuum       = func(db *sql.DB) error {
		_, err := db.Exec("VACUUM (ANALYZE) system_lang_key_sources")
		return err
	}
)

// ConfigureAdditionalLangKeySourceRoots records composition-owned source roots.
// Public Filterest configures none; private compositions must opt in explicitly.
func ConfigureAdditionalLangKeySourceRoots(sourceRoots []string) error {
	normalizedRoots := make([]string, 0, len(sourceRoots))
	seenRoots := make(map[string]bool, len(sourceRoots))
	for _, sourceRoot := range sourceRoots {
		if strings.TrimSpace(sourceRoot) == "" {
			return fmt.Errorf("additional language-key source root must not be empty")
		}
		if !filepath.IsAbs(sourceRoot) {
			return fmt.Errorf("additional language-key source root must be absolute: %q", sourceRoot)
		}
		normalizedRoot := filepath.Clean(sourceRoot)
		if seenRoots[normalizedRoot] {
			continue
		}
		seenRoots[normalizedRoot] = true
		normalizedRoots = append(normalizedRoots, normalizedRoot)
	}
	sort.Strings(normalizedRoots)

	additionalLangKeySourceRootsMu.Lock()
	additionalLangKeySourceRoots = normalizedRoots
	additionalLangKeySourceRootsMu.Unlock()
	return nil
}

func configuredAdditionalLangKeySourceRoots() []string {
	additionalLangKeySourceRootsMu.RLock()
	defer additionalLangKeySourceRootsMu.RUnlock()

	result := make([]string, len(additionalLangKeySourceRoots))
	copy(result, additionalLangKeySourceRoots)
	return result
}

func pathIsInsideRoot(root string, candidate string) bool {
	relativePath, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}
	return relativePath == "." ||
		(relativePath != ".." && !filepath.IsAbs(relativePath) &&
			!strings.HasPrefix(relativePath, ".."+string(filepath.Separator)))
}

func validateLangKeySourceRoot(sourceRoot string, requireApplicationMarkers bool) error {
	rootInfo, err := os.Stat(sourceRoot)
	if err != nil {
		return fmt.Errorf("language-key source root %q: %w", sourceRoot, err)
	}
	if !rootInfo.IsDir() {
		return fmt.Errorf("language-key source root %q is not a directory", sourceRoot)
	}
	if requireApplicationMarkers {
		for _, marker := range []string{"go.mod", "VERSION_APP"} {
			markerInfo, markerErr := os.Stat(filepath.Join(sourceRoot, marker))
			if markerErr != nil {
				return fmt.Errorf("language-key application root marker %q: %w", marker, markerErr)
			}
			if !markerInfo.Mode().IsRegular() {
				return fmt.Errorf("language-key application root marker %q is not a regular file", marker)
			}
		}
	}
	for _, sourceDirectory := range []string{"frontend", "backend", "components"} {
		directoryPath := filepath.Join(sourceRoot, sourceDirectory)
		directoryInfo, directoryErr := os.Stat(directoryPath)
		if sourceDirectory == "components" && os.IsNotExist(directoryErr) {
			// A dangling link is not an absent, optional source tree.
			if _, linkErr := os.Lstat(directoryPath); os.IsNotExist(linkErr) {
				continue
			}
		}
		if directoryErr != nil {
			return fmt.Errorf("language-key source directory %q: %w", directoryPath, directoryErr)
		}
		if !directoryInfo.IsDir() {
			return fmt.Errorf("language-key source directory %q is not a directory", directoryPath)
		}
	}
	return nil
}

// sourceEntry is a candidate until resolved against the existing key registry.
type sourceEntry struct {
	literalUI     bool   // Only reviewed full-key helper arguments and finite catalogues.
	schemaAlias   bool   // Live, declared linked-name builder; expanded against schema metadata.
	schemaBuilder string // Selects the projection's own alias-generation rule.
	langKey       string
	filePath      string // Relative to the installation/source label root.
	sourceType    string // Empty means definite code evidence; literals are the safety net.
	prefix        bool   // A candidate only; expanded against existing registry names.
}

// scanCodebaseForLangKeySources reads every configured frontend/backend/component
// tree, excluding tests and build output. It returns candidates with their paths;
// population must resolve them against the registry before recording evidence.
func scanCodebaseForLangKeySources() ([]sourceEntry, error) {
	files, _, err := langKeyCodeInventory()
	if err != nil {
		return nil, err
	}
	return scanLangKeyCodeFiles(files)
}

func scanLangKeyCodeFiles(files []langKeyCodeFile) ([]sourceEntry, error) {
	var results []sourceEntry
	for _, file := range files {
		readPath, relPath, ext := file.readPath, file.relativePath, filepath.Ext(file.relativePath)

		data, readErr := os.ReadFile(readPath)
		if readErr != nil {
			return nil, readErr
		}
		rawContent := string(data)
		content, tokens := lexLangKeyCode(rawContent, ext)

		// Kerätään kustakin tiedostosta löytyneet avaimet (deduplikoitu per tiedosto)
		foundInFile := make(map[string]bool)

		// Staattiset kieliavainviittaukset (data-lang-key, dataset.langKey, jne.)
		for _, pattern := range langKeyPatterns {
			for _, match := range pattern.FindAllStringSubmatch(content, -1) {
				if len(match) > 1 && !foundInFile[match[1]] {
					foundInFile[match[1]] = true
					results = append(results, sourceEntry{langKey: match[1], filePath: relPath})
				}
			}
		}
		// Go-tiedostoista: registerErrors{...} -tyyppiset avaimet
		if ext == ".go" {
			for _, match := range goTemplateKeyPattern.FindAllStringSubmatch(content, -1) {
				if len(match) > 1 && !foundInFile[match[1]] {
					foundInFile[match[1]] = true
					results = append(results, sourceEntry{langKey: match[1], filePath: relPath})
				}
			}
		}
		// JS-tiedostoista: tree-solmunimet (name: 'xxx')
		if ext == ".js" {
			for _, match := range treeNodeNamePattern.FindAllStringSubmatch(content, -1) {
				if len(match) > 1 && !foundInFile[match[1]] {
					foundInFile[match[1]] = true
					results = append(results, sourceEntry{langKey: match[1], filePath: relPath})
				}
			}
		}
		// D3a's literal safety net includes comments and must not inherit
		// the lexer's destructive masking; definite patterns above still do.
		results = appendLangKeyCodeCandidates(results, tokens, relPath, rawContent, foundInFile)
		declared, declarationErr := declaredLangKeyCandidates(relPath, rawContent, tokens)
		if declarationErr != nil {
			return nil, declarationErr
		}
		results = append(results, declared...)
	}

	return results, nil
}

// PopulateLangKeySources refreshes evidence without removing any previous rows
// unless every reader and writer succeeded and the code-key count is credible.
func PopulateLangKeySources() (total int, scanErr error) {
	return populateLangKeySources(langKeySourceChunkRows)
}

// The private size parameter lets regression fixtures exercise chunk boundaries.
func populateLangKeySources(chunkRows int) (total int, scanErr error) {
	sourceMaintenanceMu.Lock()
	defer sourceMaintenanceMu.Unlock()
	started := time.Now()
	var writer *langKeySourceWriter
	completed := false
	defer func() {
		var stats langKeySourceWriteStats
		if writer != nil {
			stats = writer.stats
		}
		vacuumResult := "skipped"
		var vacuumDuration time.Duration
		if completed && scanErr == nil && stats.inserted+stats.updated >= langKeySourceVacuumThreshold {
			// Registered before the failure/lock finalizer below: Go runs that
			// finalizer (including scanLock.Rollback) first. VACUUM therefore
			// uses the plain pool after the lock transaction releases its connection.
			vacuumStarted := time.Now()
			err := runLangKeySourceVacuum(backend.Db)
			vacuumDuration = time.Since(vacuumStarted)
			vacuumResult = "ok"
			if err != nil {
				vacuumResult = "failed"
				log.Printf("WARNING [PopulateLangKeySources] source VACUUM failed: %v", err)
			}
		}
		log.Printf("[PopulateLangKeySources] rows_seen=%d inserted=%d updated=%d explanations_written=%d chunks=%d deadlock_retries=%d milliseconds=%d vacuum=%s vacuum_milliseconds=%d",
			stats.seen, stats.inserted, stats.updated, stats.explanations, stats.chunks, stats.deadlockRetries, time.Since(started).Milliseconds(), vacuumResult, vacuumDuration.Milliseconds())
	}()
	markSourceScanFailed()
	stage := "lock"
	var attempt uiLiteralScanAttempt
	var scanLock *sql.Tx
	blocked := ""
	defer func() {
		// Keep serialization until failure state has also been persisted.
		defer func() {
			if scanLock != nil {
				scanLock.Rollback()
			}
		}()
		if scanErr != nil || blocked != "" {
			var subScan *sourceSubScanError
			if errors.As(scanErr, &subScan) {
				stage = subScan.name
			}
			if blocked == "" {
				recordSourceScanOutcome("partial", []string{stage})
			}
			if attempt.generation != "" {
				if _, err := attempt.finish(backend.Db, false); err != nil {
					scanErr = errors.Join(scanErr, fmt.Errorf("record failed UI scan: %w", err))
				}
			}
			log.Printf("ERROR [PopulateLangKeySources] blocked scan (%s): %v %s; orphan marking and stale source cleanup skipped", stage, scanErr, blocked)
		}
	}()
	var err error
	scanLock, err = lockUILiteralScan(backend.Db)
	if err != nil {
		return 0, fmt.Errorf("scan lock: %w", err)
	}
	stage = "code"
	files, fingerprint, inventoryErr := langKeyCodeInventory()
	// An unreadable inventory also invalidates prior trust before returning.
	attempt, err = beginUILiteralScan(backend.Db, fingerprint)
	if err != nil {
		return 0, fmt.Errorf("start UI scan: %w", err)
	}
	if inventoryErr != nil {
		return 0, fmt.Errorf("code: %w", inventoryErr)
	}
	codeSources, err := scanLangKeyCodeFiles(files)
	if err != nil {
		return 0, fmt.Errorf("code: %w", err)
	}

	stage = "registry"
	keyToID, err := fetchLangKeyRegistry()
	if err != nil {
		return 0, fmt.Errorf("registry: %w", err)
	}
	stage = "source_index"
	writer, err = newLangKeySourceWriter(chunkRows)
	if err != nil {
		return 0, &sourceSubScanError{stage, err}
	}
	stage = "code"
	codeKeys := make(map[int64]bool)
	for _, src := range resolveLangKeyCodeSources(codeSources, keyToID) {
		id, ok := keyToID[src.langKey]
		if !ok {
			continue
		}
		sourceType := src.sourceType
		if sourceType == "" {
			sourceType = "code"
		}
		low := ""
		if src.literalUI && sourceType == "code" {
			low = attempt.marker()
		}
		if err := writer.upsertSource(id, sourceType, src.filePath, low); err != nil {
			return total, &sourceSubScanError{stage, err}
		}
		total++
		if sourceType == "code" {
			codeKeys[id] = true
		}
	}
	if err := writer.finishStage(stage); err != nil {
		return total, err
	}
	// Each stage returns query, row iteration, conversion and write errors.
	for _, step := range []struct {
		name string
		run  func(map[string]int64) (int, error)
	}{
		{"schema", func(keys map[string]int64) (int, error) {
			return writer.scanSchemaLangKeySources(keys, codeSources, codeKeys)
		}},
		{"views", func(keys map[string]int64) (int, error) {
			return writer.scanNamedLangKeySources(keys, "view", "system_table_views", "name")
		}},
		{"groups", func(keys map[string]int64) (int, error) {
			return writer.scanNamedLangKeySources(keys, "group", "system_user_groups", "name")
		}},
		{"folders", func(keys map[string]int64) (int, error) {
			return writer.scanNamedLangKeySources(keys, "folder", "system_table_folders", "folder_name")
		}},
		{"foreign_keys", writer.scanForeignKeyLangKeyReferences},
		{"column_values", writer.scanHasLangKeyColumns},
	} {
		stage = step.name
		count, err := step.run(keyToID)
		total += count
		if err != nil {
			if writer.err != nil {
				return total, writer.finishStage(stage)
			}
			return total, fmt.Errorf("%s: %w", stage, err)
		}
		if err := writer.finishStage(stage); err != nil {
			return total, err
		}
	}
	stage = "history"
	suspicious, maximum, err := recordCodeSourceCount(backend.Db, len(codeKeys), timeNowUTC())
	if err != nil {
		return total, fmt.Errorf("history: %w", err)
	}
	if suspicious {
		recordSourceScanOutcome("suspicious", nil)
		blocked = fmt.Sprintf("suspicious scan: %d code keys below 90%% of seven-day maximum %d", len(codeKeys), maximum)
		return total, nil
	}
	stage = "cleanup"
	deletedCount, err := deleteStaleLangKeySources()
	if err != nil {
		return total, fmt.Errorf("cleanup: %w", err)
	}
	stage = "completion"
	if err := requireUILiteralCompletion(attempt, backend.Db); err != nil {
		return total, err
	}
	markSourceScanDone()
	completed = true
	if deletedCount > 0 {
		log.Printf("[PopulateLangKeySources] stale source cleanup removed %d outdated source rows", deletedCount)
	}
	log.Printf("[PopulateLangKeySources] %d source(s) saved; %d distinct code keys", total, len(codeKeys))
	return total, nil
}

// cleanupStaleLangKeySources only removes expired evidence after a trusted scan.
func cleanupStaleLangKeySources() int64 {
	sourceMaintenanceMu.Lock()
	defer sourceMaintenanceMu.Unlock()
	return cleanupStaleLangKeySourcesLocked()
}

func cleanupStaleLangKeySourcesLocked() int64 {
	if !SourceScanIsFresh() {
		log.Printf("[cleanupStaleLangKeySources] skipped: %s", sourceScanSkipReason())
		return 0
	}
	count, err := deleteStaleLangKeySources()
	if err != nil {
		log.Printf("ERROR [cleanupStaleLangKeySources] %v", err)
	}
	return count
}

// Called by population only after every sub-scan and the sanity floor succeed.
// Propagate both execution and result errors before publishing completion.
func deleteStaleLangKeySources() (int64, error) {
	result, err := backend.Db.Exec(`
        DELETE FROM system_lang_key_sources
        WHERE source_type IN ('code', 'code_literal', 'column', 'table', 'prefix', 'suffix', 'view', 'group', 'folder', 'db', 'foreign_key', 'column_value')
          AND last_seen < CURRENT_DATE - INTERVAL '7 days'
    `)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
