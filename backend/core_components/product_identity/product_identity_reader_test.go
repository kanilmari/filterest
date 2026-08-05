// product_identity_reader_test.go
// Verifies product marker detection for private Easelect and public Filterest.
// Bridges temporary filesystem fixtures and the runtime identity contract.
// Exists so export work can rely on explicit marker-file semantics.
package productidentity

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectPrivateEaselect(t *testing.T) {
	resetPrivateFrontendExtensionsForTest(t)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "VERSION_EASELECT"), []byte("8.0.16\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	identity := Detect(root)
	if identity.Kind != KindEaselectPrivate {
		t.Fatalf("kind = %q, want %q", identity.Kind, KindEaselectPrivate)
	}
	if identity.Name != "Easelect" || !identity.PrivateUpstream || identity.PublicDistribution {
		t.Fatalf("unexpected private identity: %+v", identity)
	}
	if identity.AppVersionFile != "VERSION_EASELECT" || identity.Version != "8.0.16" {
		t.Fatalf("unexpected version metadata: %+v", identity)
	}
}

func TestDetectPublicFilterest(t *testing.T) {
	resetPrivateFrontendExtensionsForTest(t)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "VERSION_APP"), []byte("8.0.16\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	identity := Detect(root)
	if identity.Kind != KindFilterestPublic {
		t.Fatalf("kind = %q, want %q", identity.Kind, KindFilterestPublic)
	}
	if identity.Name != "Filterest" || identity.PrivateUpstream || !identity.PublicDistribution {
		t.Fatalf("unexpected public identity: %+v", identity)
	}
	if identity.AppVersionFile != "VERSION_APP" || identity.Version != "8.0.16" {
		t.Fatalf("unexpected version metadata: %+v", identity)
	}
}

func TestPrivateFrontendExtensionOnlyAppearsAfterRegistration(t *testing.T) {
	resetPrivateFrontendExtensionsForTest(t)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "VERSION_EASELECT"), []byte("8.0.16\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	before := Detect(root)
	if before.PrivateFrontendExtensionModuleURL != "" {
		t.Fatalf("private extension URL before registration = %q, want empty", before.PrivateFrontendExtensionModuleURL)
	}

	RegisterPrivateFrontendExtension("/frontend/example-private/register.js")
	after := Detect(root)
	if after.PrivateFrontendExtensionModuleURL != "/frontend/example-private/register.js" {
		t.Fatalf("private extension URL = %q", after.PrivateFrontendExtensionModuleURL)
	}
}

func resetPrivateFrontendExtensionsForTest(t *testing.T) {
	t.Helper()
	privateExtensionMu.Lock()
	previous := append([]string(nil), privateFrontendModuleURLs...)
	privateFrontendModuleURLs = nil
	privateExtensionMu.Unlock()
	t.Cleanup(func() {
		privateExtensionMu.Lock()
		privateFrontendModuleURLs = previous
		privateExtensionMu.Unlock()
	})
}
