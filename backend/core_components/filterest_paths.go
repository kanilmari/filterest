// filterest_paths.go
// Resolves operator-provided project, key, runtime, maintainer, and operations homes from one locator.
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
	ProjectsHome              string
	KeysHome                  string
	RuntimeDataHome           string
	MaintainerToolsHome       string
	OperationsHome            string
	ProjectsHomeConfigured    bool
	KeysHomeConfigured        bool
	RuntimeDataHomeConfigured bool
	MaintainerToolsConfigured bool
	OperationsHomeConfigured  bool
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
		"schema_version":        true,
		"projects_home":         true,
		"keys_home":             true,
		"runtime_data_home":     true,
		"maintainer_tools_home": true,
		"operations_home":       true,
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
	defaultRuntimeDataHome := filepath.Join(normalizedRoot, "filterest_runtime_data")
	defaultMaintainerToolsHome := filepath.Join(normalizedRoot, "filterest_maintainer_tools")
	defaultOperationsHome := filepath.Join(normalizedRoot, "filterest_operations")
	if privateSource {
		defaultProjectsHome = filepath.Join(normalizedRoot, "..", "filterest-projects")
		defaultKeysHome = filepath.Join(normalizedRoot, "..", "filterest_keys")
		defaultRuntimeDataHome = filepath.Join(normalizedRoot, "..", "filterest-runtime-data")
		defaultMaintainerToolsHome = filepath.Join(normalizedRoot, "..", "filterest-maintainer-tools")
		defaultOperationsHome = filepath.Join(normalizedRoot, "..", "filterest-operations")
	}
	values := map[string]string{
		"projects_home":         defaultProjectsHome,
		"keys_home":             defaultKeysHome,
		"runtime_data_home":     defaultRuntimeDataHome,
		"maintainer_tools_home": defaultMaintainerToolsHome,
		"operations_home":       defaultOperationsHome,
	}
	configured := map[string]bool{}
	for _, configName := range []string{filterestPathsFile, filterestLocalPathsFile} {
		fileValues, err := readFilterestPathsFile(filepath.Join(normalizedRoot, configName))
		if err != nil {
			return filterestHomes{}, err
		}
		for _, key := range []string{
			"projects_home",
			"keys_home",
			"runtime_data_home",
			"maintainer_tools_home",
			"operations_home",
		} {
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
	if value := strings.TrimSpace(os.Getenv("FILTEREST_RUNTIME_DATA_HOME")); value != "" && strings.TrimSpace(os.Getenv("FILTEREST_RUNTIME_DATA_HOME_CONFIGURED")) != "0" {
		values["runtime_data_home"] = value
		configured["runtime_data_home"] = true
	}
	if value := strings.TrimSpace(os.Getenv("FILTEREST_MAINTAINER_TOOLS_HOME")); value != "" && strings.TrimSpace(os.Getenv("FILTEREST_MAINTAINER_TOOLS_HOME_CONFIGURED")) != "0" {
		values["maintainer_tools_home"] = value
		configured["maintainer_tools_home"] = true
	}
	if value := strings.TrimSpace(os.Getenv("FILTEREST_OPERATIONS_HOME")); value != "" && strings.TrimSpace(os.Getenv("FILTEREST_OPERATIONS_HOME_CONFIGURED")) != "0" {
		values["operations_home"] = value
		configured["operations_home"] = true
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
	runtimeDataHome, err := resolveFilterestHome(normalizedRoot, values["runtime_data_home"], "runtime_data_home")
	if err != nil {
		return filterestHomes{}, err
	}
	maintainerToolsHome, err := resolveFilterestHome(normalizedRoot, values["maintainer_tools_home"], "maintainer_tools_home")
	if err != nil {
		return filterestHomes{}, err
	}
	operationsHome, err := resolveFilterestHome(normalizedRoot, values["operations_home"], "operations_home")
	if err != nil {
		return filterestHomes{}, err
	}
	homes := []struct {
		name string
		path string
	}{
		{name: "projects_home", path: projectsHome},
		{name: "keys_home", path: keysHome},
		{name: "runtime_data_home", path: runtimeDataHome},
		{name: "maintainer_tools_home", path: maintainerToolsHome},
		{name: "operations_home", path: operationsHome},
	}
	for first := 0; first < len(homes); first++ {
		for second := first + 1; second < len(homes); second++ {
			if filterestHomesOverlap(homes[first].path, homes[second].path) {
				return filterestHomes{}, fmt.Errorf(
					"%s and %s must not be equal or nested",
					homes[first].name,
					homes[second].name,
				)
			}
		}
	}
	return filterestHomes{
		ProjectsHome:              projectsHome,
		KeysHome:                  keysHome,
		RuntimeDataHome:           runtimeDataHome,
		MaintainerToolsHome:       maintainerToolsHome,
		OperationsHome:            operationsHome,
		ProjectsHomeConfigured:    configured["projects_home"],
		KeysHomeConfigured:        configured["keys_home"],
		RuntimeDataHomeConfigured: configured["runtime_data_home"],
		MaintainerToolsConfigured: configured["maintainer_tools_home"],
		OperationsHomeConfigured:  configured["operations_home"],
	}, nil
}
