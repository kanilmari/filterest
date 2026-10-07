// release_manifest_contract_test.go
// Checks release contract rejection and authenticated public/private fixtures.
// Connects deterministic in-memory test keys to manifest trust and identity checks.
// Guards exact bytes, clock/revision inputs and cross-field release requirements.
package release_updates

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// All fixture keys are deterministic TEST ONLY secrets, explicitly named and
// confined to testdata/test_only. No production identity or payload is asserted.
func contractFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "test_only", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func contractFixtureKey(t *testing.T, name string) ed25519.PrivateKey {
	t.Helper()
	// Deterministic TEST ONLY seeds stay in memory; disk fixtures are encrypted.
	seeds := map[string]string{
		"private":  "ba056bb3df8035c02602555b05bbb307d537510dac0be1b0cdd81880a2f31527",
		"public":   "94609fbfaf09cbffd356d8365391a6cba4585fcc49fac5b01c12837459ecc2d9",
		"rotation": "cd44d0b3c6db020e9d78e9552d944783a1e4bec0b950b913d26cafc737426042",
		"wrong":    "11e56ae5dc8c57d276e67e7636edcde4340bbb9827a8200720c1b4e50780a402",
	}
	seed, err := hex.DecodeString(seeds[name])
	if err != nil || len(seed) != ed25519.SeedSize {
		t.Fatal("unknown in-memory test key")
	}
	defer clear(seed)
	key := ed25519.NewKeyFromSeed(seed)
	return key
}

func contractFixturePolicy(t *testing.T) *TrustPolicyV1 {
	t.Helper()
	policy, err := ParseTrustPolicy(contractFixture(t, "trust_policy.json"))
	if err != nil {
		t.Fatal(err)
	}
	return policy
}

func contractOptions(id string) VerificationOptions {
	return VerificationOptions{CompositionID: id, MinimumTrustPolicyRevision: 1, Now: time.Date(2026, 10, 7, 7, 40, 0, 0, time.UTC)}
}

func contractJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func canonicalContractJSON(t *testing.T, value any) []byte {
	t.Helper()
	var object any
	if err := json.Unmarshal(contractJSON(t, value), &object); err != nil {
		t.Fatal(err)
	}
	return append(contractJSON(t, object), '\n')
}

func rawContractSignatures(t *testing.T, data []byte, keyName, domain string) []byte {
	t.Helper()
	key := contractFixtureKey(t, keyName)
	return contractJSON(t, SignatureEnvelopeV1{SchemaVersion: 1, SignatureType: "ed25519_detached", Domain: domain, Signatures: []DetachedSignatureV1{{KeyFingerprint: KeyFingerprint(key.Public().(ed25519.PublicKey)), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, signatureMessage(domain, data)))}}})
}

func TestReleaseManifestPublicAndPrivate(t *testing.T) {
	for _, test := range []struct{ name, id string }{{"public", "filterest"}, {"private", "easelect"}} {
		t.Run(test.name, func(t *testing.T) {
			data := contractFixture(t, test.name+"_manifest.json")
			verified, err := VerifyManifest(data, contractFixture(t, test.name+"_signatures.json"), contractFixturePolicy(t), contractOptions(test.id))
			if err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(data)
			if verified.ManifestSHA256 != hex.EncodeToString(digest[:]) || verified.Manifest.Composition.ID != test.id || len(verified.KeyFingerprints) != 1 {
				t.Fatalf("unexpected authenticated result: %#v", verified)
			}
			if verified.Manifest.PublishedCommit == verified.Manifest.BuildIdentity.Source.Commit {
				t.Fatal("fixture must prove distinct final and source commits")
			}
		})
	}
}

