// main_test.go
// Checks offline CLI key custody, operation order and failed-step reports.
// Connects encrypted test-only containers and injected readers to command behavior.
// Guards terminal-only production reads, public-first outputs and appended proofs.
package main

import (
	"bytes"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"golang.org/x/sys/unix"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	releaseupdates "easelect/backend/core_components/release_updates"
)

func signingFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "backend", "core_components", "release_updates", "testdata", "test_only", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestSigningUtilityPublicAndPrivateEnvironmentPaths(t *testing.T) {
	for _, test := range []struct{ product, fixture, variable string }{{"filterest", "public", "FILTEREST_RELEASE_SIGNING_KEY_FILE"}, {"easelect", "private", "EASELECT_RELEASE_SIGNING_KEY_FILE"}} {
		t.Run(test.product, func(t *testing.T) {
			dir := t.TempDir()
			keyPath := filepath.Join(dir, "signing.container")
			publicPath := filepath.Join(dir, "public-key.txt")
			t.Setenv("FILTEREST_RELEASE_SIGNING_KEY_FILE", "")
			t.Setenv("EASELECT_RELEASE_SIGNING_KEY_FILE", "")
			t.Setenv(test.variable, keyPath)
			var output bytes.Buffer
			if code := runTest([]string{"keygen", "--product", test.product, "--public-key-file", publicPath}, &output); code != 0 {
				t.Fatalf("key generation: %d %s", code, output.String())
			}
			secret, err := os.ReadFile(keyPath)
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(output.Bytes(), secret) || strings.Contains(output.String(), "BEGIN PRIVATE KEY") {
				t.Fatal("key material logged")
			}
			if code := runTest([]string{"keygen", "--product", test.product, "--public-key-file", publicPath}, &output); code == 0 {
				t.Fatal("key overwritten")
			}
			manifestPath := filepath.Join(dir, "manifest.json")
			if err := os.WriteFile(manifestPath, signingFixture(t, test.fixture+"_manifest.json"), 0600); err != nil {
				t.Fatal(err)
			}
			signaturePath := filepath.Join(dir, "signatures.json")
			output.Reset()
			args := []string{"sign", "--product", test.product, "--input-file", manifestPath, "--output-file", signaturePath}
			if code := runTest(args, &output); code != 0 {
				t.Fatalf("signing: %d %s", code, output.String())
			}
			proof, err := os.ReadFile(signaturePath)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := releaseupdates.ParseSignatures(proof, releaseupdates.ManifestSignatureDomain); err != nil {
				t.Fatal(err)
			}
			if code := runTest(args, &output); code == 0 {
				t.Fatal("signature overwritten")
			}
			if strings.Contains(output.String(), "BEGIN PRIVATE KEY") {
				t.Fatal("private key logged")
			}
		})
	}
}

