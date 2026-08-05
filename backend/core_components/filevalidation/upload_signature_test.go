package filevalidation

import (
	"os"
	"testing"
)

func validationFile(t *testing.T, data []byte) *os.File {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "upload-*")
	if err != nil {
		t.Fatalf("CreateTemp: %v", err)
	}
	if _, err := file.Write(data); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if _, err := file.Seek(0, 0); err != nil {
		t.Fatalf("Seek: %v", err)
	}
	return file
}

func TestValidateExtensionSignatureAcceptsPNG(t *testing.T) {
	file := validationFile(t, []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0x00})
	if err := ValidateExtensionSignature(file, ".png"); err != nil {
		t.Fatalf("ValidateExtensionSignature(.png) error = %v", err)
	}
}

func TestValidateExtensionSignatureRejectsRenamedHTML(t *testing.T) {
	file := validationFile(t, []byte("<html><script>alert(1)</script></html>"))
	if err := ValidateExtensionSignature(file, ".pdf"); err == nil {
		t.Fatal("ValidateExtensionSignature(.pdf) accepted renamed HTML")
	}
}

func TestValidateExtensionSignatureRejectsActiveSVG(t *testing.T) {
	file := validationFile(t, []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`))
	if err := ValidateExtensionSignature(file, ".svg"); err == nil {
		t.Fatal("ValidateExtensionSignature(.svg) accepted active SVG")
	}
}

func TestValidateExtensionSignatureRewindsFile(t *testing.T) {
	want := []byte("%PDF-1.7\n")
	file := validationFile(t, want)
	if err := ValidateExtensionSignature(file, "pdf"); err != nil {
		t.Fatalf("ValidateExtensionSignature(pdf) error = %v", err)
	}
	got := make([]byte, len(want))
	if _, err := file.Read(got); err != nil {
		t.Fatalf("Read after validation: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("file was not rewound: got %q, want %q", string(got), string(want))
	}
}
