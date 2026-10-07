// release_trust_policy_test.go
// Tests operator-file provisioning and authenticated policy rotation.
// Connects fixture keys, revocation tombstones and composition-scoped trust.
// Guards replacement possession, authorization order and expired-policy rejection.
package release_updates

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func signPolicyProofs(t *testing.T, data []byte, keyNames ...string) []byte {
	t.Helper()
	proofs := []*SignatureEnvelopeV1{}
	for _, name := range keyNames {
		proof, err := SignTrustPolicy(data, rotationTestKey(name))
		if err != nil {
			t.Fatal(err)
		}
		proofs = append(proofs, proof)
	}
	merged, err := MergeSignatures(proofs...)
	if err != nil {
		t.Fatal(err)
	}
	return contractJSON(t, merged)
}

// Separate in-memory regression keys cross the operator-rotation boundary;
// shipped fixtures remain parseable but cannot establish or update real trust.
func rotationTestKey(name string) ed25519.PrivateKey {
	seed := sha256.Sum256([]byte("WL157 rotation regression only: " + name))
	return ed25519.NewKeyFromSeed(seed[:])
}

func rotationTestPolicy(t *testing.T, fixture string) *TrustPolicyV1 {
	t.Helper()
	policy, err := ParseTrustPolicy(contractFixture(t, fixture))
	if err != nil {
		t.Fatal(err)
	}
	for i := range policy.Compositions {
		for j := range policy.Compositions[i].Keys {
			key := &policy.Compositions[i].Keys[j]
			for _, name := range []string{"public", "private", "rotation", "wrong"} {
				if key.Fingerprint == KeyFingerprint(contractFixtureKey(t, name).Public().(ed25519.PublicKey)) {
					public := rotationTestKey(name).Public().(ed25519.PublicKey)
					key.PublicKey = base64.StdEncoding.EncodeToString(public)
					key.Fingerprint = KeyFingerprint(public)
					break
				}
			}
		}
	}
	return policy
}

func rotationTestData(t *testing.T, fixture string) []byte {
	t.Helper()
	return canonicalContractJSON(t, rotationTestPolicy(t, fixture))
}

func rotationTestSignatures(t *testing.T, data []byte, domain string, names ...string) []byte {
	t.Helper()
	envelope := &SignatureEnvelopeV1{SchemaVersion: 1, SignatureType: "ed25519_detached", Domain: domain}
	for _, name := range names {
		key := rotationTestKey(name)
		envelope.Signatures = append(envelope.Signatures, DetachedSignatureV1{KeyFingerprint: KeyFingerprint(key.Public().(ed25519.PublicKey)), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, signatureMessage(domain, data)))})
	}
	return contractJSON(t, envelope)
}

func TestReleaseTrustRotationRequiresAuthorizationAndPossession(t *testing.T) {
	data := rotationTestData(t, "rotation_policy.json")
	options := contractOptions("filterest")
	policy, err := VerifyTrustPolicyUpdate(data, signPolicyProofs(t, rotationTestData(t, "rotation_policy.json"), "public", "private", "rotation"), rotationTestPolicy(t, "trust_policy.json"), options)
	if err != nil {
		t.Fatal(err)
	}
	manifest := contractFixture(t, "public_manifest.json")
	if _, err := VerifyManifest(manifest, rotationTestSignatures(t, manifest, ManifestSignatureDomain, "public", "rotation"), policy, options); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyManifest(manifest, rotationTestSignatures(t, manifest, ManifestSignatureDomain, "rotation"), policy, options); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyManifest(manifest, rotationTestSignatures(t, manifest, ManifestSignatureDomain, "rotation"), rotationTestPolicy(t, "trust_policy.json"), options); !errors.Is(err, ErrUntrustedRelease) {
		t.Fatal(err)
	}
	// Retired proof in a multi-signature release never blocks its replacement proof.
	policy.Compositions[0].Keys[0].Revoked = true
	if _, err := VerifyManifest(manifest, rotationTestSignatures(t, manifest, ManifestSignatureDomain, "public", "rotation"), policy, options); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyManifest(manifest, rotationTestSignatures(t, manifest, ManifestSignatureDomain, "public"), policy, options); !errors.Is(err, ErrUntrustedRelease) {
		t.Fatal(err)
	}
	for _, keys := range [][]string{{"public", "private"}, {"rotation", "private"}, {"public", "rotation"}, {"wrong", "private", "rotation"}} {
		if _, err := VerifyTrustPolicyUpdate(data, signPolicyProofs(t, data, keys...), rotationTestPolicy(t, "trust_policy.json"), options); !errors.Is(err, ErrUntrustedRelease) {
			t.Fatalf("incomplete authorization/possession: %v", err)
		}
	}
	changed := bytes.Replace(data, []byte(`"policy_revision":2`), []byte(`"policy_revision":3`), 1)
	if _, err := VerifyTrustPolicyUpdate(changed, signPolicyProofs(t, rotationTestData(t, "rotation_policy.json"), "public", "private", "rotation"), rotationTestPolicy(t, "trust_policy.json"), options); !errors.Is(err, ErrUntrustedRelease) {
		t.Fatal(err)
	}
	if _, err := VerifyTrustPolicyUpdate(data, rotationTestSignatures(t, manifest, ManifestSignatureDomain, "public", "rotation"), rotationTestPolicy(t, "trust_policy.json"), options); !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("domain substitution: %v", err)
	}
}

