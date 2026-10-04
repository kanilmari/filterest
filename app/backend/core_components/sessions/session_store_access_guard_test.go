// session_store_access_guard_test.go
// Keeps every backend package loading and writing the sign-in session through Load and Save, and
// keeps names out of the session.
// Between the backend source tree and the one place the session's cookie is read and written.
// Exists so a new handler cannot quietly go back to its own store.Get or session.Save, which
// would again need every rule about the session repeated at that spot, or put a name back in it.
package e_sessions

import (
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// sessionStoreBypasses lists the calls in one source file that read or write the
// sign-in session without Load or Save:
//   - a Save whose first two arguments are the enclosing function's
//     *http.Request and http.ResponseWriter, which is the shape of Gorilla's
//     Session.Save, its package-level Save and a store's Save(r, w, session); and
//   - a two-argument Get or New whose second argument is SessionName, which is a
//     store reading the sign-in cookie.
//
// The shape is matched rather than variable names, so a handler whose parameters
// are called request and response_writer is caught as well.
func sessionStoreBypasses(fileSet *token.FileSet, file *ast.File) []string {
	var found []string
	var functionTypes []*ast.FuncType

	parameterType := func(name string) string {
		for index := len(functionTypes) - 1; index >= 0; index-- {
			for _, field := range functionTypes[index].Params.List {
				for _, fieldName := range field.Names {
					if fieldName.Name == name {
						var text strings.Builder
						_ = printer.Fprint(&text, fileSet, field.Type)
						return text.String()
					}
				}
			}
		}
		return ""
	}
	argumentType := func(argument ast.Expr) string {
		if identifier, ok := argument.(*ast.Ident); ok {
			return parameterType(identifier.Name)
		}
		return ""
	}
	isSessionName := func(argument ast.Expr) bool {
		switch value := argument.(type) {
		case *ast.Ident:
			return value.Name == "SessionName"
		case *ast.SelectorExpr:
			return value.Sel.Name == "SessionName"
		}
		return false
	}

	var visit func(node ast.Node) bool
	visit = func(node ast.Node) bool {
		switch value := node.(type) {
		case *ast.FuncDecl:
			if value.Body == nil {
				return false
			}
			functionTypes = append(functionTypes, value.Type)
			ast.Inspect(value.Body, visit)
			functionTypes = functionTypes[:len(functionTypes)-1]
			return false
		case *ast.FuncLit:
			functionTypes = append(functionTypes, value.Type)
			ast.Inspect(value.Body, visit)
			functionTypes = functionTypes[:len(functionTypes)-1]
			return false
		case *ast.CallExpr:
			selector, ok := value.Fun.(*ast.SelectorExpr)
			if !ok || len(value.Args) < 2 {
				return true
			}
			position := fileSet.Position(value.Pos())
			switch selector.Sel.Name {
			case "Save":
				if len(value.Args) <= 3 && argumentType(value.Args[0]) == "*http.Request" &&
					argumentType(value.Args[1]) == "http.ResponseWriter" {
					found = append(found, position.String()+": writes the session without e_sessions.Save")
				}
			case "Get", "New":
				if len(value.Args) == 2 && isSessionName(value.Args[1]) {
					found = append(found, position.String()+": loads the session without e_sessions.Load")
				}
			}
		}
		return true
	}
	ast.Inspect(file, visit)
	return found
}

// TestSessionStoreBypassDetectorFindsBothShapes keeps the guard from passing
// because it stopped recognising anything.
func TestSessionStoreBypassDetectorFindsBothShapes(t *testing.T) {
	source := `package example

import "net/http"

func handler(response_writer http.ResponseWriter, request *http.Request) {
	session, _ := store.Get(request, e_sessions.SessionName)
	_ = session.Save(request, response_writer)
	_ = store.Save(request, response_writer, session)
	_ = imaging.Save(picture, path)
	_ = e_sessions.Save(response_writer, request, session)
}
`
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, "example.go", source, 0)
	if err != nil {
		t.Fatalf("parse example: %v", err)
	}
	found := sessionStoreBypasses(fileSet, file)
	if len(found) != 3 {
		t.Fatalf("expected the direct load and both direct saves, found %d: %v", len(found), found)
	}
}

