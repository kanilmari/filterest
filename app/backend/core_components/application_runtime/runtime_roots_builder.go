// runtime_roots_builder.go
// Resolves normalized installation and application roots for Filterest startup.
// Bridges explicit launcher hints, command-line arguments, process environment, and legacy layouts.
// Exists so the nested immutable app layout can be introduced without cwd-dependent path guessing.
package application_runtime

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const filterestRootEnvironmentVariable = "FILTEREST_ROOT"

type runtimeRoots struct {
	installationRoot         string
	applicationRoot          string
	installationRootExplicit bool
}

type runtimeRootSources struct {
	arguments        []string
	environmentRoot  string
	workingDirectory string
}

// resolveRuntimeRoots resolves the process-backed root contract used by startup.
// The explicit installation hint is intended for the executable's Options value;
// the explicit application hint allows a composition to select immutable source directly.
func resolveRuntimeRoots(
	explicitInstallationRoot string,
	explicitApplicationRoot string,
) (runtimeRoots, error) {
	workingDirectory, err := os.Getwd()
	if err != nil {
		return runtimeRoots{}, fmt.Errorf("resolve Filterest working directory: %w", err)
	}

	return resolveRuntimeRootsFromSources(
		explicitInstallationRoot,
		explicitApplicationRoot,
		runtimeRootSources{
			arguments:        os.Args[1:],
			environmentRoot:  os.Getenv(filterestRootEnvironmentVariable),
			workingDirectory: workingDirectory,
		},
	)
}

func resolveRuntimeRootsFromSources(
	explicitInstallationRoot string,
	explicitApplicationRoot string,
	sources runtimeRootSources,
) (runtimeRoots, error) {
	workingDirectory, err := normalizeRuntimeRoot(".", sources.workingDirectory)
	if err != nil {
		return runtimeRoots{}, fmt.Errorf("normalize Filterest working directory: %w", err)
	}

	installationRootValue := explicitInstallationRoot
	installationRootExplicit := explicitInstallationRoot != ""
	if installationRootValue == "" {
		argumentRoot, hasArgumentRoot, err := parseRuntimeRootArgument(sources.arguments)
		if err != nil {
			return runtimeRoots{}, err
		}
		if hasArgumentRoot {
			installationRootValue = argumentRoot
			installationRootExplicit = true
		}
	}
	if installationRootValue == "" {
		installationRootValue = sources.environmentRoot
		installationRootExplicit = sources.environmentRoot != ""
	}
	if installationRootValue == "" {
		installationRootValue = workingDirectory
	}

	installationRoot, err := normalizeRuntimeRoot(installationRootValue, workingDirectory)
	if err != nil {
		return runtimeRoots{}, fmt.Errorf("normalize Filterest installation root: %w", err)
	}

	if explicitApplicationRoot != "" {
		// Executable-owned relative app hints are anchored to the resolved
		// installation, never to whichever directory launched the process.
		applicationRoot, err := normalizeRuntimeRoot(
			explicitApplicationRoot,
			installationRoot,
		)
		if err != nil {
			return runtimeRoots{}, fmt.Errorf("normalize Filterest application root: %w", err)
		}
		return runtimeRoots{
			installationRoot:         installationRoot,
			applicationRoot:          applicationRoot,
			installationRootExplicit: installationRootExplicit,
		}, nil
	}

	nestedApplicationRoot := filepath.Join(installationRoot, "app")
	if isRecognizableApplicationRoot(nestedApplicationRoot) {
		return runtimeRoots{
			installationRoot:         installationRoot,
			applicationRoot:          nestedApplicationRoot,
			installationRootExplicit: installationRootExplicit,
		}, nil
	}

	return runtimeRoots{
		installationRoot:         installationRoot,
		applicationRoot:          installationRoot,
		installationRootExplicit: installationRootExplicit,
	}, nil
}

func normalizeRuntimeRoot(value string, workingDirectory string) (string, error) {
	if value == "" {
		return "", fmt.Errorf("root path must not be empty")
	}

	candidate := value
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(workingDirectory, candidate)
	}
	absolutePath, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	return filepath.Clean(absolutePath), nil
}

func parseRuntimeRootArgument(arguments []string) (string, bool, error) {
	rootValue := ""
	rootFound := false

	for index := 0; index < len(arguments); index++ {
		argument := arguments[index]
		if argument == "--" {
			break
		}

		value := ""
		found := false
		switch {
		case argument == "--root":
			if index+1 >= len(arguments) || arguments[index+1] == "" {
				return "", false, fmt.Errorf("--root requires a non-empty path")
			}
			index++
			value = arguments[index]
			found = true
		case strings.HasPrefix(argument, "--root="):
			value = strings.TrimPrefix(argument, "--root=")
			if value == "" {
				return "", false, fmt.Errorf("--root requires a non-empty path")
			}
			found = true
		}

		if !found {
			continue
		}
		if rootFound {
			return "", false, fmt.Errorf("--root may be provided only once")
		}
		rootValue = value
		rootFound = true
	}

	return rootValue, rootFound, nil
}

func isRecognizableApplicationRoot(candidate string) bool {
	for _, marker := range []string{"go.mod", "VERSION_APP"} {
		info, err := os.Stat(filepath.Join(candidate, marker))
		if err != nil || !info.Mode().IsRegular() {
			return false
		}
	}
	return true
}