func TestSigningUtilityFixturesRotationAndFailures(t *testing.T) {
	dir := t.TempDir()
	keyPath := filepath.Join(dir, "test-only.container")
	if err := os.WriteFile(keyPath, signingFixture(t, "rotation.test-only.container.json"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FILTEREST_RELEASE_SIGNING_KEY_FILE", keyPath)
	input := filepath.Join(dir, "manifest.json")
	if err := os.WriteFile(input, signingFixture(t, "public_manifest.json"), 0600); err != nil {
		t.Fatal(err)
	}
	prior := filepath.Join(dir, "prior.json")
	if err := os.WriteFile(prior, signingFixture(t, "public_signatures.json"), 0600); err != nil {
		t.Fatal(err)
	}
	result := filepath.Join(dir, "result.json")
	var output bytes.Buffer
	if code := runTest([]string{"sign", "--product", "filterest", "--input-file", input, "--output-file", result, "--append-signatures-file", prior}, &output); code != 0 {
		t.Fatalf("rotation: %d %s", code, output.String())
	}
	policy, err := releaseupdates.ParseTrustPolicy(signingFixture(t, "rotation_policy.json"))
	if err != nil {
		t.Fatal(err)
	}
	proof, err := os.ReadFile(result)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := releaseupdates.VerifyManifest(signingFixture(t, "public_manifest.json"), proof, policy, releaseupdates.VerificationOptions{CompositionID: "filterest", MinimumTrustPolicyRevision: 2, Now: time.Date(2026, 10, 7, 7, 40, 0, 0, time.UTC)}); err != nil {
		t.Fatal(err)
	}
	privateInput := filepath.Join(dir, "private.json")
	if err := os.WriteFile(privateInput, signingFixture(t, "private_manifest.json"), 0600); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	if code := runTest([]string{"sign", "--product", "filterest", "--input-file", privateInput, "--output-file", filepath.Join(dir, "forbidden.json")}, &output); code != 1 {
		t.Fatalf("cross-product signing accepted: %d", code)
	}
	if strings.Contains(output.String(), "2/3:") {
		t.Fatal("signed after composition mismatch")
	}
	t.Setenv("FILTEREST_RELEASE_SIGNING_KEY_FILE", "")
	if code := runTest([]string{"sign", "--product", "filterest", "--input-file", input, "--output-file", result}, &output); code != 2 {
		t.Fatal("missing signing key path accepted")
	}
	if code := runTest([]string{"unknown"}, &output); code != 2 {
		t.Fatal("invalid operation accepted")
	}
}

func TestSigningUtilityPolicyAndPartialOutcome(t *testing.T) {
	dir := t.TempDir()
	keyPath := filepath.Join(dir, "test-only.container")
	if err := os.WriteFile(keyPath, signingFixture(t, "public.test-only.container.json"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FILTEREST_RELEASE_SIGNING_KEY_FILE", keyPath)
	input := filepath.Join(dir, "policy.json")
	if err := os.WriteFile(input, signingFixture(t, "rotation_policy.json"), 0600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if code := runTest([]string{"sign-policy", "--product", "filterest", "--input-file", input, "--output-file", filepath.Join(dir, "proof.json")}, &output); code != 0 {
		t.Fatalf("policy signing: %d %s", code, output.String())
	}
	newKey := filepath.Join(dir, "new-key.container")
	t.Setenv("FILTEREST_RELEASE_SIGNING_KEY_FILE", newKey)
	output.Reset()
	if code := runTest([]string{"keygen", "--product", "filterest", "--public-key-file", dir}, &output); code != 1 {
		t.Fatal("public-key output failure claimed success")
	}
	if !strings.Contains(output.String(), "failed step 1 (create public-key output)") {
		t.Fatal("partial key-generation state was hidden")
	}
	if _, err := os.Stat(newKey); !os.IsNotExist(err) {
		t.Fatal("private container created despite public-output failure")
	}
}

// Tests alone inject a fixed passphrase. The CLI cannot select this reader.
func runTest(arguments []string, output *bytes.Buffer) int {
	return runWithPassphraseReader(arguments, output, func(string) ([]byte, error) { return []byte("fixed TEST ONLY passphrase"), nil })
}

func TestSigningUtilityStepOnePrecedesKeyAndPassphrase(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "document.json")
	t.Setenv("FILTEREST_RELEASE_SIGNING_KEY_FILE", filepath.Join(dir, "missing-key"))
	for _, document := range [][]byte{
		append([]byte(" "), signingFixture(t, "public_manifest.json")...),
		bytes.TrimSuffix(signingFixture(t, "public_manifest.json"), []byte("\n")),
	} {
		if err := os.WriteFile(input, document, 0600); err != nil {
			t.Fatal(err)
		}
		var output bytes.Buffer
		code := runWithPassphraseReader([]string{"sign", "--product", "filterest", "--input-file", input, "--output-file", filepath.Join(dir, "out")}, &output, func(string) ([]byte, error) { t.Fatal("asked for passphrase before canonical check"); return nil, nil })
		if code != 1 || !strings.Contains(output.String(), "failed step 1") || !strings.Contains(output.String(), "canonical") {
			t.Fatalf("%d %s", code, output.String())
		}
	}
	if err := os.WriteFile(input, signingFixture(t, "trust_policy.json"), 0600); err != nil {
		t.Fatal(err)
	}
	var p releaseupdates.TrustPolicyV1
	if err := json.Unmarshal(signingFixture(t, "trust_policy.json"), &p); err != nil {
		t.Fatal(err)
	}
	p.Compositions = p.Compositions[1:]
	data, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(input, data, 0600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if code := runTest([]string{"sign-policy", "--product", "filterest", "--input-file", input, "--output-file", filepath.Join(dir, "out")}, &output); code != 1 || !strings.Contains(output.String(), "not enrolled") || strings.Contains(output.String(), "2/3:") {
		t.Fatalf("product absent from policy: %d %s", code, output.String())
	}
}

func TestSigningUtilityPassphraseFailuresAndPublicCommand(t *testing.T) {
	dir := t.TempDir()
	keyPath := filepath.Join(dir, "key.container")
	publicPath := filepath.Join(dir, "public")
	t.Setenv("FILTEREST_RELEASE_SIGNING_KEY_FILE", keyPath)
	for _, test := range []struct {
		name   string
		values []string
		want   string
	}{{"mismatch", []string{"first long passphrase", "second long passphrase"}, "do not match"}, {"empty", []string{""}, "must not be empty"}, {"short", []string{"elevenchars"}, "at least 12 characters"}} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			var output bytes.Buffer
			code := runWithPassphraseReader([]string{"keygen", "--product", "filterest", "--public-key-file", publicPath}, &output, func(string) ([]byte, error) { value := test.values[calls]; calls++; return []byte(value), nil })
			if code != 1 || !strings.Contains(output.String(), test.want) || !strings.Contains(output.String(), "failed step 1") {
				t.Fatalf("%d %s", code, output.String())
			}
			if _, err := os.Stat(keyPath); !os.IsNotExist(err) {
				t.Fatal("container written without confirmed passphrase")
			}
			if _, err := os.Stat(publicPath); !os.IsNotExist(err) {
				t.Fatal("public written without confirmed passphrase")
			}
		})
	}
	if err := os.WriteFile(keyPath, signingFixture(t, "public.test-only.container.json"), 0600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	calls := 0
	code := runWithPassphraseReader([]string{"fingerprint", "--product", "filterest"}, &output, func(string) ([]byte, error) { calls++; return []byte("fixed TEST ONLY passphrase"), nil })
	if code != 0 || calls != 1 || !strings.Contains(output.String(), "Public key:") || !strings.Contains(output.String(), "33b87fb9373923c2d9fbf65e4b79a7951181402f797dc339c38e8a310e15dab4") {
		t.Fatalf("%d %s", code, output.String())
	}
	input := filepath.Join(dir, "manifest.json")
	if err := os.WriteFile(input, signingFixture(t, "public_manifest.json"), 0600); err != nil {
		t.Fatal(err)
	}
	args := []string{"sign", "--product", "filterest", "--input-file", input, "--output-file", filepath.Join(dir, "out")}
	output.Reset()
	code = runWithPassphraseReader(args, &output, func(string) ([]byte, error) { return []byte("wrong passphrase"), nil })
	if code != 1 || !strings.Contains(output.String(), "failed step 2") || !strings.Contains(output.String(), "wrong passphrase") {
		t.Fatalf("%d %s", code, output.String())
	}
	output.Reset()
	code = runWithPassphraseReader(args, &output, func(string) ([]byte, error) { return nil, errors.New("no controlling terminal") })
	if code != 1 || !strings.Contains(output.String(), "failed step 2") {
		t.Fatalf("%d %s", code, output.String())
	}
	// A well-shaped container with tampered ciphertext fails during unlock.
	var container map[string]any
	if err := json.Unmarshal(signingFixture(t, "public.test-only.container.json"), &container); err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(container["ciphertext"].(string))
	if err != nil {
		t.Fatal(err)
	}
	raw[0] ^= 1
	container["ciphertext"] = base64.StdEncoding.EncodeToString(raw)
	tampered, err := json.Marshal(container)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, tampered, 0600); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	if code := runTest(args, &output); code != 1 || !strings.Contains(output.String(), "failed step 2") || !strings.Contains(output.String(), "tampered container") {
		t.Fatalf("tampered CLI container: %d %s", code, output.String())
	}
	// Plain PKCS#8 is refused before prompting even with owner-only permissions.
	if err := os.WriteFile(keyPath, signingFixture(t, "public.test-only.container.json"), 0600); err != nil {
		t.Fatal(err)
	}
	testKey, err := releaseupdates.ReadSigningKeyFile(keyPath, []byte("fixed TEST ONLY passphrase"))
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(testKey)
	clear(testKey)
	if err != nil {
		t.Fatal(err)
	}
	plain := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	if err := os.WriteFile(keyPath, plain, 0600); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	code = runWithPassphraseReader(args, &output, func(string) ([]byte, error) { t.Fatal("plain key prompted for passphrase"); return nil, nil })
	if code != 1 || !strings.Contains(output.String(), "failed step 2") || !strings.Contains(output.String(), "plain PKCS#8") {
		t.Fatalf("%d %s", code, output.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "out")); !os.IsNotExist(err) {
		t.Fatal("failed signing published output")
	}
}

func TestSigningFingerprintAuthenticatesPublicIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key.container")
	t.Setenv("FILTEREST_RELEASE_SIGNING_KEY_FILE", path)
	original := signingFixture(t, "public.test-only.container.json")
	for _, test := range []struct {
		name       string
		mutate     func(map[string]any)
		passphrase string
	}{{"wrong passphrase", nil, "wrong passphrase"}, {"rewritten clear identity", func(container map[string]any) {
		var other map[string]any
		if err := json.Unmarshal(signingFixture(t, "private.test-only.container.json"), &other); err != nil {
			t.Fatal(err)
		}
		header, otherHeader := container["header"].(map[string]any), other["header"].(map[string]any)
		header["public_key"], header["fingerprint"] = otherHeader["public_key"], otherHeader["fingerprint"]
	}, "fixed TEST ONLY passphrase"}} {
		t.Run(test.name, func(t *testing.T) {
			var container map[string]any
			if err := json.Unmarshal(original, &container); err != nil {
				t.Fatal(err)
			}
			if test.mutate != nil {
				test.mutate(container)
			}
			encoded, err := json.Marshal(container)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, encoded, 0600); err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			code := runWithPassphraseReader([]string{"fingerprint", "--product", "filterest"}, &output, func(string) ([]byte, error) { return []byte(test.passphrase), nil })
			if code != 1 || !strings.Contains(output.String(), "unlock container public identity") || strings.Contains(output.String(), "Fingerprint:") || strings.Contains(output.String(), "Public key:") {
				t.Fatalf("unauthenticated fingerprint distributed: %d %s", code, output.String())
			}
		})
	}
}