func TestReleaseManifestExactBytesAndCompositionTrust(t *testing.T) {
	data, signatures := contractFixture(t, "public_manifest.json"), contractFixture(t, "public_signatures.json")
	for _, changed := range [][]byte{append(append([]byte{}, data...), ' '), bytes.Replace(data, []byte("9.3.22"), []byte("9.3.23"), 1), data[:len(data)-1]} {
		if _, err := VerifyManifest(changed, signatures, contractFixturePolicy(t), contractOptions("filterest")); !errors.Is(err, ErrUntrustedRelease) {
			t.Fatalf("changed bytes: %v", err)
		}
	}
	for _, test := range []struct {
		name        string
		data, sig   []byte
		composition string
	}{
		{"wrong key", data, rawContractSignatures(t, data, "wrong", ManifestSignatureDomain), "filterest"},
		{"private key signs public", data, rawContractSignatures(t, data, "private", ManifestSignatureDomain), "filterest"},
		{"public on private installation", data, signatures, "easelect"},
		{"public key signs private composition", contractFixture(t, "private_manifest.json"), rawContractSignatures(t, contractFixture(t, "private_manifest.json"), "public", ManifestSignatureDomain), "filterest"},
		{"unknown composition", data, signatures, "unregistered"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := VerifyManifest(test.data, test.sig, contractFixturePolicy(t), contractOptions(test.composition)); !errors.Is(err, ErrUntrustedRelease) {
				t.Fatalf("got %v", err)
			}
		})
	}
	// Authenticated noncanonical bytes still fail: the digest must be unique.
	spaced := append([]byte(" \n"), data...)
	if _, err := VerifyManifest(spaced, rawContractSignatures(t, spaced, "public", ManifestSignatureDomain), contractFixturePolicy(t), contractOptions("filterest")); !errors.Is(err, ErrInvalidManifest) {
		t.Fatalf("noncanonical signed bytes accepted: %v", err)
	}
}

func TestReleaseManifestKeyWindowsRevocationAndPolicyFreshness(t *testing.T) {
	data, signatures := contractFixture(t, "public_manifest.json"), contractFixture(t, "public_signatures.json")
	tests := []struct {
		name   string
		mutate func(*TrustPolicyV1, *VerificationOptions)
		want   error
	}{
		{"revoked", func(p *TrustPolicyV1, o *VerificationOptions) { p.Compositions[0].Keys[0].Revoked = true }, ErrUntrustedRelease},
		{"key expired now", func(p *TrustPolicyV1, o *VerificationOptions) {
			p.Compositions[0].Keys[0].NotAfter = "2026-10-07T07:20:00Z"
		}, ErrUntrustedRelease},
		{"key not valid at creation", func(p *TrustPolicyV1, o *VerificationOptions) {
			p.Compositions[0].Keys[0].NotBefore = "2026-10-07T07:20:00Z"
		}, ErrUntrustedRelease},
		{"key not yet valid", func(p *TrustPolicyV1, o *VerificationOptions) {
			p.Compositions[0].Keys[0].NotBefore = "2026-10-08T00:00:00Z"
		}, ErrUntrustedRelease},
		{"policy expired", func(p *TrustPolicyV1, o *VerificationOptions) { p.ExpiresAt = "2026-10-07T07:40:00Z" }, ErrStaleTrustPolicy},
		{"future policy", func(p *TrustPolicyV1, o *VerificationOptions) { p.IssuedAt = "2026-10-08T00:00:00Z" }, ErrStaleTrustPolicy},
		{"policy rollback", func(p *TrustPolicyV1, o *VerificationOptions) { o.MinimumTrustPolicyRevision = 2 }, ErrStaleTrustPolicy},
		{"clock missing", func(p *TrustPolicyV1, o *VerificationOptions) { o.Now = time.Time{} }, ErrInvalidTrustPolicy},
		{"revision floor missing", func(p *TrustPolicyV1, o *VerificationOptions) { o.MinimumTrustPolicyRevision = 0 }, ErrInvalidTrustPolicy},
		{"publisher substitution", func(p *TrustPolicyV1, o *VerificationOptions) { p.Compositions[0].Publisher = "someone_else" }, ErrUntrustedRelease},
		{"fingerprint substitution", func(p *TrustPolicyV1, o *VerificationOptions) {
			p.Compositions[0].Keys[0].Fingerprint = strings.Repeat("f", 64)
		}, ErrInvalidTrustPolicy},
		{"cross-composition key reuse", func(p *TrustPolicyV1, o *VerificationOptions) { p.Compositions[1].Keys[0] = p.Compositions[0].Keys[0] }, ErrInvalidTrustPolicy},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			p, o := contractFixturePolicy(t), contractOptions("filterest")
			test.mutate(p, &o)
			if _, err := VerifyManifest(data, signatures, p, o); !errors.Is(err, test.want) {
				t.Fatalf("got %v, want %v", err, test.want)
			}
		})
	}
	m, err := ParseManifest(data)
	if err != nil {
		t.Fatal(err)
	}
	m.MinimumTrustPolicyRevision = 2
	data = canonicalContractJSON(t, m)
	if _, err := VerifyManifest(data, rawContractSignatures(t, data, "public", ManifestSignatureDomain), contractFixturePolicy(t), contractOptions("filterest")); !errors.Is(err, ErrStaleTrustPolicy) {
		t.Fatal(err)
	}
}