func TestReleaseTrustPolicyReplayAndScopeRestrictions(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*TrustPolicyV1)
		want   error
	}{
		{"equal revision", func(p *TrustPolicyV1) { p.PolicyRevision = 1 }, ErrStaleTrustPolicy},
		{"expired", func(p *TrustPolicyV1) { p.ExpiresAt = "2026-10-07T07:40:00Z" }, ErrStaleTrustPolicy},
		{"future", func(p *TrustPolicyV1) { p.IssuedAt = "2026-10-08T00:00:00Z" }, ErrStaleTrustPolicy},
		{"publisher", func(p *TrustPolicyV1) { p.Compositions[0].Publisher = "replacement" }, ErrInvalidTrustPolicy},
		{"enrollment", func(p *TrustPolicyV1) { p.Compositions = p.Compositions[:1] }, ErrInvalidTrustPolicy},
		// Keep the selected Filterest scope valid to reach the other-scope check.
		{"composition substitution", func(p *TrustPolicyV1) { p.Compositions[1].ID = "replacement" }, ErrUntrustedRelease},
		{"no live signing key", func(p *TrustPolicyV1) {
			for i := range p.Compositions[0].Keys {
				p.Compositions[0].Keys[i].Revoked = true
			}
		}, ErrUntrustedRelease},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, err := ParseTrustPolicy(rotationTestData(t, "rotation_policy.json"))
			if err != nil {
				t.Fatal(err)
			}
			test.mutate(p)
			data := canonicalContractJSON(t, p)
			if _, err := VerifyTrustPolicyUpdate(data, signPolicyProofs(t, data, "public", "private", "rotation"), rotationTestPolicy(t, "trust_policy.json"), contractOptions("filterest")); !errors.Is(err, test.want) {
				t.Fatalf("got %v want %v", err, test.want)
			}
		})
	}
	// A revoked key is never reinstated or forgotten by authenticated policy updates.
	current, err := ParseTrustPolicy(rotationTestData(t, "rotation_policy.json"))
	if err != nil {
		t.Fatal(err)
	}
	current.Compositions[0].Keys[0].Revoked = true
	next, err := ParseTrustPolicy(rotationTestData(t, "rotation_policy.json"))
	if err != nil {
		t.Fatal(err)
	}
	next.PolicyRevision = 3
	data := canonicalContractJSON(t, next)
	if _, err := VerifyTrustPolicyUpdate(data, signPolicyProofs(t, data, "public", "private", "rotation"), current, contractOptions("filterest")); !errors.Is(err, ErrInvalidTrustPolicy) {
		t.Fatalf("revocation reinstated: %v", err)
	}
	next.Compositions[0].Keys = next.Compositions[0].Keys[1:]
	data = canonicalContractJSON(t, next)
	if _, err := VerifyTrustPolicyUpdate(data, signPolicyProofs(t, data, "private", "rotation"), current, contractOptions("filterest")); !errors.Is(err, ErrInvalidTrustPolicy) {
		t.Fatalf("revocation forgotten: %v", err)
	}
}

