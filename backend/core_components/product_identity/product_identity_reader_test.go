// product_identity_reader_test.go
// Verifies Filterest identity detection for transition and public build markers.
// Bridges temporary filesystem fixtures and the runtime identity contract.
// Exists so export work can rely on explicit marker-file semantics.
package productidentity

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
	if identity.Name != "Filterest" || !identity.PrivateUpstream || identity.PublicDistribution {
		t.Fatalf("unexpected private identity: %+v", identity)
	}
	if identity.AppVersionFile != "VERSION_EASELECT" || identity.Version != "8.0.16" {
		t.Fatalf("unexpected version metadata: %+v", identity)
	}
	if identity.ReleaseChannel != ReleaseChannelDevelopment || identity.ArtifactPurpose != ArtifactPurposeUnknown ||
		identity.ArtifactType != ArtifactTypeRuntime || identity.Maturity != ReleaseMaturitySnapshot {
		t.Fatalf("unexpected legacy private release identity: %+v", identity)
	}
	if identity.IdentitySource != IdentitySourceLegacyMarker || identity.Verification != IdentityVerificationLegacyUnverified {
		t.Fatalf("unexpected private verification metadata: %+v", identity)
	}
}

func TestDetectLegacyPublicFilterestDoesNotClaimStableRelease(t *testing.T) {
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
	if identity.ReleaseChannel != ReleaseChannelUnknown || identity.ArtifactPurpose != ArtifactPurposeUnknown {
		t.Fatalf("legacy marker made a release claim: %+v", identity)
	}
	if identity.ArtifactType != ArtifactTypeUnknown || identity.Maturity != ReleaseMaturityUnknown ||
		identity.IdentitySource != IdentitySourceLegacyMarker ||
		identity.Verification != IdentityVerificationLegacyUnverified {
		t.Fatalf("unexpected public fallback verification metadata: %+v", identity)
	}
}

func TestDetectValidatedStableCandidateBuildIdentity(t *testing.T) {
	resetPrivateFrontendExtensionsForTest(t)
	root := t.TempDir()
	document := writeBuildIdentityFixture(
		t,
		root,
		ReleaseChannelStable,
		ArtifactTypeRuntime,
		ReleaseMaturityCandidate,
	)

	identity := Detect(root)

	if identity.Kind != KindFilterestPublic || identity.Name != "Filterest" || !identity.PublicDistribution {
		t.Fatalf("unexpected build identity product: %+v", identity)
	}
	if identity.ReleaseChannel != ReleaseChannelStable || identity.ArtifactType != ArtifactTypeRuntime ||
		identity.Maturity != ReleaseMaturityCandidate {
		t.Fatalf("unexpected stable candidate dimensions: %+v", identity)
	}
	if identity.ArtifactPurpose != ArtifactPurposeUnknown {
		t.Fatalf("candidate claimed legacy public-release purpose: %+v", identity)
	}
	if identity.Verification != IdentityVerificationLocalContract ||
		identity.IdentitySource != IdentitySourceBuildIdentityV1 {
		t.Fatalf("unexpected build identity verification: %+v", identity)
	}
	if identity.BuildID != document.BuildID || identity.LedgerRecordID != document.LedgerRecordID {
		t.Fatalf("unexpected immutable build binding: %+v", identity)
	}
	if identity.DatabaseMinVersion != "8.0.59" || identity.DatabaseTargetVersion != "8.0.59" {
		t.Fatalf("unexpected build database identity: %+v", identity)
	}
}

func TestDetectValidatedPublishedRuntimeMapsLegacyPurposeNarrowly(t *testing.T) {
	root := t.TempDir()
	writeBuildIdentityFixture(
		t,
		root,
		ReleaseChannelStable,
		ArtifactTypeRuntime,
		ReleaseMaturityPublished,
	)

	identity := Detect(root)

	if identity.ArtifactPurpose != ArtifactPurposePublicRelease {
		t.Fatalf("published stable runtime purpose = %q, want %q", identity.ArtifactPurpose, ArtifactPurposePublicRelease)
	}
}

