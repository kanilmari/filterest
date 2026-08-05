// filterest_paths.go
// Resolves operator-provided project and key homes from one portable locator.
// Bridges Go startup with Python, Node, and shell tooling path semantics.
// Exists so safety follows normalized paths instead of fixed directory names.
package backend

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

const (
	filterestPathsFile      = "filterest.paths"
	filterestLocalPathsFile = "filterest.paths.local"
)

type filterestHomes struct {
	ProjectsHome           string
	KeysHome               string
	ProjectsHomeConfigured bool
	KeysHomeConfigured     bool
}

func readFilterestPathsFile(path string) (map[string]string, error) {
	values := map[string]string{}
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return values, nil
		}
		return nil, err
	}
	defer file.Close()
	if filepath.Base(path) == filterestLocalPathsFile {
		info, err := file.Stat()
		if err != nil {
			return nil, err
		}
		if info.Mode().Perm()&0o022 != 0 {
			return nil, fmt.Errorf(
				"%s: local path locator must not be writable by group or others",
				path,
			)
		}
	}

	supported := map[string]bool{
		"schema_version": true,
		"projects_home":  true,
		"keys_home":      true,
	}
	scanner := bufio.NewScanner(file)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			return nil, fmt.Errorf("%s:%d: expected key=value", path, lineNumber)
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if !supported[key] {
			return nil, fmt.Errorf("%s:%d: unsupported key %q", path, lineNumber, key)
		}
		if _, duplicate := values[key]; duplicate {
			return nil, fmt.Errorf("%s:%d: duplicate key %q", path, lineNumber, key)
		}
		values[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if schemaVersion := values["schema_version"]; schemaVersion != "" && schemaVersion != "1" {
		return nil, fmt.Errorf("%s: unsupported schema_version %q", path, schemaVersion)
	}
	return values, nil
}

func resolvePathWithExistingSymlinks(path string) (string, error) {
	cleaned := filepath.Clean(path)
	existing := cleaned
	var suffix []string
	for {
		if _, err := os.Lstat(existing); err == nil {
			break
		} else if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			break
		}
		suffix = append(suffix, filepath.Base(existing))
		existing = parent
	}
	resolvedExisting, err := filepath.EvalSymlinks(existing)
	if err != nil {
		return "", err
	}
	for index := len(suffix) - 1; index >= 0; index-- {
		resolvedExisting = filepath.Join(resolvedExisting, suffix[index])
	}
	return filepath.Clean(resolvedExisting), nil
}

func resolveFilterestHome(projectRoot string, rawValue string, label string) (string, error) {
	value := strings.TrimSpace(rawValue)
	if value == "" {
		return "", fmt.Errorf("%s must not be empty", label)
	}
	if strings.IndexFunc(value, unicode.IsControl) >= 0 {
		return "", fmt.Errorf("%s must not contain control characters", label)
	}
	if strings.ContainsAny(value, "*?[]\\") {
		return "", fmt.Errorf(
			"%s must not contain pattern characters (*, ?, [, ], or backslash)",
			label,
		)
	}
	candidate := value
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(projectRoot, candidate)
	}
	resolved, err := resolvePathWithExistingSymlinks(candidate)
	if err != nil {
		return "", fmt.Errorf("resolve %s: %w", label, err)
	}
	volumeRoot := filepath.VolumeName(resolved) + string(filepath.Separator)
	if resolved == volumeRoot {
		return "", fmt.Errorf("%s must not resolve to the filesystem root", label)
	}
	if resolved == projectRoot {
		return "", fmt.Errorf("%s must not resolve to the checkout root", label)
	}
	gitRoot := filepath.Join(projectRoot, ".git")
	if pathContainsPath(gitRoot, resolved) {
		return "", fmt.Errorf("%s must not resolve inside .git", label)
	}
	return resolved, nil
}

func pathContainsPath(parent string, child string) bool {
	relative, err := filepath.Rel(parent, child)
	if err != nil {
		return true
	}
	return relative == "." ||
		(relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)))
}

