// lang_key_code_inventory.go
// Inventories the exact files read by the language-key scanner using stat only.
// Shares the scanner's walker, root containment and exclusions with recognition.
// Binds trust to source metadata and the reviewed recognition policy on restart.
package system_table_tools

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

type langKeyCodeFile struct {
	readPath, relativePath string
	size, mtime            int64
}

func langKeyCodeInventory() ([]langKeyCodeFile, string, error) {
	roots, err := codebaseSourceRoots(currentLangKeyRuntimePaths())
	if err != nil {
		return nil, "", err
	}
	dirs, err := langKeyScanDirectories(roots)
	if err != nil {
		return nil, "", err
	}
	var files []langKeyCodeFile
	for _, dir := range dirs {
		err := walkLangKeySourceTree(dir.realPath, func(path string, info os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if path != dir.realPath && skipLangKeyCodePath(info.Name(), info.IsDir()) {
				if info.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if info.IsDir() {
				return nil
			}
			readPath, err := dir.fileToRead(path, info)
			if err != nil || readPath == "" {
				return err
			}
			if !scanExtensions[filepath.Ext(path)] {
				return nil
			}
			relative, err := dir.recordedPath(path)
			if err != nil {
				return err
			}
			stat, err := os.Stat(readPath)
			if err != nil {
				return err
			}
			files = append(files, langKeyCodeFile{readPath, relative, stat.Size(), stat.ModTime().UnixNano()})
			return nil
		})
		if err != nil {
			return nil, "", fmt.Errorf("scan language-key source directory %q: %w", dir.path, err)
		}
	}
	sortedFiles := append([]langKeyCodeFile(nil), files...)
	sort.Slice(sortedFiles, func(i, j int) bool { return sortedFiles[i].relativePath < sortedFiles[j].relativePath })
	hash := sha256.New()
	encode := json.NewEncoder(hash)
	// JSON sorts map keys. Include roots even when empty, and recognition policy
	// even if no source file changed. No file contents are read for this hash.
	for _, root := range roots {
		if err := encode.Encode([]string{root.path, root.labelRoot, root.realPath}); err != nil {
			return nil, "", err
		}
	}
	for _, dir := range dirs {
		if err := encode.Encode([]string{dir.path, dir.realPath, dir.labelRoot, dir.rootRealPath}); err != nil {
			return nil, "", err
		}
	}
	// Declaration.Owner is intentionally omitted from declaration JSON in B4;
	// include it explicitly here because changing an owner changes authority.
	catalogues := make([]any, 0, len(uiLiteralCatalogues))
	for _, catalogue := range uiLiteralCatalogues {
		catalogues = append(catalogues, map[string]any{"owner": catalogue.Owner, "declaration": catalogue})
	}
	policy := []any{uiLiteralScanner, langKeyHelperOwners, frontPageKeyHelpers, langKeyGlobalHelpers, catalogues}
	if err := encode.Encode(policy); err != nil {
		return nil, "", err
	}
	for _, file := range sortedFiles {
		if err := encode.Encode([]any{file.relativePath, file.size, file.mtime}); err != nil {
			return nil, "", err
		}
	}
	return files, hex.EncodeToString(hash.Sum(nil)), nil
}