// sessionNameKeyUses lists every read or write of a retired name key through a
// session's Values, such as session.Values["username"]. The session carries no
// name (WL132): a name is read by the account's id where it is shown or logged.
func sessionNameKeyUses(fileSet *token.FileSet, file *ast.File) []string {
	retired := map[string]bool{}
	for _, key := range RetiredSessionKeys {
		retired[key] = true
	}
	var found []string
	ast.Inspect(file, func(node ast.Node) bool {
		index, ok := node.(*ast.IndexExpr)
		if !ok {
			return true
		}
		selector, ok := index.X.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "Values" {
			return true
		}
		literal, ok := index.Index.(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return true
		}
		if key, err := strconv.Unquote(literal.Value); err == nil && retired[key] {
			found = append(found, fileSet.Position(index.Pos()).String()+": uses the session's retired key "+literal.Value)
		}
		return true
	})
	return found
}

// scanBackendSources parses every non-test Go file of the backend, skipping the
// directories skip names, and collects what check reports.
func scanBackendSources(t *testing.T, skip map[string]bool, check func(*token.FileSet, *ast.File) []string) []string {
	t.Helper()
	backendRoot, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatalf("backend root: %v", err)
	}
	fileSet := token.NewFileSet()
	scanned := 0
	var found []string
	walkErr := filepath.WalkDir(backendRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if skip[path] {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		contents, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		file, parseErr := parser.ParseFile(fileSet, path, contents, 0)
		if parseErr != nil {
			return parseErr
		}
		scanned++
		found = append(found, check(fileSet, file)...)
		return nil
	})
	if walkErr != nil {
		t.Fatalf("scan backend: %v", walkErr)
	}
	if scanned < 100 {
		t.Fatalf("scanned only %d files under %s; the backend root is wrong", scanned, backendRoot)
	}
	return found
}

// TestBackendLoadsAndWritesTheSessionOnlyThroughLoadAndSave scans every
// non-test Go file of the backend outside this package.
func TestBackendLoadsAndWritesTheSessionOnlyThroughLoadAndSave(t *testing.T) {
	ownDirectory, err := filepath.Abs(".")
	if err != nil {
		t.Fatalf("package directory: %v", err)
	}
	found := scanBackendSources(t, map[string]bool{ownDirectory: true}, sessionStoreBypasses)
	if len(found) > 0 {
		t.Fatalf("load and write the sign-in session through e_sessions.Load and e_sessions.Save:\n%s",
			strings.Join(found, "\n"))
	}
}

// TestSessionNameKeyDetectorFindsReadsAndWrites keeps the name guard from
// passing because it stopped recognising anything.
func TestSessionNameKeyDetectorFindsReadsAndWrites(t *testing.T) {
	source := `package example

func handler() {
	session.Values["username"] = name
	pending, _ := session.Values["otp_pending_username"].(string)
	id, _ := session.Values["user_id"].(int)
	delete(session.Values, "username")
}
`
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, "example.go", source, 0)
	if err != nil {
		t.Fatalf("parse example: %v", err)
	}
	if found := sessionNameKeyUses(fileSet, file); len(found) != 2 {
		t.Fatalf("expected the write and the read of retired keys, found %d: %v", len(found), found)
	}
}

// TestNoBackendCodeReadsOrWritesANameInTheSession scans every non-test Go file
// of the backend, this package included.
func TestNoBackendCodeReadsOrWritesANameInTheSession(t *testing.T) {
	found := scanBackendSources(t, nil, sessionNameKeyUses)
	if len(found) > 0 {
		t.Fatalf("read the name by the account's id (backend.UserDisplayName) instead of the session:\n%s",
			strings.Join(found, "\n"))
	}
}
