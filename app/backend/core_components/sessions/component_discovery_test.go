// component_discovery_test.go
// Proves component Go receives the existing session and retired-name guards.
// Connects the shared temporary canary to the real application source walker.
// Prevents moving handlers into components from bypassing sign-in policy checks.
package e_sessions

import (
	"go/ast"
	"go/token"
	"os"
	"path/filepath"
	"testing"

	"easelect/testing/componentfixture"
)

func TestComponentCanarySessionAndNameGuards(t *testing.T) {
	root := componentfixture.Write(t)
	appRoot := filepath.Join(root, "app")
	for _, check := range []func(*token.FileSet, *ast.File) []string{sessionStoreBypasses, sessionNameKeyUses} {
		found, scanned := scanApplicationSources(t, appRoot, nil, check)
		if len(found) != 0 || scanned != 1 {
			t.Fatalf("correct canary: findings=%v files=%d", found, scanned)
		}
	}
	path := filepath.Join(appRoot, "components", "canary", "backend", "broken.go")
	source := `package canary
 import "net/http"
 func broken(w http.ResponseWriter, r *http.Request) {
  session, _ := store.Get(r, e_sessions.SessionName)
  session.Values["username"] = "private"
 }`
	if err := os.WriteFile(path, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	for _, check := range []func(*token.FileSet, *ast.File) []string{sessionStoreBypasses, sessionNameKeyUses} {
		found, _ := scanApplicationSources(t, appRoot, nil, check)
		if len(found) != 1 {
			t.Fatalf("broken canary escaped guard: %v", found)
		}
	}
}