func TestSigningUtilityAppendProofFailures(t *testing.T) {
	for _, command := range []string{"sign", "sign-policy"} {
		t.Run(command, func(t *testing.T) {
			dir := t.TempDir()
			keyPath := filepath.Join(dir, "key")
			input := filepath.Join(dir, "input")
			prior := filepath.Join(dir, "prior")
			out := filepath.Join(dir, "output")
			t.Setenv("FILTEREST_RELEASE_SIGNING_KEY_FILE", keyPath)
			if err := os.WriteFile(keyPath, signingFixture(t, "rotation.test-only.container.json"), 0600); err != nil {
				t.Fatal(err)
			}
			fixture := "public_manifest.json"
			if command == "sign-policy" {
				fixture = "rotation_policy.json"
			}
			if err := os.WriteFile(input, signingFixture(t, fixture), 0600); err != nil {
				t.Fatal(err)
			}
			for _, bad := range [][]byte{[]byte(`{"broken":`), []byte(`{"schema_version":1,"signature_type":"ed25519_detached","domain":"filterest-release-trust-policy/v1","signatures":[]}`)} {
				if err := os.WriteFile(prior, bad, 0600); err != nil {
					t.Fatal(err)
				}
				var output bytes.Buffer
				if code := runTest([]string{command, "--product", "filterest", "--input-file", input, "--output-file", out, "--append-signatures-file", prior}, &output); code != 1 || !strings.Contains(output.String(), "failed step 2") {
					t.Fatalf("%d %s", code, output.String())
				}
				if _, err := os.Stat(out); !os.IsNotExist(err) {
					t.Fatal("failed proof published output")
				}
			}
		})
	}
	dir := t.TempDir()
	keyPath := filepath.Join(dir, "key")
	input := filepath.Join(dir, "input")
	prior := filepath.Join(dir, "prior")
	out := filepath.Join(dir, "output")
	t.Setenv("FILTEREST_RELEASE_SIGNING_KEY_FILE", keyPath)
	if err := os.WriteFile(keyPath, signingFixture(t, "rotation.test-only.container.json"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(input, signingFixture(t, "rotation_policy.json"), 0600); err != nil {
		t.Fatal(err)
	}
	var envelope releaseupdates.SignatureEnvelopeV1
	if err := json.Unmarshal(signingFixture(t, "rotation_policy_signatures.json"), &envelope); err != nil {
		t.Fatal(err)
	}
	// Remove the locally added rotation proof; keep both authorizers.
	envelope.Signatures = envelope.Signatures[:2]
	data, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(prior, data, 0600); err != nil {
		t.Fatal(err)
	}
	args := []string{"sign-policy", "--product", "filterest", "--input-file", input, "--output-file", out, "--append-signatures-file", prior}
	var output bytes.Buffer
	if code := runTest(args, &output); code != 0 {
		t.Fatalf("valid combined policy proofs: %d %s", code, output.String())
	}
	envelope.Signatures[0].KeyFingerprint = strings.Repeat("f", 64)
	data, err = json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(prior, data, 0600); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	args[6] = filepath.Join(dir, "unknown-proof-output")
	if code := runTest(args, &output); code != 1 || !strings.Contains(output.String(), "failed step 2") {
		t.Fatalf("unknown policy signer: %d %s", code, output.String())
	}
	if err := json.Unmarshal(signingFixture(t, "rotation_policy_signatures.json"), &envelope); err != nil {
		t.Fatal(err)
	}
	envelope.Signatures = envelope.Signatures[:2]
	// Structurally valid proofs must verify over these policy bytes.
	envelope.Signatures[0].Signature = strings.Repeat("A", 86) + "=="
	data, err = json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(prior, data, 0600); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	args[6] = filepath.Join(dir, "failed-output")
	if code := runTest(args, &output); code != 1 || !strings.Contains(output.String(), "failed step 2") {
		t.Fatalf("forged appended policy proof: %d %s", code, output.String())
	}
}

func TestSigningUtilityNonregularInputAndPublicFirstFailure(t *testing.T) {
	dir := t.TempDir()
	keyPath := filepath.Join(dir, "existing-key")
	publicPath := filepath.Join(dir, "new-public")
	t.Setenv("FILTEREST_RELEASE_SIGNING_KEY_FILE", keyPath)
	if err := os.WriteFile(keyPath, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if code := runTest([]string{"keygen", "--product", "filterest", "--public-key-file", publicPath}, &output); code != 1 || !strings.Contains(output.String(), "failed step 2") || !strings.Contains(output.String(), "public-key output created") {
		t.Fatalf("%d %s", code, output.String())
	}
	if _, err := os.Stat(publicPath); err != nil {
		t.Fatal("public output missing after private failure")
	}
	data, err := os.ReadFile(keyPath)
	if err != nil || string(data) != "keep" {
		t.Fatal("existing key overwritten")
	}
	for _, input := range []string{dir, filepath.Join(dir, "fifo")} {
		if input != dir {
			if err := unix.Mkfifo(input, 0600); err != nil {
				t.Fatal(err)
			}
		}
		output.Reset()
		if code := runTest([]string{"sign", "--product", "filterest", "--input-file", input, "--output-file", filepath.Join(dir, "out")}, &output); code != 1 || !strings.Contains(output.String(), "failed step 1") {
			t.Fatalf("%d %s", code, output.String())
		}
	}
}

// Run the production reader in a detached child with piped stdin; only /dev/tty
// may supply a passphrase, and no test reader is involved in this path.
func TestSigningTerminalRefusesPipedPassphrase(t *testing.T) {
	if os.Getenv("WL157_TEST_TERMINAL_CHILD") == "1" {
		_, err := readTerminalPassphrase("test prompt: ")
		if err == nil {
			fmt.Fprintln(os.Stderr, "unexpected passphrase read")
			os.Exit(1)
		}
		fmt.Fprintln(os.Stdout, err)
		os.Exit(0)
	}
	child := exec.Command(os.Args[0], "-test.run=^TestSigningTerminalRefusesPipedPassphrase$")
	child.Env = append(os.Environ(), "WL157_TEST_TERMINAL_CHILD=1")
	child.Stdin = strings.NewReader("fixed TEST ONLY passphrase\n")
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	data, err := child.CombinedOutput()
	if err != nil || !strings.Contains(string(data), "controlling terminal required") {
		t.Fatalf("terminal pipe refusal: %v %s", err, data)
	}
}
