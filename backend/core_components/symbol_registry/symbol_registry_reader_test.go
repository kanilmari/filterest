// symbol_registry_reader_test.go
// Verifies filesystem allowlisting, SVG safety checks, and stable missing-key fallback.
// Bridges temporary SVG fixtures with the production registry reader contract.
// Exists to prevent raw HTML, scripts, or arbitrary paths from becoming metadata symbols.
package symbol_registry

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestListIncludesOnlySafeNamedSVGFiles(t *testing.T) {
	directory := t.TempDir()
	writeTestSymbol(t, directory, "table.svg", `<svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg>`)
	writeTestSymbol(t, directory, "map-pin.svg", `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>`)
	writeTestSymbol(t, directory, "Unsafe Key.svg", `<svg><path d="M0 0"/></svg>`)
	writeTestSymbol(t, directory, "script.svg", `<svg><script>alert(1)</script></svg>`)
	writeTestSymbol(t, directory, "external.svg", `<svg><image href="https://example.invalid/icon.png"/></svg>`)
	if err := os.WriteFile(filepath.Join(directory, "notes.txt"), []byte("not an icon"), 0o600); err != nil {
		t.Fatal(err)
	}

	ConfigureDirectory(directory)
	symbols, err := List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(symbols) != 2 || symbols[0].Key != "map-pin" || symbols[1].Key != "table" {
		t.Fatalf("List() = %#v, want map-pin and table only", symbols)
	}
}

func TestReadUsesSafeTableFallbackForUnknownKeys(t *testing.T) {
	directory := t.TempDir()
	writeTestSymbol(t, directory, "table.svg", `<svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg>`)
	ConfigureDirectory(directory)

	content, key, err := Read("../../secret")
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	if key != "table" || len(content) == 0 {
		t.Fatalf("Read() = key %q, %d bytes; want safe table fallback", key, len(content))
	}
}

func TestContainsRejectsUnsafeSVG(t *testing.T) {
	directory := t.TempDir()
	writeTestSymbol(t, directory, "table.svg", `<svg><path d="M0 0"/></svg>`)
	writeTestSymbol(t, directory, "bad.svg", `<svg onload="alert(1)"><path d="M0 0"/></svg>`)
	writeTestSymbol(t, directory, "instruction.svg", `<?xml-stylesheet href="https://bad.example/x.css"?><svg><path d="M0 0"/></svg>`)
	ConfigureDirectory(directory)

	if Contains("bad") {
		t.Fatal("Contains(bad) = true, want unsafe SVG rejected")
	}
	if !Contains("table") {
		t.Fatal("Contains(table) = false, want safe SVG accepted")
	}
	if Contains("instruction") {
		t.Fatal("Contains(instruction) = true, want processing instruction rejected")
	}
}

func TestContainsRejectsSymbolicLinks(t *testing.T) {
	directory := t.TempDir()
	targetDirectory := t.TempDir()
	writeTestSymbol(t, directory, "table.svg", `<svg><path d="M0 0"/></svg>`)
	writeTestSymbol(t, targetDirectory, "outside.svg", `<svg><path d="M1 1"/></svg>`)
	if err := os.Symlink(
		filepath.Join(targetDirectory, "outside.svg"),
		filepath.Join(directory, "linked.svg"),
	); err != nil {
		t.Fatal(err)
	}
	ConfigureDirectory(directory)

	if Contains("linked") {
		t.Fatal("Contains(linked) = true, want symbolic link rejected")
	}
}

func TestRepositorySymbolLibraryContainsOnlySafeSVGFiles(t *testing.T) {
	_, sourcePath, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate repository test file")
	}
	directory := filepath.Clean(filepath.Join(filepath.Dir(sourcePath), "..", "..", "..", "frontend", "icons", "symbols"))
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("read repository symbol directory: %v", err)
	}

	ConfigureDirectory(directory)
	symbols, err := List()
	if err != nil {
		t.Fatalf("List() repository symbols error = %v", err)
	}
	if len(symbols) != len(entries) {
		t.Fatalf("List() returned %d safe symbols for %d directory entries", len(symbols), len(entries))
	}
	if len(symbols) < 60 {
		t.Fatalf("List() returned %d symbols, want the migrated library", len(symbols))
	}
	if !Contains(defaultSymbolKey) {
		t.Fatal("repository symbol library is missing the safe table fallback")
	}
	for _, key := range []string{"map", "payments", "group_center_filled"} {
		if !Contains(key) {
			t.Fatalf("repository symbol library is missing reviewed dataset symbol %q", key)
		}
	}
}

func writeTestSymbol(t *testing.T, directory, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
