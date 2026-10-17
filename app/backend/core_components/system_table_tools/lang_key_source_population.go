// lang_key_source_population.go
// Populates lang_key_source records for translation keys missing source associations.
// Bridges dynamic table metadata, template references, and the lang_key_source table.
// Exists to back-fill source associations so orphaned translation keys become traceable.
package system_table_tools

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/runtimepaths"
)

var (
	additionalLangKeySourceRoots   []string
	additionalLangKeySourceRootsMu sync.RWMutex
	currentLangKeyRuntimePaths     = runtimepaths.Current
	walkLangKeySourceTree          = filepath.Walk
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
	var results []sourceEntry

	paths := currentLangKeyRuntimePaths()
	sourceRoots, err := codebaseSourceRoots(paths)
	if err != nil {
		return nil, err
	}

	scanDirs, err := langKeyScanDirectories(sourceRoots)
	if err != nil {
		return nil, err
	}

	for _, scanDir := range scanDirs {
		dir := scanDir.realPath
		walkErr := walkLangKeySourceTree(dir, func(path string, info os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if path != dir && skipLangKeyCodePath(info.Name(), info.IsDir()) {
				if info.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if info.IsDir() {
				return nil
			}
			readPath, linkErr := scanDir.fileToRead(path, info)
			if linkErr != nil || readPath == "" {
				return linkErr
			}
			ext := filepath.Ext(path)
			if !scanExtensions[ext] {
				return nil
			}
			data, readErr := os.ReadFile(readPath)
			if readErr != nil {
				return readErr
			}
			rawContent := string(data)
			content, tokens := lexLangKeyCode(rawContent, ext)
			relPath, relErr := scanDir.recordedPath(path)
			if relErr != nil {
				return relErr
			}

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
				return declarationErr
			}
			results = append(results, declared...)
			return nil
		})
		if walkErr != nil {
			return nil, fmt.Errorf("scan language-key source directory %q: %w", scanDir.path, walkErr)
		}
	}

	return results, nil
}

// PopulateLangKeySources refreshes evidence without removing any previous rows
// unless every reader and writer succeeded and the code-key count is credible.
func PopulateLangKeySources() (total int, scanErr error) {
	sourceMaintenanceMu.Lock()
	defer sourceMaintenanceMu.Unlock()
	markSourceScanFailed()
	stage := "code"
	defer func() {
		if scanErr != nil {
			var subScan *sourceSubScanError
			if errors.As(scanErr, &subScan) {
				stage = subScan.name
			}
			recordSourceScanOutcome("partial", []string{stage})
			log.Printf("[PopulateLangKeySources] partial scan (%s): %v; orphan marking and stale source cleanup skipped", stage, scanErr)
		}
	}()
	codeSources, err := scanCodebaseForLangKeySources()
	if err != nil {
		return 0, fmt.Errorf("code: %w", err)
	}
	stage = "registry"
	keyToID, err := fetchLangKeyRegistry()
	if err != nil {
		return 0, fmt.Errorf("registry: %w", err)
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
		if err := upsertSource(id, sourceType, src.filePath, ""); err != nil {
			return total, fmt.Errorf("code: %w", err)
		}
		total++
		if sourceType == "code" {
			codeKeys[id] = true
		}
	}
	// Each stage returns query, row iteration, conversion and write errors.
	for _, step := range []struct {
		name string
		run  func(map[string]int64) (int, error)
	}{
		{"schema", func(keys map[string]int64) (int, error) { return scanSchemaLangKeySources(keys, codeSources, codeKeys) }},
		{"views", func(keys map[string]int64) (int, error) {
			return scanNamedLangKeySources(keys, "view", "system_table_views", "name")
		}},
		{"groups", func(keys map[string]int64) (int, error) {
			return scanNamedLangKeySources(keys, "group", "system_user_groups", "name")
		}},
		{"folders", func(keys map[string]int64) (int, error) {
			return scanNamedLangKeySources(keys, "folder", "system_table_folders", "folder_name")
		}},
		{"foreign_keys", scanForeignKeyLangKeyReferences},
		{"column_values", scanHasLangKeyColumns},
	} {
		stage = step.name
		count, err := step.run(keyToID)
		total += count
		if err != nil {
			return total, fmt.Errorf("%s: %w", stage, err)
		}
	}
	stage = "history"
	suspicious, maximum, err := recordCodeSourceCount(backend.Db, len(codeKeys), timeNowUTC())
	if err != nil {
		return total, fmt.Errorf("history: %w", err)
	}
	if suspicious {
		recordSourceScanOutcome("suspicious", nil)
		log.Printf("[PopulateLangKeySources] suspicious scan: %d code keys below 90%% of seven-day maximum %d; orphan marking and stale source cleanup skipped", len(codeKeys), maximum)
		return total, nil
	}
	markSourceScanDone()
	if deletedCount := cleanupStaleLangKeySourcesLocked(); deletedCount > 0 {
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
	result, err := backend.Db.Exec(`
        DELETE FROM system_lang_key_sources
        WHERE source_type IN ('code', 'code_literal', 'column', 'table', 'prefix', 'suffix', 'view', 'group', 'folder', 'db', 'foreign_key', 'column_value')
          AND last_seen < CURRENT_DATE - INTERVAL '7 days'
    `)
	if err != nil {
		log.Printf("[cleanupStaleLangKeySources] error: %v", err)
		return 0
	}
	deletedRows, err := result.RowsAffected()
	if err != nil {
		return 0
	}
	return deletedRows
}
