// multipart_identity_test.go
// Inventories multipart parsers and their route permission scope.
// Connects source discovery to the query-only dataset identity contract.
// Makes new multipart routes require an explicit identity-boundary review.
package router

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

func TestEveryDatasetMultipartRouteUsesQueryIdentity(t *testing.T) {
	// Tableless administrator uploads intentionally keep their own payloads;
	// the CSRF stage parses forms but never selects an authorized dataset.
	parsers := map[string]string{
		"dtt_1_row_create.AddRowMultipartHandler":           "dtt_1_row_create.AddRowMultipartHandlerWrapper",
		"system_table_tools.SaveDatasetHeaderConfigHandler": "system_table_tools.SaveDatasetHeaderConfigHandler",
		"system_table_tools.FrontPageBackgroundHandler":     "system_table_tools.FrontPageBackgroundHandler",
		"dtt_1_row_read.ChatAttachmentHandler":              "dtt_1_row_read.ChatAttachmentHandler",
		"csrf_check.WithCSRFCheck":                          "",
	}
	seen := map[string]bool{}
	err := filepath.WalkDir("../..", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := strings.ToLower(entry.Name())
		// Match the worker's protected-file exclusions before opening any file.
		protected := name == "keys" || name == ".ssh" || name == ".codex" || strings.HasPrefix(name, ".env")
		for _, fragment := range []string{"secret", "token", "password", "credential"} {
			protected = protected || strings.Contains(name, fragment)
		}
		for _, suffix := range []string{".key", ".pem", ".env"} {
			protected = protected || strings.HasSuffix(name, suffix)
		}
		if protected {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			multipart := false
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				selector, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				if selector.Sel.Name == "ParseMultipartForm" || selector.Sel.Name == "MultipartReader" || selector.Sel.Name == "FormFile" {
					multipart = true
				}
				return true
			})
			if !multipart {
				continue
			}
			key := file.Name.Name + "." + fn.Name.Name
			handler, known := parsers[key]
			if !known {
				t.Errorf("multipart parser needs identity review: %s (%s)", key, path)
				continue
			}
			seen[key] = true
			if handler != "" && defaultSpecificTableRelated(handler) && handler != "dtt_1_row_create.AddRowMultipartHandlerWrapper" {
				t.Errorf("multipart route lacks query-only identity coverage: %s", handler)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for key := range parsers {
		if !seen[key] {
			t.Errorf("stale multipart inventory: %s", key)
		}
	}
}
