// main_test.go
// Verifies that the standalone public launcher enables starter-media setup.
// Protects the explicit opt-in boundary between Filterest and private Easelect.
// Exists so launcher refactors cannot silently stop populating public images.
package main

import "testing"

func TestPublicRuntimeOptionsEnableBootstrapMediaMaterialization(t *testing.T) {
	if !publicRuntimeOptions().MaterializePublicBootstrapMedia {
		t.Fatal("public runtime must enable bootstrap media materialization")
	}
}
