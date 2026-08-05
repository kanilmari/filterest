package media_utils

import "testing"

func TestAllowedImageExtensions(t *testing.T) {
	expected := map[string]struct{}{
		".jpg":  {},
		".jpeg": {},
		".png":  {},
		".webp": {},
		".gif":  {},
	}

	if len(AllowedImageExtensions) != len(expected) {
		t.Fatalf("AllowedImageExtensions length = %d, want %d", len(AllowedImageExtensions), len(expected))
	}

	for ext := range expected {
		if _, ok := AllowedImageExtensions[ext]; !ok {
			t.Fatalf("AllowedImageExtensions missing %q", ext)
		}
	}

	for ext := range AllowedImageExtensions {
		if _, ok := expected[ext]; !ok {
			t.Fatalf("AllowedImageExtensions contains unexpected %q", ext)
		}
	}
}

func TestRequiredSubfolders(t *testing.T) {
	expected := []string{"300", "1000", "2160", "original"}

	if len(RequiredSubfolders) != len(expected) {
		t.Fatalf("RequiredSubfolders length = %d, want %d", len(RequiredSubfolders), len(expected))
	}

	seen := make(map[string]struct{}, len(RequiredSubfolders))
	for i, want := range expected {
		if RequiredSubfolders[i] != want {
			t.Fatalf("RequiredSubfolders[%d] = %q, want %q", i, RequiredSubfolders[i], want)
		}
		if _, exists := seen[RequiredSubfolders[i]]; exists {
			t.Fatalf("RequiredSubfolders contains duplicate %q", RequiredSubfolders[i])
		}
		seen[RequiredSubfolders[i]] = struct{}{}
	}
}
