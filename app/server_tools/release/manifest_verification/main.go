// main.go
// Exposes authoritative release authentication and migration-source inspection.
// Connects release and installation tools to independent trust and runner policies.
// Reads public evidence only; it cannot unlock keys, mutate trust or install releases.
package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"easelect/backend/core_components/migrations"
	release "easelect/backend/core_components/release_updates"
)

func main() { os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr)) }

// run keeps validation and authentication distinct: validate establishes no trust.
func run(arguments []string, input io.Reader, output, diagnostics io.Writer) int {
	if err := inspect(arguments, input, output); err != nil {
		fmt.Fprintf(diagnostics, "release contract verification failed: %v\n", err)
		return 1
	}
	return 0
}

func inspect(arguments []string, input io.Reader, output io.Writer) error {
	if len(arguments) == 1 && arguments[0] == "inspect-migrations" {
		data, err := io.ReadAll(io.LimitReader(input, (64<<20)+1))
		if err != nil || len(data) > 64<<20 {
			return errors.New("migration inspection input exceeds limit")
		}
		var sources map[string][]byte
		if err := json.Unmarshal(data, &sources); err != nil {
			return err
		}
		contracts := map[string]migrations.SourceContract{}
		for name, source := range sources {
			contracts[name] = migrations.DescribeMigrationSource(source)
		}
		return json.NewEncoder(output).Encode(contracts)
	}
	if len(arguments) == 1 && arguments[0] == "validate" {
		data, err := io.ReadAll(io.LimitReader(input, release.MaxManifestBytes+1))
		if err != nil {
			return err
		}
		if _, err := release.ParseManifest(data); err != nil {
			return err
		}
		if err := release.ValidateCanonicalReleaseJSON(data); err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(map[string]bool{"contract_valid": true})
	}
	if len(arguments) == 0 || arguments[0] != "verify" {
		return errors.New("select validate, verify or inspect-migrations")
	}
	flags := flag.NewFlagSet("verify", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	manifestPath := flags.String("manifest", "", "Canonical manifest")
	signaturesPath := flags.String("signatures", "", "Detached proofs")
	policyPath := flags.String("trust-policy", "", "Protected operator policy")
	composition := flags.String("composition", "", "Independently selected composition")
	revision := flags.Uint64("minimum-trust-policy-revision", 0, "Operator revision floor")
	if err := flags.Parse(arguments[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 || *manifestPath == "" || *signaturesPath == "" || *policyPath == "" || *composition == "" || *revision == 0 {
		return errors.New("manifest, signatures, independent trust, composition and positive revision floor are required")
	}
	policy, err := release.ReadTrustPolicyFile(*policyPath)
	if err != nil {
		return err
	}
	data, err := release.ReadReleaseInputFile(*manifestPath, release.MaxManifestBytes)
	if err != nil {
		return err
	}
	proofs, err := release.ReadReleaseInputFile(*signaturesPath, release.MaxSignatureBytes)
	if err != nil {
		return err
	}
	verified, err := release.VerifyManifest(data, proofs, policy, release.VerificationOptions{
		CompositionID: *composition, MinimumTrustPolicyRevision: *revision, Now: time.Now().UTC(),
	})
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(map[string]any{
		"manifest_sha256": verified.ManifestSHA256, "trust_policy_revision": verified.TrustPolicyRevision,
		"signatures_sha256": fmt.Sprintf("%x", sha256.Sum256(proofs)),
		"key_fingerprints":  verified.KeyFingerprints,
	})
}