func TestDetectValidatedDevelopmentRuntimeSnapshot(t *testing.T) {
	root := t.TempDir()
	writeBuildIdentityFixture(
		t,
		root,
		ReleaseChannelDevelopment,
		ArtifactTypeRuntime,
		ReleaseMaturitySnapshot,
	)

	identity := Detect(root)

	if identity.ReleaseChannel != ReleaseChannelDevelopment || identity.ArtifactType != ArtifactTypeRuntime ||
		identity.Maturity != ReleaseMaturitySnapshot || identity.ArtifactPurpose != ArtifactPurposeUnknown {
		t.Fatalf("unexpected development snapshot identity: %+v", identity)
	}
}

func TestDetectValidatedBackupUsesBackupPurposeOnly(t *testing.T) {
	root := t.TempDir()
	writeBuildIdentityFixture(
		t,
		root,
		ReleaseChannelDevelopment,
		ArtifactTypeBackup,
		ReleaseMaturitySnapshot,
	)

	identity := Detect(root)

	if identity.ArtifactType != ArtifactTypeBackup || identity.ArtifactPurpose != ArtifactPurposeDeveloperBackup ||
		identity.Maturity != ReleaseMaturitySnapshot {
		t.Fatalf("unexpected backup identity: %+v", identity)
	}
}

func TestDetectBuildIdentityRejectsNightlyAndUnknownFields(t *testing.T) {
	t.Run("nightly channel", func(t *testing.T) {
		root := t.TempDir()
		writeBuildIdentityFixture(
			t,
			root,
			ReleaseChannel("nightly"),
			ArtifactTypeRuntime,
			ReleaseMaturitySnapshot,
		)

		if identity := Detect(root); identity.Kind != KindUnknown || identity.Verification != IdentityVerificationUnverified {
			t.Fatalf("nightly v1 identity did not fail closed: %+v", identity)
		}
	})

	t.Run("unknown field", func(t *testing.T) {
		root := t.TempDir()
		writeBuildIdentityFixture(
			t,
			root,
			ReleaseChannelStable,
			ArtifactTypeRuntime,
			ReleaseMaturityCandidate,
		)
		identityPath := filepath.Join(root, buildIdentityFilename)
		identityBytes, err := os.ReadFile(identityPath)
		if err != nil {
			t.Fatal(err)
		}
		identityObject := map[string]any{}
		if err := json.Unmarshal(identityBytes, &identityObject); err != nil {
			t.Fatal(err)
		}
		identityObject["mutable_status"] = "active"
		identityBytes, err = json.Marshal(identityObject)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(identityPath, identityBytes, 0o644); err != nil {
			t.Fatal(err)
		}

		if identity := Detect(root); identity.Kind != KindUnknown || identity.Verification != IdentityVerificationUnverified {
			t.Fatalf("identity with unknown field did not fail closed: %+v", identity)
		}
	})
}

func TestDetectMalformedBuildIdentityFailsClosedBeforeLegacyMarkers(t *testing.T) {
	root := t.TempDir()
	writeMarker(t, root, "VERSION_APP", "8.30.0\n")
	writeMarker(t, root, "VERSION_DB", "8.0.59\n")
	writeMarker(t, root, buildIdentityFilename, "{\"channel\":\"stable\"}\n")

	identity := Detect(root)

	if identity.Kind != KindUnknown || identity.ReleaseChannel != ReleaseChannelUnknown ||
		identity.ArtifactPurpose != ArtifactPurposeUnknown || identity.PublicDistribution {
		t.Fatalf("malformed identity did not fail closed: %+v", identity)
	}
	if identity.IdentitySource != IdentitySourceBuildIdentityV1 ||
		identity.Verification != IdentityVerificationUnverified {
		t.Fatalf("malformed identity verification metadata: %+v", identity)
	}
}