func TestReleaseTrustRotationRetiresKeysOnlyWithTombstones(t *testing.T) {
	current := rotationTestPolicy(t, "trust_policy.json")
	next := rotationTestPolicy(t, "rotation_policy.json")
	dropped := next.Compositions[0].Keys[0]
	next.Compositions[0].Keys = next.Compositions[0].Keys[1:]
	data := canonicalContractJSON(t, next)
	proofBytes := signPolicyProofs(t, data, "public", "private", "rotation")
	if _, err := VerifyTrustPolicyUpdate(data, proofBytes, current, contractOptions("filterest")); !errors.Is(err, ErrInvalidTrustPolicy) || !strings.Contains(err.Error(), "retained") {
		t.Fatalf("dropped live authorizer accepted: %v", err)
	}
	proofs, err := ParseSignatures(proofBytes, TrustPolicySignatureDomain)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyTrustPolicySignatureProofs(data, proofs, next); !errors.Is(err, ErrUntrustedRelease) {
		t.Fatalf("dropped authorizer proof accepted: %v", err)
	}
	dropped.Revoked = true
	next.Compositions[0].Keys = append(next.Compositions[0].Keys, dropped)
	data = canonicalContractJSON(t, next)
	proofBytes = signPolicyProofs(t, data, "public", "private", "rotation")
	if _, err := VerifyTrustPolicyUpdate(data, proofBytes, current, contractOptions("filterest")); err != nil {
		t.Fatalf("retained tombstone rotation refused: %v", err)
	}
	proofs, err = ParseSignatures(proofBytes, TrustPolicySignatureDomain)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyTrustPolicySignatureProofs(data, proofs, next); err != nil {
		t.Fatalf("tombstone authorizer proof refused: %v", err)
	}
}

func TestReleaseTrustRotationRejectsPublicTestOnlyKeys(t *testing.T) {
	for _, name := range []string{"public", "private", "rotation", "wrong"} {
		for _, revoked := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/revoked=%t", name, revoked), func(t *testing.T) {
				current := rotationTestPolicy(t, "trust_policy.json")
				next := rotationTestPolicy(t, "rotation_policy.json")
				fixture := next.Compositions[0].Keys[0]
				public := contractFixtureKey(t, name).Public().(ed25519.PublicKey)
				fixture.PublicKey, fixture.Fingerprint = base64.StdEncoding.EncodeToString(public), KeyFingerprint(public)
				fixture.Revoked = revoked
				next.Compositions[0].Keys = append(next.Compositions[0].Keys, fixture)
				data := canonicalContractJSON(t, next)
				proofs, err := ParseSignatures(signPolicyProofs(t, data, "public", "private", "rotation"), TrustPolicySignatureDomain)
				if err != nil {
					t.Fatal(err)
				}
				fixtureProof, err := SignTrustPolicy(data, contractFixtureKey(t, name))
				if err != nil {
					t.Fatal(err)
				}
				proofs, err = MergeSignatures(proofs, fixtureProof)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := VerifyTrustPolicyUpdate(data, contractJSON(t, proofs), current, contractOptions("filterest")); !errors.Is(err, ErrInvalidTrustPolicy) || !strings.Contains(err.Error(), "test-only") {
					t.Fatalf("rotation enrolled fixture key: %v", err)
				}
				current.Compositions[0].Keys = append(current.Compositions[0].Keys, fixture)
				if _, err := VerifyTrustPolicyUpdate(data, contractJSON(t, proofs), current, contractOptions("filterest")); !errors.Is(err, ErrInvalidTrustPolicy) || !strings.Contains(err.Error(), "test-only") {
					t.Fatalf("rotation trusted current fixture key: %v", err)
				}
			})
		}
	}
}

