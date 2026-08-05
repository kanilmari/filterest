// generate_route_manifest.go
// Generates a checked-in JSON route manifest from the backend runtime registry.
// Bridges router registration, pipeline profiles, and future frontend client generation.
// Exists to replace old router AST assumptions with a reproducible runtime inventory.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"easelect/backend/core_components/router"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	checkOnly := flag.Bool("check", false, "exit non-zero if the checked-in route manifest differs from generated output")
	flag.Parse()

	projectRoot, err := projectRoot()
	if err != nil {
		return err
	}

	manifest, err := router.BuildDefaultRouteManifest()
	if err != nil {
		return fmt.Errorf("build route manifest: %w", err)
	}

	output, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal route manifest: %w", err)
	}
	output = append(output, '\n')

	outputPath := filepath.Join(projectRoot, "frontend", "generated", "backend_route_manifest.json")
	if *checkOnly {
		current, err := os.ReadFile(outputPath)
		if err != nil {
			return fmt.Errorf("read current route manifest: %w", err)
		}
		if !bytes.Equal(current, output) {
			return fmt.Errorf("route manifest drift detected in %s", outputPath)
		}
		return nil
	}

	if err := os.WriteFile(outputPath, output, 0o644); err != nil {
		return fmt.Errorf("write route manifest: %w", err)
	}
	return nil
}

func projectRoot() (string, error) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("resolve current file for project root")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..")), nil
}
