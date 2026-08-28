// Verifies discovery of the canonical AI cell-translation prompt in both source layouts.
// Bridges standalone Filterest roots and the outer Easelect transition checkout.
// Exists so moving the prompt into filterest/ cannot break either supported runtime.
// The fixtures deliberately prove both lookup orders without duplicating product content.
package lang

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadTranslationSystemMessageFromStandaloneRoot(t *testing.T) {
	root := t.TempDir()
	promptPath := filepath.Join(root, translationSystemMessageRelativePath)
	writeTranslationSystemMessageFixture(t, promptPath, "standalone prompt")
	t.Chdir(root)

	content, err := readTranslationSystemMessage()
	if err != nil {
		t.Fatalf("readTranslationSystemMessage() error = %v", err)
	}
	if got := string(content); got != "standalone prompt" {
		t.Fatalf("readTranslationSystemMessage() = %q, want %q", got, "standalone prompt")
	}
}

func TestReadTranslationSystemMessageFromOuterEaselectRoot(t *testing.T) {
	root := t.TempDir()
	promptPath := filepath.Join(root, "filterest", translationSystemMessageRelativePath)
	writeTranslationSystemMessageFixture(t, promptPath, "canonical prompt")
	t.Chdir(root)

	content, err := readTranslationSystemMessage()
	if err != nil {
		t.Fatalf("readTranslationSystemMessage() error = %v", err)
	}
	if got := string(content); got != "canonical prompt" {
		t.Fatalf("readTranslationSystemMessage() = %q, want %q", got, "canonical prompt")
	}
}

func writeTranslationSystemMessageFixture(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("os.MkdirAll(%q): %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("os.WriteFile(%q): %v", path, err)
	}
}
