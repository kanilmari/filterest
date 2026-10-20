// main.go
// Exports the K388 article_presentation_after report from an explicitly selected database.
// Connects the command to the shared enforced read-only snapshot exporter.
// Never loads installation settings, starts Filterest or applies migrations.
package main

import (
	"easelect/backend/tools/internal/articleexport"
	"os"
)

func main() { os.Exit(articleexport.Run(os.Args[1:], os.Stdout, os.Stderr, true)) }
