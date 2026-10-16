// component_layout_test.go
// Verifies startup resolves components beside the canonical frontend directory.
// Connects relocated/symlinked frontend roots with absent and invalid component trees.
// Keeps old compositions usable while refusing a sibling redirected outside the tree.
package application_runtime

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFrontendComponentLayoutAllowsMissingTreeWithoutCreatingIt(t *testing.T) {
	root := t.TempDir()
	frontend := filepath.Join(root, "frontend")
	if err := os.Mkdir(frontend, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(frontend, "index.html"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if got, err := resolveFrontendDirectory(frontend, "", ""); err != nil || got != frontend {
		t.Fatalf("startup frontend = %q, %v", got, err)
	}
	if _, err := os.Lstat(filepath.Join(root, "components")); !os.IsNotExist(err) {
		t.Fatalf("startup created components: %v", err)
	}
	if err := os.Mkdir(filepath.Join(root, "components"), 0700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(t.TempDir(), "frontend")
	if err := os.Symlink(frontend, link); err != nil {
		t.Fatal(err)
	}
	if got, err := resolveFrontendDirectory(link, "", ""); err != nil || got != frontend {
		t.Fatalf("symlinked frontend = %q, %v", got, err)
	}
}

func TestFrontendComponentLayoutRejectsNonSiblingDirectory(t *testing.T) {
	for _, symlink := range []bool{false, true} {
		root := t.TempDir()
		frontend := filepath.Join(root, "frontend")
		if err := os.Mkdir(frontend, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(frontend, "index.html"), []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
		var err error
		if symlink {
			err = os.Symlink(t.TempDir(), filepath.Join(root, "components"))
		} else {
			err = os.WriteFile(filepath.Join(root, "components"), nil, 0600)
		}
		if err != nil {
			t.Fatal(err)
		}
		if _, err := resolveFrontendDirectory(frontend, "", ""); err == nil {
			t.Fatalf("startup accepted invalid components sibling (symlink=%v)", symlink)
		}
	}
}
