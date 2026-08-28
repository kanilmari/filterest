// symbol_registry_reader.go
// Reads the operator-visible SVG symbol library from the application filesystem.
// Bridges safe database icon keys with reviewed SVG files used by dataset and field renderers.
// Exists so database metadata never stores or injects raw SVG or arbitrary filesystem paths.
package symbol_registry

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

const (
	defaultSymbolKey = "table"
	maxSymbolBytes   = 128 * 1024
)

var (
	symbolKeyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
	registryMu       sync.RWMutex
	symbolDirectory  string
)

var allowedSVGElements = map[string]bool{
	"svg": true, "g": true, "path": true, "circle": true, "ellipse": true,
	"line": true, "polyline": true, "polygon": true, "rect": true,
	"title": true, "desc": true,
}

// Symbol describes one safe filesystem-backed SVG exposed to metadata editors.
type Symbol struct {
	Key string `json:"key"`
	URL string `json:"url"`
}

// ConfigureDirectory binds the registry to the reviewed SVG asset directory.
// The router calls this once with the active frontend root during startup.
func ConfigureDirectory(directory string) {
	registryMu.Lock()
	defer registryMu.Unlock()
	symbolDirectory = filepath.Clean(directory)
}

func configuredDirectory() (string, error) {
	registryMu.RLock()
	directory := symbolDirectory
	registryMu.RUnlock()
	if strings.TrimSpace(directory) == "" {
		return "", errors.New("symbol registry directory is not configured")
	}
	return directory, nil
}

// NormalizeKey accepts only metadata-safe keys and otherwise returns the stable table fallback.
func NormalizeKey(key string) string {
	normalized := strings.ToLower(strings.TrimSpace(key))
	if !symbolKeyPattern.MatchString(normalized) {
		return defaultSymbolKey
	}
	return normalized
}

// List returns only syntactically valid, safe SVG files from the configured directory.
func List() ([]Symbol, error) {
	directory, err := configuredDirectory()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("read symbol registry directory: %w", err)
	}

	symbols := make([]Symbol, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || strings.ToLower(filepath.Ext(entry.Name())) != ".svg" {
			continue
		}
		key := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		if NormalizeKey(key) != key {
			continue
		}
		if _, err := readSafeSVG(filepath.Join(directory, entry.Name())); err != nil {
			continue
		}
		symbols = append(symbols, Symbol{Key: key, URL: AssetURL(key)})
	}
	sort.Slice(symbols, func(i, j int) bool { return symbols[i].Key < symbols[j].Key })
	return symbols, nil
}

// Contains proves that a requested metadata key resolves to a safe registered file.
func Contains(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	if normalized == "" || NormalizeKey(normalized) != normalized {
		return false
	}
	_, err := readByKey(normalized)
	return err == nil
}

// Read returns the requested safe SVG, falling back to the table symbol for stale metadata.
func Read(key string) ([]byte, string, error) {
	normalized := NormalizeKey(key)
	content, err := readByKey(normalized)
	if err == nil {
		return content, normalized, nil
	}
	if normalized == defaultSymbolKey {
		return nil, "", err
	}
	content, fallbackErr := readByKey(defaultSymbolKey)
	if fallbackErr != nil {
		return nil, "", fmt.Errorf("read requested symbol: %v; read fallback: %w", err, fallbackErr)
	}
	return content, defaultSymbolKey, nil
}

// AssetURL returns the only public URL shape accepted by the symbol asset handler.
func AssetURL(key string) string {
	return "/symbol-assets/" + NormalizeKey(key) + ".svg"
}

func readByKey(key string) ([]byte, error) {
	directory, err := configuredDirectory()
	if err != nil {
		return nil, err
	}
	return readSafeSVG(filepath.Join(directory, key+".svg"))
}

func readSafeSVG(path string) ([]byte, error) {
	fileInfo, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !fileInfo.Mode().IsRegular() {
		return nil, errors.New("symbol asset must be a regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	content, err := io.ReadAll(io.LimitReader(file, maxSymbolBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read svg: %w", err)
	}
	if len(content) == 0 || len(content) > maxSymbolBytes {
		return nil, errors.New("svg size is outside the allowed range")
	}
	if err := validateSVG(content); err != nil {
		return nil, err
	}
	return content, nil
}

func validateSVG(content []byte) error {
	decoder := xml.NewDecoder(strings.NewReader(string(content)))
	rootSeen := false
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("parse svg: %w", err)
		}
		switch token.(type) {
		case xml.ProcInst, xml.Directive:
			return errors.New("svg processing instructions and directives are not allowed")
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		name := strings.ToLower(start.Name.Local)
		if !rootSeen {
			if name != "svg" {
				return errors.New("svg root element is required")
			}
			rootSeen = true
		}
		if !allowedSVGElements[name] {
			return fmt.Errorf("svg element %q is not allowed", name)
		}
		for _, attribute := range start.Attr {
			attributeName := strings.ToLower(attribute.Name.Local)
			attributeValue := strings.ToLower(strings.TrimSpace(attribute.Value))
			if strings.HasPrefix(attributeName, "on") || attributeName == "href" || attributeName == "style" {
				return fmt.Errorf("svg attribute %q is not allowed", attributeName)
			}
			if strings.Contains(attributeValue, "javascript:") || strings.Contains(attributeValue, "data:") || strings.Contains(attributeValue, "url(") {
				return fmt.Errorf("svg attribute %q contains an unsafe value", attributeName)
			}
		}
	}
	if !rootSeen {
		return errors.New("svg root element is required")
	}
	return nil
}
