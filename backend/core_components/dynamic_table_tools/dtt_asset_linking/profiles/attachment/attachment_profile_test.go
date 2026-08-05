// attachment_profile_test.go
// Verifies the scaffold defaults for the future attachment profile under asset_linking.
// Bridges the attachment-profile default registry and the upcoming non-image rollout.
// Exists to keep the first attachment defaults stable while image-only routes remain live.
package attachment

import "testing"

func TestAttachmentProfileDefaults(t *testing.T) {
	allowedTypes := DefaultAllowedFileTypes()
	if len(allowedTypes) == 0 {
		t.Fatal("DefaultAllowedFileTypes returned no values")
	}

	foundPDF := false
	for _, ext := range allowedTypes {
		if ext == "pdf" {
			foundPDF = true
			break
		}
	}
	if !foundPDF {
		t.Fatalf("DefaultAllowedFileTypes = %#v, want pdf included", allowedTypes)
	}

	kinds := SupportedAssetKinds()
	if len(kinds) != 3 {
		t.Fatalf("SupportedAssetKinds = %#v, want three grouped attachment kinds", kinds)
	}
}
