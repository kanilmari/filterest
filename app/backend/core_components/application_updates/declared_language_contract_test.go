// declared_language_contract_test.go
// Checks actual refusal JSON against the producer's finite language declaration.
// Connects every admission refusal caller and the browser's shared key contract.
// Runs in memory, without PostgreSQL, an HTTP listener or update execution.
package application_updates

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"easelect/backend/core_components/lang_key_naming"
)

func TestDeclaredApplicationUpdateRefusalsMatchWireContract(t *testing.T) {
	raw, err := os.ReadFile("admission_handler.go")
	if err != nil {
		t.Fatal(err)
	}
	var declaration lang_key_naming.Declaration
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(line, lang_key_naming.DeclarationMarker) {
			declaration, err = lang_key_naming.ParseDeclaration("admission_handler.go", line)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	if len(declaration.Values) == 0 {
		t.Fatal("producer declaration missing")
	}
	declared := map[string]bool{}
	for _, code := range declaration.Values {
		response := httptest.NewRecorder()
		respondFailure(response, refuse(code, 409))
		var body ErrorResponse
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if response.Code != 409 || body.ErrorLangKey != declaration.Prefix+code || body.Code != code {
			t.Fatal(response.Code, body)
		}
		declared[code] = true
	}
	// Every live literal caller must belong to the allowed family, including
	// newly introduced refusals. Tests cannot supply their own evidence.
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		tree, err := parser.ParseFile(token.NewFileSet(), file, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(tree, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok || len(call.Args) == 0 {
				return true
			}
			function, ok := call.Fun.(*ast.Ident)
			if !ok || function.Name != "refuse" {
				return true
			}
			literal, ok := call.Args[0].(*ast.BasicLit)
			if !ok {
				return true
			}
			code, err := strconv.Unquote(literal.Value)
			if err == nil && !declared[code] {
				t.Errorf("%s produces undeclared refusal %q", file, code)
			}
			return true
		})
	}
}