func TestReleaseManifestStrictJSON(t *testing.T) {
	data := contractFixture(t, "public_manifest.json")
	tests := map[string][]byte{
		"top duplicate":          bytes.Replace(data, []byte(`"schema_version":1`), []byte(`"schema_version":1,"schema_version":1`), 1),
		"escaped duplicate":      bytes.Replace(data, []byte(`"schema_version":1`), []byte(`"schema_version":1,"schema_\u0076ersion":1`), 1),
		"nested duplicate":       bytes.Replace(data, []byte(`"architecture":"amd64"`), []byte(`"architecture":"amd64","architecture":"amd64"`), 1),
		"array object duplicate": bytes.Replace(data, []byte(`"name":"filterest-linux-amd64"`), []byte(`"name":"filterest-linux-amd64","name":"filterest-linux-amd64"`), 1),
		"trailing object":        append(append([]byte{}, data...), []byte(`{}`)...),
		"trailing scalar":        append(append([]byte{}, data...), []byte(`true`)...),
		"trailing junk":          append(append([]byte{}, data...), []byte(`garbage`)...),
		"invalid utf8":           append([]byte{0xff}, data...),
		"bom":                    append([]byte{0xef, 0xbb, 0xbf}, data...),
		"empty":                  {}, "not object": []byte(`[]`), "truncated": data[:len(data)/2],
		"missing required false": bytes.Replace(data, []byte(`"publishes_database_version":false,`), nil, 1),
		"unknown":                bytes.Replace(data, []byte(`"manifest_type":`), []byte(`"unknown":1,"manifest_type":`), 1),
		"wrong case":             bytes.Replace(data, []byte(`"manifest_type":`), []byte(`"Manifest_type":`), 1),
		"null":                   bytes.Replace(data, []byte(`"cpu_features":[]`), []byte(`"cpu_features":null`), 1),
		"fractional version":     bytes.Replace(data, []byte(`"schema_version":1`), []byte(`"schema_version":1.0`), 1),
		"depth limit":            []byte(strings.Repeat("[", 66) + strings.Repeat("]", 66)),
		"oversized":              bytes.Repeat([]byte{' '}, MaxManifestBytes+1),
	}
	for name, malformed := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseManifest(malformed); !errors.Is(err, ErrInvalidManifest) {
				t.Fatalf("accepted ambiguous JSON: %v", err)
			}
		})
	}
	malformed := []byte(`{"schema_version":1,"schema_version":1}`)
	if _, err := VerifyManifest(malformed, rawContractSignatures(t, malformed, "public", ManifestSignatureDomain), contractFixturePolicy(t), contractOptions("filterest")); !errors.Is(err, ErrInvalidManifest) {
		t.Fatalf("signed malformed JSON: %v", err)
	}
	if _, err := VerifyManifest(malformed, contractFixture(t, "public_signatures.json"), contractFixturePolicy(t), contractOptions("filterest")); !errors.Is(err, ErrUntrustedRelease) {
		t.Fatalf("instructions interpreted before authentication: %v", err)
	}
}

