// fixture.go
// Materializes the same canary used by Python discovery tests in temporary trees.
// Connects language, permission, session, name and route guards to one test-only input.
// Keeps app/components empty until the guarded component contract ships in B1b.
package componentfixture

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// Write returns a temporary repository root. Go's test runner removes it even on failure.
func Write(t *testing.T) string {
	t.Helper()
	_, current, _, _ := runtime.Caller(0)
	data, err := os.ReadFile(filepath.Join(filepath.Dir(current), "..", "fixtures", "component_canary.json"))
	if err != nil {
		t.Fatal(err)
	}
	var files map[string]string
	if err := json.Unmarshal(data, &files); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	for path, content := range files {
		target := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, directory := range []string{"backend", "frontend"} {
		if err := os.MkdirAll(filepath.Join(root, "app", directory), 0700); err != nil {
			t.Fatal(err)
		}
	}
	return root
}