func filterestHomesOverlap(first string, second string) bool {
	return pathContainsPath(first, second) || pathContainsPath(second, first)
}

func resolveFilterestHomes(projectRoot string, privateSource bool) (filterestHomes, error) {
	normalizedRoot, err := resolvePathWithExistingSymlinks(projectRoot)
	if err != nil {
		return filterestHomes{}, err
	}
	defaultProjectsHome := filepath.Join(normalizedRoot, "filterest_projects")
	defaultKeysHome := filepath.Join(normalizedRoot, "filterest_keys")
	if privateSource {
		defaultProjectsHome = filepath.Join(normalizedRoot, "..", "filterest-projects")
		defaultKeysHome = filepath.Join(normalizedRoot, "..", "filterest_keys")
	}
	values := map[string]string{
		"projects_home": defaultProjectsHome,
		"keys_home":     defaultKeysHome,
	}
	configured := map[string]bool{}
	for _, configName := range []string{filterestPathsFile, filterestLocalPathsFile} {
		fileValues, err := readFilterestPathsFile(filepath.Join(normalizedRoot, configName))
		if err != nil {
			return filterestHomes{}, err
		}
		for _, key := range []string{"projects_home", "keys_home"} {
			if value, ok := fileValues[key]; ok {
				values[key] = value
				configured[key] = true
			}
		}
	}
	if value := strings.TrimSpace(os.Getenv("FILTEREST_PROJECTS_HOME")); value != "" && strings.TrimSpace(os.Getenv("FILTEREST_PROJECTS_HOME_CONFIGURED")) != "0" {
		values["projects_home"] = value
		configured["projects_home"] = true
	}
	if value := strings.TrimSpace(os.Getenv("FILTEREST_KEYS_HOME")); value != "" && strings.TrimSpace(os.Getenv("FILTEREST_KEYS_HOME_CONFIGURED")) != "0" {
		values["keys_home"] = value
		configured["keys_home"] = true
	}

	legacyKeyRoot := strings.TrimSpace(os.Getenv("EASELECT_KEY_ROOT"))
	if privateSource && legacyKeyRoot != "" {
		if !filepath.IsAbs(legacyKeyRoot) {
			return filterestHomes{}, fmt.Errorf("invalid EASELECT_KEY_ROOT: path must be absolute")
		}
		resolvedLegacy, err := resolveFilterestHome(normalizedRoot, legacyKeyRoot, "EASELECT_KEY_ROOT")
		if err != nil {
			return filterestHomes{}, err
		}
		if pathContainsPath(normalizedRoot, resolvedLegacy) {
			return filterestHomes{}, fmt.Errorf(
				"invalid EASELECT_KEY_ROOT: path must stay outside the Easelect repository",
			)
		}
		if configured["keys_home"] {
			resolvedConfigured, err := resolveFilterestHome(normalizedRoot, values["keys_home"], "keys_home")
			if err != nil {
				return filterestHomes{}, err
			}
			if resolvedConfigured != resolvedLegacy {
				return filterestHomes{}, fmt.Errorf(
					"EASELECT_KEY_ROOT conflicts with the configured keys_home",
				)
			}
		}
		values["keys_home"] = resolvedLegacy
		configured["keys_home"] = true
	}

	projectsHome, err := resolveFilterestHome(normalizedRoot, values["projects_home"], "projects_home")
	if err != nil {
		return filterestHomes{}, err
	}
	keysHome, err := resolveFilterestHome(normalizedRoot, values["keys_home"], "keys_home")
	if err != nil {
		return filterestHomes{}, err
	}
	if filterestHomesOverlap(projectsHome, keysHome) {
		return filterestHomes{}, fmt.Errorf("projects_home and keys_home must not be equal or nested")
	}
	return filterestHomes{
		ProjectsHome:           projectsHome,
		KeysHome:               keysHome,
		ProjectsHomeConfigured: configured["projects_home"],
		KeysHomeConfigured:     configured["keys_home"],
	}, nil
}