func TestReleaseManifestInvalidCombinations(t *testing.T) {
	tests := map[string]func(*ManifestV1){
		"composition differs from product": func(m *ManifestV1) { m.Composition.ID = "different" },
		"zero minimum policy revision":     func(m *ManifestV1) { m.MinimumTrustPolicyRevision = 0 },
		"invalid publisher":                func(m *ManifestV1) { m.Publisher = "INVALID!" },
		"unknown schema":                   func(m *ManifestV1) { m.SchemaVersion = 2 },
		"unknown protocol":                 func(m *ManifestV1) { m.Protocol.Version = 2 },
		"wrong release tag":                func(m *ManifestV1) { m.ReleaseTag = "v9.3.23" },
		"version identity mismatch":        func(m *ManifestV1) { m.Version = "9.3.23"; m.ReleaseTag = "v9.3.23" },
		"source identity mismatch":         func(m *ManifestV1) { m.BuildIdentity.Source.Commit = strings.Repeat("f", 40) },
		"candidate identity":               func(m *ManifestV1) { m.BuildIdentity.Maturity = "candidate" },
		"runtime minimum newer":            func(m *ManifestV1) { m.BuildIdentity.Database.MinVersion = "9.11.0" },
		"db identity mismatch":             func(m *ManifestV1) { m.Database.TargetVersion = "9.11.0" },
		"creation before identity":         func(m *ManifestV1) { m.CreatedAt = "2026-10-07T06:00:00Z" },
		"impossible timestamp":             func(m *ManifestV1) { m.CreatedAt = "2026-02-30T00:00:00Z" },
		"numeric overflow":                 func(m *ManifestV1) { m.BuildIdentity.Database.MinVersion = "999999999999999999999999.0.0" },
		"duplicate component": func(m *ManifestV1) {
			m.Composition.Components = append(m.Composition.Components, m.Composition.Components[0])
		},
		"component commit mismatch": func(m *ManifestV1) { m.Composition.Components[0].Commit = strings.Repeat("f", 40) },
		"no artifacts":              func(m *ManifestV1) { m.Artifacts = []ArtifactV1{} },
		"duplicate artifact":        func(m *ManifestV1) { m.Artifacts = append(m.Artifacts, m.Artifacts[0]) },
		"unsafe artifact name":      func(m *ManifestV1) { m.Artifacts[0].Name = "../binary" },
		"invalid hash":              func(m *ManifestV1) { m.Artifacts[0].SHA256 = strings.Repeat("F", 64) },
		"expanded too small":        func(m *ManifestV1) { m.Artifacts[0].ExpandedSizeBytes = 1 },
		"binary portable":           func(m *ManifestV1) { m.Artifacts[0].Platform = m.Artifacts[1].Platform },
		"undeclared architecture":   func(m *ManifestV1) { m.Artifacts[0].Platform.Architecture = "arm64" },
		"OCI without descriptors":   func(m *ManifestV1) { m.Artifacts[0].Kind = "oci_archive" },
		"OCI descriptors on binary": func(m *ManifestV1) {
			m.Artifacts[0].OCI = &OCIDescriptorsV1{ManifestDigest: "sha256:" + strings.Repeat("f", 64), ConfigDigest: "sha256:" + strings.Repeat("e", 64)}
		},
		"no explicit starts": func(m *ManifestV1) { m.Database.SupportedStarts = []DatabaseStartV1{} },
		"duplicate start": func(m *ManifestV1) {
			m.Database.SupportedStarts = append(m.Database.SupportedStarts, m.Database.SupportedStarts[0])
		},
		"nonincreasing revision": func(m *ManifestV1) { m.Composition.Revision = 1 },
		"inventory out of order": func(m *ManifestV1) {
			m.Database.Migrations[0], m.Database.Migrations[1] = m.Database.Migrations[1], m.Database.Migrations[0]
		},
		"duplicate inventory":     func(m *ManifestV1) { m.Database.Migrations = append(m.Database.Migrations, m.Database.Migrations[1]) },
		"unowned migration":       func(m *ManifestV1) { m.Database.Migrations[0].Component = "missing" },
		"missing route migration": func(m *ManifestV1) { m.Database.SupportedStarts[0].MigrationIDs[0] = "missing.sql" },
		"route out of order":      func(m *ManifestV1) { r := m.Database.SupportedStarts[0].MigrationIDs; r[0], r[1] = r[1], r[0] },
		"empty upgrade route":     func(m *ManifestV1) { m.Database.SupportedStarts[0].MigrationIDs = []string{} },
		"missing final db owner":  func(m *ManifestV1) { m.Database.Migrations[1].PublishesDatabaseVersion = false },
		"migration after final db owner": func(m *ManifestV1) {
			extra := m.Database.Migrations[0]
			extra.ID = "20261006000001_late_change.sql"
			m.Database.Migrations = append(m.Database.Migrations, extra)
		},
		"optional version owner":         func(m *ManifestV1) { m.Database.Migrations[1].ErrorPolicy = "optional" },
		"unsupported transaction policy": func(m *ManifestV1) { m.Database.Migrations[0].TransactionPolicy = "guess" },
		"target older than start":        func(m *ManifestV1) { m.Database.SupportedStarts[0].DatabaseVersion = "10.0.0" },
		"target older than app start":    func(m *ManifestV1) { m.Database.SupportedStarts[0].AppVersion = "10.0.0" },
		"duplicate capability": func(m *ManifestV1) {
			m.Protocol.RequiredCapabilities = append(m.Protocol.RequiredCapabilities, m.Protocol.RequiredCapabilities[0])
		},
		"no readiness identity":      func(m *ManifestV1) { m.Health.ExactInstallation = false },
		"no offhost backup":          func(m *ManifestV1) { m.Recovery.OffHostCopy = false },
		"missing settings backup":    func(m *ManifestV1) { m.Recovery.BackupScopes = m.Recovery.BackupScopes[:3] },
		"missing capacity purpose":   func(m *ManifestV1) { m.Capacity.Allocations = m.Capacity.Allocations[:3] },
		"duplicate capacity purpose": func(m *ManifestV1) { m.Capacity.Allocations[1].Purpose = m.Capacity.Allocations[0].Purpose },
		"no inode requirement":       func(m *ManifestV1) { m.Capacity.RequireInodes = false },
		"invalid reserve percentage": func(m *ManifestV1) { m.Capacity.ReservePercent = 101 },
		"postgres reversed range":    func(m *ManifestV1) { m.Platform.PostgreSQL.MaxMajor = 15 },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			m, err := ParseManifest(contractFixture(t, "public_manifest.json"))
			if err != nil {
				t.Fatal(err)
			}
			mutate(m)
			if _, err := ParseManifest(contractJSON(t, m)); !errors.Is(err, ErrInvalidManifest) {
				t.Fatalf("accepted invalid combination: %v", err)
			}
		})
	}
	// Equal database versions use an explicit empty route, not the runtime minimum.
	m, err := ParseManifest(contractFixture(t, "public_manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	m.Database.SupportedStarts[0].DatabaseVersion = m.Database.TargetVersion
	m.Database.SupportedStarts[0].MigrationIDs = []string{}
	m.Database.Migrations = []MigrationV1{}
	if _, err := ParseManifest(contractJSON(t, m)); err != nil {
		t.Fatal(err)
	}
}

func TestReleaseDetachedSignaturesRejectMalformedEnvelopes(t *testing.T) {
	good := contractFixture(t, "public_signatures.json")
	var signature SignatureEnvelopeV1
	if err := json.Unmarshal(good, &signature); err != nil {
		t.Fatal(err)
	}
	tests := map[string][]byte{"empty": {}, "json": []byte(`{`), "duplicate": bytes.Replace(good, []byte(`"domain":`), []byte(`"schema_version":1,"domain":`), 1), "trailing": append(append([]byte{}, good...), []byte(`{}`)...), "adjacent public key": bytes.Replace(good, []byte(`"domain":`), []byte(`"public_key":"downloaded","domain":`), 1)}
	for _, mutate := range []func(*SignatureEnvelopeV1){func(s *SignatureEnvelopeV1) { s.SchemaVersion = 2 }, func(s *SignatureEnvelopeV1) { s.Domain = TrustPolicySignatureDomain }, func(s *SignatureEnvelopeV1) { s.Signatures = nil }, func(s *SignatureEnvelopeV1) { s.Signatures = append(s.Signatures, s.Signatures[0]) }, func(s *SignatureEnvelopeV1) { s.Signatures[0].Signature = "%%%" }, func(s *SignatureEnvelopeV1) {
		s.Signatures[0].Signature = base64.StdEncoding.EncodeToString([]byte("short"))
	}, func(s *SignatureEnvelopeV1) { s.Signatures[0].Signature += "\n" }} {
		var changed SignatureEnvelopeV1
		if err := json.Unmarshal(good, &changed); err != nil {
			t.Fatal(err)
		}
		mutate(&changed)
		tests[string(contractJSON(t, changed))] = contractJSON(t, changed)
	}
	for name, malformed := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := VerifyManifest(contractFixture(t, "public_manifest.json"), malformed, contractFixturePolicy(t), contractOptions("filterest")); !errors.Is(err, ErrInvalidSignature) {
				t.Fatalf("got %v", err)
			}
		})
	}
	// Correct signature length with altered proof remains structurally valid but untrusted.
	signature.Signatures[0].Signature = base64.StdEncoding.EncodeToString(make([]byte, ed25519.SignatureSize))
	if _, err := VerifyManifest(contractFixture(t, "public_manifest.json"), contractJSON(t, signature), contractFixturePolicy(t), contractOptions("filterest")); !errors.Is(err, ErrUntrustedRelease) {
		t.Fatal(err)
	}
}