func TestReleaseTrustPolicyStrictParsing(t *testing.T) {
	data := contractFixture(t, "trust_policy.json")
	for _, malformed := range [][]byte{bytes.Replace(data, []byte(`"policy_revision":1`), []byte(`"policy_revision":1,"policy_revision":1`), 1), bytes.Replace(data, []byte(`"revoked":false`), []byte(`"revoked":false,"revoked":false`), 1), append(append([]byte{}, data...), []byte(`{}`)...), bytes.Replace(data, []byte(`,"revoked":false`), nil, 1), bytes.Replace(data, []byte(`"policy_type":`), []byte(`"unknown":1,"policy_type":`), 1)} {
		if _, err := ParseTrustPolicy(malformed); !errors.Is(err, ErrInvalidTrustPolicy) {
			t.Fatalf("invalid policy accepted: %v", err)
		}
	}
	for _, mutate := range []func(*TrustPolicyV1){func(p *TrustPolicyV1) { p.SchemaVersion = 2 }, func(p *TrustPolicyV1) { p.Compositions[1].ID = p.Compositions[0].ID }, func(p *TrustPolicyV1) { p.Compositions[0].Keys[0].NotAfter = p.Compositions[0].Keys[0].NotBefore }, func(p *TrustPolicyV1) { p.ExpiresAt = p.IssuedAt }, func(p *TrustPolicyV1) {
		p.Compositions[0].Keys[0].PublicKey = base64.StdEncoding.EncodeToString(make([]byte, ed25519.PublicKeySize))
	}} {
		p := contractFixturePolicy(t)
		mutate(p)
		if _, err := ParseTrustPolicy(contractJSON(t, p)); !errors.Is(err, ErrInvalidTrustPolicy) {
			t.Fatalf("invalid policy accepted: %v", err)
		}
	}
}

func TestReleaseTrustPolicyProtectedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "operator-policy.json")
	policy := contractFixturePolicy(t)
	for i := range policy.Compositions {
		public, _, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		policy.Compositions[i].Keys[0].PublicKey = base64.StdEncoding.EncodeToString(public)
		policy.Compositions[i].Keys[0].Fingerprint = KeyFingerprint(public)
	}
	if err := os.WriteFile(path, contractJSON(t, policy), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadTrustPolicyFile(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0666); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadTrustPolicyFile(path); !errors.Is(err, ErrInvalidTrustPolicy) {
		t.Fatal("writable shared policy accepted")
	}
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	link := path + ".link"
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadTrustPolicyFile(link); !errors.Is(err, ErrInvalidTrustPolicy) {
		t.Fatal("symlink policy accepted")
	}
}

func TestReleaseTrustRotationEnrollsFutureKeyWithoutEarlyUse(t *testing.T) {
	next, err := ParseTrustPolicy(rotationTestData(t, "rotation_policy.json"))
	if err != nil {
		t.Fatal(err)
	}
	next.Compositions[0].Keys[1].NotBefore = "2026-10-08T00:00:00Z"
	data := canonicalContractJSON(t, next)
	policy, err := VerifyTrustPolicyUpdate(data, signPolicyProofs(t, data, "public", "private", "rotation"), rotationTestPolicy(t, "trust_policy.json"), contractOptions("filterest"))
	if err != nil {
		t.Fatal(err)
	}
	manifest := contractFixture(t, "public_manifest.json")
	if _, err := VerifyManifest(manifest, rotationTestSignatures(t, manifest, ManifestSignatureDomain, "rotation"), policy, contractOptions("filterest")); !errors.Is(err, ErrUntrustedRelease) {
		t.Fatal("future key authenticated a release early")
	}
	if _, err := VerifyManifest(manifest, rotationTestSignatures(t, manifest, ManifestSignatureDomain, "public"), policy, contractOptions("filterest")); err != nil {
		t.Fatal(err)
	}
}

