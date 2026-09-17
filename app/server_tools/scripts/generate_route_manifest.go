// generate_route_manifest.go
// Generates the checked-in route manifest and route handler docs from the backend runtime registry.
// Bridges router registration, pipeline profiles, and future frontend client generation.
// Exists to replace old router AST assumptions with a reproducible runtime inventory.
// Its location makes the canonical Filterest source tree the generator's project root.
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

	handlerNames := make([]string, 0, len(manifest.Routes))
	for _, route := range manifest.Routes {
		handlerNames = append(handlerNames, route.HandlerName)
	}
	docs, err := router.ExtractRouteHandlerDocs(filepath.Join(projectRoot, "backend"), handlerNames)
	if err != nil {
		return fmt.Errorf("extract route handler docs: %w", err)
	}
	docsOutput, err := router.MarshalRouteHandlerDocs(docs)
	if err != nil {
		return fmt.Errorf("marshal route handler docs: %w", err)
	}

	outputs := []struct {
		path    string
		content []byte
	}{
		{filepath.Join(projectRoot, "frontend", "generated", "backend_route_manifest.json"), output},
		{filepath.Join(projectRoot, "backend", "core_components", "router", "generated", "route_handler_docs.json"), docsOutput},
	}
	for _, generated := range outputs {
		if *checkOnly {
			current, err := os.ReadFile(generated.path)
			if err != nil {
				return fmt.Errorf("read current generated file: %w", err)
			}
			if !bytes.Equal(current, generated.content) {
				return fmt.Errorf("generated route data drift detected in %s", generated.path)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(generated.path), 0o755); err != nil {
			return fmt.Errorf("create generated directory: %w", err)
		}
		if err := os.WriteFile(generated.path, generated.content, 0o644); err != nil {
			return fmt.Errorf("write generated file: %w", err)
		}
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