func TestReleaseManifestOCIRequirements(t *testing.T) {
	m, err := ParseManifest(contractFixture(t, "public_manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	m.Artifacts[0].Kind = "oci_archive"
	m.Artifacts[0].ExpandedSizeBytes = 200
	m.Artifacts[0].OCI = &OCIDescriptorsV1{ManifestDigest: "sha256:" + strings.Repeat("f", 64), ConfigDigest: "sha256:" + strings.Repeat("e", 64)}
	m.Platform.Docker = &DockerRequirementsV1{MinEngineVersion: "24.0.0", MinComposeVersion: "2.20.0"}
	m.Capacity.Allocations = append(m.Capacity.Allocations, CapacityAllocationV1{Purpose: "docker_storage", Bytes: 1024, Inodes: 10})
	if _, err := ParseManifest(contractJSON(t, m)); err != nil {
		t.Fatal(err)
	}
	m.Artifacts[0].OCI.ManifestDigest = strings.Repeat("f", 64)
	if _, err := ParseManifest(contractJSON(t, m)); !errors.Is(err, ErrInvalidManifest) {
		t.Fatal("untyped OCI digest accepted")
	}
	m.Artifacts[0].OCI.ManifestDigest = "sha256:" + strings.Repeat("f", 64)
	m.Platform.Docker = nil
	if _, err := ParseManifest(contractJSON(t, m)); !errors.Is(err, ErrInvalidManifest) {
		t.Fatal("OCI delivery without Docker requirements accepted")
	}
}

func TestReleaseManifestFutureCreation(t *testing.T) {
	m, err := ParseManifest(contractFixture(t, "public_manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	m.CreatedAt = "2026-10-07T07:40:01Z"
	data := canonicalContractJSON(t, m)
	if _, err := VerifyManifest(data, rawContractSignatures(t, data, "public", ManifestSignatureDomain), contractFixturePolicy(t), contractOptions("filterest")); !errors.Is(err, ErrUntrustedRelease) || !strings.Contains(err.Error(), "future") {
		t.Fatalf("future creation: %v", err)
	}
}