func TestReleaseTrustFileRejectsPublicTestOnlyKeys(t *testing.T) {
	for _, name := range []string{"public", "private", "rotation", "wrong"} {
		t.Run(name, func(t *testing.T) {
			policy := contractFixturePolicy(t)
			policy.Compositions = policy.Compositions[:1]
			public := contractFixtureKey(t, name).Public().(ed25519.PublicKey)
			policy.Compositions[0].Keys[0].PublicKey = base64.StdEncoding.EncodeToString(public)
			policy.Compositions[0].Keys[0].Fingerprint = KeyFingerprint(public)
			path := filepath.Join(t.TempDir(), "policy.json")
			if err := os.WriteFile(path, contractJSON(t, policy), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := ReadTrustPolicyFile(path); !errors.Is(err, ErrInvalidTrustPolicy) || !strings.Contains(err.Error(), "test-only") {
				t.Fatalf("test-only key accepted: %v", err)
			}
		})
	}
}

func TestReleaseTrustRotationAuthenticatesBeforeParsing(t *testing.T) {
	malformed := []byte(`{"broken":`)
	if _, err := VerifyTrustPolicyUpdate(malformed, signPolicyProofs(t, rotationTestData(t, "rotation_policy.json"), "public", "private", "rotation"), rotationTestPolicy(t, "trust_policy.json"), contractOptions("filterest")); !errors.Is(err, ErrUntrustedRelease) {
		t.Fatalf("parsed unauthenticated instructions: %v", err)
	}
	proofs := []*SignatureEnvelopeV1{}
	for _, name := range []string{"public", "private"} {
		key := rotationTestKey(name)
		proofs = append(proofs, &SignatureEnvelopeV1{SchemaVersion: 1, SignatureType: "ed25519_detached", Domain: TrustPolicySignatureDomain, Signatures: []DetachedSignatureV1{{KeyFingerprint: KeyFingerprint(key.Public().(ed25519.PublicKey)), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, signatureMessage(TrustPolicySignatureDomain, malformed)))}}})
	}
	merged, err := MergeSignatures(proofs...)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyTrustPolicyUpdate(malformed, contractJSON(t, merged), rotationTestPolicy(t, "trust_policy.json"), contractOptions("filterest")); !errors.Is(err, ErrInvalidTrustPolicy) {
		t.Fatalf("authenticated malformed policy: %v", err)
	}
	current := rotationTestPolicy(t, "trust_policy.json")
	current.ExpiresAt = "2026-10-07T07:40:00Z"
	if _, err := VerifyTrustPolicyUpdate(rotationTestData(t, "rotation_policy.json"), signPolicyProofs(t, rotationTestData(t, "rotation_policy.json"), "public", "private", "rotation"), current, contractOptions("filterest")); !errors.Is(err, ErrStaleTrustPolicy) {
		t.Fatalf("rotation using expired current policy: %v", err)
	}
}

func TestReleaseTrustRevokeReplaceAndLaterRotationRetainsTombstones(t *testing.T) {
	next, err := ParseTrustPolicy(rotationTestData(t, "rotation_policy.json"))
	if err != nil {
		t.Fatal(err)
	}
	next.Compositions[0].Keys[0].Revoked = true
	data := canonicalContractJSON(t, next)
	current, err := VerifyTrustPolicyUpdate(data, signPolicyProofs(t, data, "public", "private", "rotation"), rotationTestPolicy(t, "trust_policy.json"), contractOptions("filterest"))
	if err != nil {
		t.Fatal(err)
	}
	next.PolicyRevision = 3
	next.Compositions[0].Keys[1].Revoked = true
	replacement := next.Compositions[0].Keys[1]
	replacement.Revoked = false
	public := rotationTestKey("wrong").Public().(ed25519.PublicKey)
	replacement.PublicKey = base64.StdEncoding.EncodeToString(public)
	replacement.Fingerprint = KeyFingerprint(public)
	next.Compositions[0].Keys = append(next.Compositions[0].Keys, replacement)
	data = canonicalContractJSON(t, next)
	verified, err := VerifyTrustPolicyUpdate(data, signPolicyProofs(t, data, "rotation", "private", "wrong"), current, contractOptions("filterest"))
	if err != nil {
		t.Fatal(err)
	}
	if !verified.Compositions[0].Keys[0].Revoked || !verified.Compositions[0].Keys[1].Revoked {
		t.Fatal("tombstones lost")
	}
	next.Compositions[0].Keys = next.Compositions[0].Keys[1:]
	data = canonicalContractJSON(t, next)
	if _, err := VerifyTrustPolicyUpdate(data, signPolicyProofs(t, data, "rotation", "private", "wrong"), current, contractOptions("filterest")); !errors.Is(err, ErrInvalidTrustPolicy) {
		t.Fatalf("later rotation dropped tombstone: %v", err)
	}
}
