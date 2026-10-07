// release_manifest_signer_test.go
// Tests encrypted key custody and canonical domain-separated signing.
// Connects fixed test passphrases and in-memory fixture keys to offline outputs.
// Guards key encryption, tamper rejection, exclusive creation and proof merging.
package release_updates

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReleaseSigningEncryptedKeyRoundtrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "offline-signing-key.container")
	publicPath := path + ".public"
	passphrase := []byte("fixed TEST ONLY passphrase")
	public, err := GenerateSigningKeyFile(path, publicPath, passphrase)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("permissions: %v", err)
	}
	key, err := ReadSigningKeyFile(path, passphrase)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(key)
	printed, err := ReadSigningKeyPublicFile(path, passphrase)
	if err != nil || !bytes.Equal(printed, public) || !bytes.Equal(public, key.Public().(ed25519.PublicKey)) {
		t.Fatalf("public identity: %v", err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(before, passphrase) || bytes.Contains(before, key[:32]) || bytes.Contains(before, []byte("BEGIN PRIVATE KEY")) {
		t.Fatal("plaintext leaked to container")
	}
	if _, err := GenerateSigningKeyFile(path, publicPath, passphrase); err == nil {
		t.Fatal("existing output replaced")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("existing key changed")
	}
	if _, err := ReadSigningKeyFile(path, []byte("wrong")); err == nil {
		t.Fatal("wrong passphrase accepted")
	}
	if _, err := ReadSigningKeyFile(path, nil); err == nil {
		t.Fatal("empty passphrase accepted")
	}
	if _, err := EncryptSigningKey(key, nil); err == nil {
		t.Fatal("empty encryption passphrase accepted")
	}
	if _, err := EncryptSigningKey(ed25519.PrivateKey{}, passphrase); err == nil {
		t.Fatal("invalid encryption key accepted")
	}
	if _, err := SignManifest(contractFixture(t, "public_manifest.json"), ed25519.PrivateKey{}); err == nil {
		t.Fatal("invalid signing key accepted")
	}
}

func TestReleaseSigningContainerTamperAndPlainKeyRefusal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test-only.container")
	passphrase := []byte("fixed TEST ONLY passphrase")
	key := contractFixtureKey(t, "public")
	encoded, err := EncryptSigningKey(key, passphrase)
	if err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*signingKeyContainerV1){
		"ciphertext": func(c *signingKeyContainerV1) {
			raw, _ := base64.StdEncoding.DecodeString(c.Ciphertext)
			raw[0] ^= 1
			c.Ciphertext = base64.StdEncoding.EncodeToString(raw)
		},
		"nonce": func(c *signingKeyContainerV1) {
			raw, _ := base64.StdEncoding.DecodeString(c.Header.Nonce)
			raw[0] ^= 1
			c.Header.Nonce = base64.StdEncoding.EncodeToString(raw)
		},
		"salt": func(c *signingKeyContainerV1) {
			raw, _ := base64.StdEncoding.DecodeString(c.Header.KDF.Salt)
			raw[0] ^= 1
			c.Header.KDF.Salt = base64.StdEncoding.EncodeToString(raw)
		},
		"public key and fingerprint": func(c *signingKeyContainerV1) {
			pub := contractFixtureKey(t, "private").Public().(ed25519.PublicKey)
			c.Header.PublicKey = base64.StdEncoding.EncodeToString(pub)
			c.Header.Fingerprint = KeyFingerprint(pub)
		},
		"fingerprint":     func(c *signingKeyContainerV1) { c.Header.Fingerprint = strings.Repeat("f", 64) },
		"format":          func(c *signingKeyContainerV1) { c.Header.Format = "other" },
		"version":         func(c *signingKeyContainerV1) { c.Header.Version = 2 },
		"huge memory":     func(c *signingKeyContainerV1) { c.Header.KDF.MemoryKiB = 1 << 31 },
		"huge iterations": func(c *signingKeyContainerV1) { c.Header.KDF.Iterations = 1 << 31 },
		"parallelism":     func(c *signingKeyContainerV1) { c.Header.KDF.Parallelism = 0 },
		"KDF AAD":         func(c *signingKeyContainerV1) { c.Header.KDF.Iterations = 2 },
	} {
		t.Run(name, func(t *testing.T) {
			var c signingKeyContainerV1
			if err := json.Unmarshal(encoded, &c); err != nil {
				t.Fatal(err)
			}
			mutate(&c)
			if err := os.WriteFile(path, contractJSON(t, c), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := ReadSigningKeyFile(path, passphrase); err == nil {
				t.Fatal("tampering accepted")
			}
			if _, err := ReadSigningKeyPublicFile(path, passphrase); err == nil {
				t.Fatal("unauthenticated public identity returned")
			}
		})
	}
	for _, plain := range [][]byte{plainTestSigningKey(t, key), []byte("not a container")} {
		if err := os.WriteFile(path, plain, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := ReadSigningKeyFile(path, passphrase); err == nil {
			t.Fatal("plain key accepted")
		}
	}
}

func TestReleaseSigningDomainPrefixIndependentProof(t *testing.T) {
	data := contractFixture(t, "public_manifest.json")
	key := contractFixtureKey(t, "public")
	envelope, err := SignManifest(data, key)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := base64.StdEncoding.DecodeString(envelope.Signatures[0].Signature)
	if err != nil {
		t.Fatal(err)
	}
	message := append([]byte("filterest-release-manifest/v1\x00"), data...)
	if !ed25519.Verify(key.Public().(ed25519.PublicKey), message, proof) {
		t.Fatal("signer did not use the exact v1 domain prefix and bytes")
	}
	for _, badMessage := range [][]byte{data, append([]byte("filterest-release-manifest/v1"), data...), append([]byte("filterest-release-trust-policy/v1\x00"), data...)} {
		envelope.Signatures[0].Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(key, badMessage))
		if _, err := VerifyManifest(data, contractJSON(t, envelope), contractFixturePolicy(t), contractOptions("filterest")); err == nil {
			t.Fatal("wrong or absent signature domain prefix accepted")
		}
	}
}

func TestReleaseSigningCanonicalInputAndRotation(t *testing.T) {
	data := contractFixture(t, "public_manifest.json")
	key := contractFixtureKey(t, "public")
	for _, noncanonical := range [][]byte{data[:len(data)-1], append([]byte(" "), data...), bytes.Replace(data, []byte(`"schema_version":1`), []byte(`"schema_version": 1`), 1)} {
		if _, err := SignManifest(noncanonical, key); err == nil {
			t.Fatal("noncanonical signing input accepted")
		}
	}
	old, err := SignManifest(data, key)
	if err != nil {
		t.Fatal(err)
	}
	next, err := SignManifest(data, contractFixtureKey(t, "rotation"))
	if err != nil {
		t.Fatal(err)
	}
	merged, err := MergeSignatures(old, next)
	if err != nil {
		t.Fatal(err)
	}
	if len(merged.Signatures) != 2 {
		t.Fatal("rotation proofs lost")
	}
	if _, err := MergeSignatures(old, old); err == nil {
		t.Fatal("duplicate signer accepted")
	}
	if _, err := MergeSignatures(); err == nil {
		t.Fatal("empty signatures accepted")
	}
	policyProof, err := SignTrustPolicy(contractFixture(t, "trust_policy.json"), key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := MergeSignatures(old, policyProof); err == nil {
		t.Fatal("mixed signature domains accepted")
	}
}

// Plain bytes exist only to prove rejection, never for successful CLI signing.
func plainTestSigningKey(t *testing.T, key ed25519.PrivateKey) []byte {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
}
