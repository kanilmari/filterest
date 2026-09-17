// route_handler_docs.go
// Extracts Go doc comments for registered route handlers and embeds the checked-in result.
// Bridges handler source comments and the site assistant API catalog served at runtime.
// Exists so the catalog describes each route from the code itself; a drift test keeps it current.
package router

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
)

// routeHandlerDocMaxRunes bounds one summary so the catalog stays compact
// enough to hand to an assistant as prompt context.
const routeHandlerDocMaxRunes = 600

//go:embed generated/route_handler_docs.json
var embeddedRouteHandlerDocsJSON []byte

// RouteHandlerDocs maps "package.Function" handler names to their doc comment.
type RouteHandlerDocs map[string]string

// EmbeddedRouteHandlerDocs returns the docs generated at the last
// `go run ./server_tools/scripts/generate_route_manifest.go`.
func EmbeddedRouteHandlerDocs() (RouteHandlerDocs, error) {
	docs := RouteHandlerDocs{}
	if err := json.Unmarshal(embeddedRouteHandlerDocsJSON, &docs); err != nil {
		return nil, fmt.Errorf("decode embedded route handler docs: %w", err)
	}
	return docs, nil
}

// ExtractRouteHandlerDocs parses non-test Go files below backendRoot and
// returns the doc comment of every requested handler. Handlers without a
// comment map to an empty string so the catalog can show the gap. Method
// handlers (with receivers) are not route handler names and are ignored.
func ExtractRouteHandlerDocs(backendRoot string, handlerNames []string) (RouteHandlerDocs, error) {
	wanted := make(map[string]bool, len(handlerNames))
	for _, name := range handlerNames {
		wanted[name] = true
	}

	found := RouteHandlerDocs{}
	walkErr := filepath.WalkDir(backendRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if name := entry.Name(); path != backendRoot && (strings.HasPrefix(name, ".") || name == "testdata") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, parseErr := parser.ParseFile(token.NewFileSet(), path, nil, parser.ParseComments)
		if parseErr != nil {
			return fmt.Errorf("parse %s: %w", path, parseErr)
		}
		for _, declaration := range file.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Recv != nil {
				continue
			}
			name := file.Name.Name + "." + function.Name.Name
			if !wanted[name] {
				continue
			}
			if existing, duplicate := found[name]; duplicate && existing != summarizeRouteHandlerDoc(function.Doc) {
				return fmt.Errorf("handler name %s is declared in more than one package with that name", name)
			}
			found[name] = summarizeRouteHandlerDoc(function.Doc)
		}
		return nil
	})
	if walkErr != nil {
		return nil, walkErr
	}

	for name := range wanted {
		if _, ok := found[name]; !ok {
			found[name] = ""
		}
	}
	return found, nil
}

// MarshalRouteHandlerDocs renders docs as deterministic, reviewable JSON.
func MarshalRouteHandlerDocs(docs RouteHandlerDocs) ([]byte, error) {
	names := make([]string, 0, len(docs))
	for name := range docs {
		names = append(names, name)
	}
	sort.Strings(names)
	ordered := make([]struct {
		Handler string `json:"handler"`
		Doc     string `json:"doc"`
	}, 0, len(names))
	for _, name := range names {
		ordered = append(ordered, struct {
			Handler string `json:"handler"`
			Doc     string `json:"doc"`
		}{name, docs[name]})
	}
	// Keep the map shape on disk for simple decoding; the ordered slice only fixes key order.
	var builder strings.Builder
	builder.WriteString("{\n")
	for index, item := range ordered {
		key, _ := json.Marshal(item.Handler)
		value, _ := json.Marshal(item.Doc)
		builder.WriteString("  ")
		builder.Write(key)
		builder.WriteString(": ")
		builder.Write(value)
		if index < len(ordered)-1 {
			builder.WriteString(",")
		}
		builder.WriteString("\n")
	}
	builder.WriteString("}\n")
	return []byte(builder.String()), nil
}

func summarizeRouteHandlerDoc(group *ast.CommentGroup) string {
	if group == nil {
		return ""
	}
	text := strings.Join(strings.Fields(group.Text()), " ")
	runes := []rune(text)
	if len(runes) > routeHandlerDocMaxRunes {
		text = strings.TrimSpace(string(runes[:routeHandlerDocMaxRunes])) + "…"
	}
	return text
}