func TestDetectBuildIdentityRejectsMarkerAndLedgerMismatch(t *testing.T) {
	t.Run("database marker", func(t *testing.T) {
		root := t.TempDir()
		writeBuildIdentityFixture(
			t,
			root,
			ReleaseChannelStable,
			ArtifactTypeRuntime,
			ReleaseMaturityCandidate,
		)
		writeMarker(t, root, "VERSION_DB", "8.0.60\n")

		if identity := Detect(root); identity.Kind != KindUnknown || identity.Verification != IdentityVerificationUnverified {
			t.Fatalf("database marker mismatch did not fail closed: %+v", identity)
		}
	})

	t.Run("ledger bytes", func(t *testing.T) {
		root := t.TempDir()
		writeBuildIdentityFixture(
			t,
			root,
			ReleaseChannelStable,
			ArtifactTypeRuntime,
			ReleaseMaturityCandidate,
		)
		ledgerPath := filepath.Join(root, releaseLedgerFilename)
		ledgerBytes, err := os.ReadFile(ledgerPath)
		if err != nil {
			t.Fatal(err)
		}
		ledgerBytes[10] ^= 1
		if err := os.WriteFile(ledgerPath, ledgerBytes, 0o644); err != nil {
			t.Fatal(err)
		}

		if identity := Detect(root); identity.Kind != KindUnknown || identity.Verification != IdentityVerificationUnverified {
			t.Fatalf("ledger mismatch did not fail closed: %+v", identity)
		}
	})
}

func TestDetectUnknownReleaseIdentity(t *testing.T) {
	resetPrivateFrontendExtensionsForTest(t)
	identity := Detect(t.TempDir())

	if identity.ReleaseChannel != ReleaseChannelUnknown || identity.ArtifactPurpose != ArtifactPurposeUnknown {
		t.Fatalf("unexpected unknown release identity: %+v", identity)
	}
	if identity.Verification != IdentityVerificationUnverified || identity.IdentitySource != IdentitySourceUnknown {
		t.Fatalf("unexpected unknown verification identity: %+v", identity)
	}
}

func writeBuildIdentityFixture(
	t *testing.T,
	root string,
	channel ReleaseChannel,
	artifactType ArtifactType,
	maturity ReleaseMaturity,
) buildIdentityV1 {
	t.Helper()
	commit := "a1b2c3d4e5f6789012345678901234567890abcd"
	buildID := buildIDFor("8.30.0", channel, artifactType, commit)
	recordID := "build:" + buildID
	record := releaseLedgerRecordV1{
		SchemaVersion: 1,
		RecordType:    "build",
		RecordID:      recordID,
		Product:       "filterest",
		BuildID:       buildID,
		AppVersion:    "8.30.0",
		ArtifactType:  artifactType,
		Channel:       channel,
		Maturity:      maturity,
		Source:        buildSourceV1{Model: "public_first", Commit: commit},
		Database:      buildDatabaseV1{MinVersion: "8.0.59", TargetVersion: "8.0.59"},
		CreatedAt:     "2026-08-16T12:00:00Z",
	}
	recordJSON := canonicalJSONForTest(t, record)
	recordLine := append(recordJSON, '\n')
	digestBytes := sha256.Sum256(recordLine)
	document := buildIdentityV1{
		SchemaVersion:      1,
		Product:            "filterest",
		BuildID:            buildID,
		LedgerRecordID:     recordID,
		LedgerRecordSHA256: hex.EncodeToString(digestBytes[:]),
		AppVersion:         "8.30.0",
		ArtifactType:       artifactType,
		Channel:            channel,
		Maturity:           maturity,
		Source:             record.Source,
		Database:           record.Database,
		CreatedAt:          record.CreatedAt,
	}
	identityJSON := canonicalJSONForTest(t, document)

	writeMarker(t, root, "VERSION_APP", "8.30.0\n")
	writeMarker(t, root, "VERSION_DB", "8.0.59\n")
	writeMarker(t, root, buildIdentityFilename, string(identityJSON)+"\n")
	ledgerPath := filepath.Join(root, releaseLedgerFilename)
	if err := os.MkdirAll(filepath.Dir(ledgerPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ledgerPath, recordLine, 0o644); err != nil {
		t.Fatal(err)
	}
	return document
}

func canonicalJSONForTest(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var object any
	if err := json.Unmarshal(encoded, &object); err != nil {
		t.Fatal(err)
	}
	canonical, err := json.Marshal(object)
	if err != nil {
		t.Fatal(err)
	}
	return canonical
}

func writeMarker(t *testing.T, root string, filename string, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, filename), []byte(content), 0o644); err != nil {
		t.Fatal(err)
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
