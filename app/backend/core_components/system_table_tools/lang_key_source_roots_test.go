// lang_key_source_roots_test.go
// Verifies language-source discovery in standalone and outer transition layouts.
// Bridges the canonical Filterest subtree with disjoint private Easelect sources.
// Exists so moving frontend/backend cannot silently orphan active language keys.
package system_table_tools

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestCodebaseSourceRootsUsesStandaloneRoot(t *testing.T) {
	root := t.TempDir()
	if got := codebaseSourceRoots(root); !reflect.DeepEqual(got, []string{root}) {
		t.Fatalf("codebaseSourceRoots() = %v, want standalone root", got)
	}
}

func TestCodebaseSourceRootsIncludesCanonicalAndPrivateRoots(t *testing.T) {
	root := t.TempDir()
	canonicalRoot := filepath.Join(root, "filterest")
	if err := os.MkdirAll(canonicalRoot, 0o755); err != nil {
		t.Fatalf("os.MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(canonicalRoot, "go.mod"), []byte("module easelect\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile() error = %v", err)
	}

	want := []string{canonicalRoot, root}
	if got := codebaseSourceRoots(root); !reflect.DeepEqual(got, want) {
		t.Fatalf("codebaseSourceRoots() = %v, want %v", got, want)
	}
}
