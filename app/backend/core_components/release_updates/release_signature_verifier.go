// release_signature_verifier.go
// Authenticates release manifests before interpreting their requirements.
// Connects trusted composition policy and detached proofs to canonical release bytes.
// Prevents bundle-supplied trust, scope substitution and stale-key acceptance.
package release_updates

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

const (
	ManifestSignatureDomain    = "filterest-release-manifest/v1"
	TrustPolicySignatureDomain = "filterest-release-trust-policy/v1"
	MaxSignatureBytes          = 64 << 10
)

var (
	ErrInvalidSignature = errors.New("invalid detached signature envelope")
	ErrUntrustedRelease = errors.New("release is not authenticated by composition trust")
)

// Signatures contain fingerprints only. Public keys come exclusively from local policy.
type SignatureEnvelopeV1 struct {
	SchemaVersion int                   `json:"schema_version"`
	SignatureType string                `json:"signature_type"`
	Domain        string                `json:"domain"`
	Signatures    []DetachedSignatureV1 `json:"signatures"`
}
type DetachedSignatureV1 struct {
	KeyFingerprint string `json:"key_fingerprint"`
	Signature      string `json:"signature"`
}

// VerificationOptions are trusted installation inputs, never values from a bundle.
// The revision floor must be durably retained by the operator/updater; this package
// is read-only and cannot detect rollback without that independent evidence.
type VerificationOptions struct {
	CompositionID              string
	MinimumTrustPolicyRevision uint64
	Now                        time.Time
}

// VerifiedManifest contains authenticated canonical requirements and their unique
// byte digest, with the independently provisioned trust revision and accepted keys.
type VerifiedManifest struct {
	Manifest            ManifestV1
	ManifestSHA256      string
	TrustPolicyRevision uint64
	KeyFingerprints     []string
}

// ParseSignatures validates a detached envelope without establishing trust.
func ParseSignatures(data []byte, domain string) (*SignatureEnvelopeV1, error) {
	if domain != ManifestSignatureDomain && domain != TrustPolicySignatureDomain {
		return nil, ErrInvalidSignature
	}
	return parseSignatureEnvelope(data, domain)
}

// VerifyManifest authenticates the exact received bytes with domain + NUL, then
// parses instructions. One live trusted signature is sufficient during rotation.
// No manifest timestamp can revive a key revoked/expired at verification time.
func VerifyManifest(data, signatures []byte, policy *TrustPolicyV1, options VerificationOptions) (*VerifiedManifest, error) {
	if len(data) == 0 || len(data) > MaxManifestBytes {
		return nil, ErrInvalidManifest
	}
	if err := validateTrustAt(policy, options); err != nil {
		return nil, err
	}
	scope, err := policyComposition(policy, options.CompositionID)
	if err != nil {
		return nil, err
	}
	envelope, err := parseSignatureEnvelope(signatures, ManifestSignatureDomain)
	if err != nil {
		return nil, err
	}
	matched := verifyTrustedSignatures(data, envelope, scope.Keys, options.Now)
	if len(matched) == 0 {
		return nil, ErrUntrustedRelease
	}
	manifest, err := ParseManifest(data)
	if err != nil {
		return nil, err
	}
	if err := ValidateCanonicalReleaseJSON(data); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidManifest, err)
	}
	if manifest.Composition.ID != scope.ID || manifest.Publisher != scope.Publisher {
		return nil, fmt.Errorf("%w: publisher or composition substitution", ErrUntrustedRelease)
	}
	if manifest.MinimumTrustPolicyRevision > policy.PolicyRevision {
		return nil, ErrStaleTrustPolicy
	}
	created, _ := contractTime(manifest.CreatedAt)
	if created.After(options.Now) {
		return nil, fmt.Errorf("%w: release timestamp is in the future", ErrUntrustedRelease)
	}
	valid := []string{}
	for _, key := range scope.Keys {
		if containsFingerprint(matched, key.Fingerprint) && keyLiveAt(key, created) {
			valid = append(valid, key.Fingerprint)
		}
	}
	if len(valid) == 0 {
		return nil, fmt.Errorf("%w: no key valid at release creation", ErrUntrustedRelease)
	}
	digest := sha256.Sum256(data)
	return &VerifiedManifest{Manifest: *manifest, ManifestSHA256: hex.EncodeToString(digest[:]), TrustPolicyRevision: policy.PolicyRevision, KeyFingerprints: valid}, nil
}

func parseSignatureEnvelope(data []byte, domain string) (*SignatureEnvelopeV1, error) {
	var envelope SignatureEnvelopeV1
	if err := decodeContractJSON(data, MaxSignatureBytes, &envelope); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidSignature, err)
	}
	if envelope.SchemaVersion != 1 || envelope.SignatureType != "ed25519_detached" || envelope.Domain != domain || len(envelope.Signatures) == 0 || len(envelope.Signatures) > 32 {
		return nil, ErrInvalidSignature
	}
	seen := map[string]bool{}
	for _, signature := range envelope.Signatures {
		if !contractHashPattern.MatchString(signature.KeyFingerprint) || seen[signature.KeyFingerprint] {
			return nil, ErrInvalidSignature
		}
		if _, err := decodeContractBase64(signature.Signature, ed25519.SignatureSize); err != nil {
			return nil, ErrInvalidSignature
		}
		seen[signature.KeyFingerprint] = true
	}
	return &envelope, nil
}

func verifyTrustedSignatures(data []byte, envelope *SignatureEnvelopeV1, keys []TrustedKeyV1, at time.Time) []string {
	message := signatureMessage(envelope.Domain, data)
	matched := []string{}
	for _, key := range keys {
		if keyLiveAt(key, at) && keyHasSignatureProof(message, envelope, key) {
			matched = append(matched, key.Fingerprint)
		}
	}
	return matched
}

// Possession proofs can enroll a future-dated key without allowing it to
// authenticate releases before its validity window starts.
func keyHasSignatureProof(message []byte, envelope *SignatureEnvelopeV1, key TrustedKeyV1) bool {
	for _, signature := range envelope.Signatures {
		if signature.KeyFingerprint != key.Fingerprint {
			continue
		}
		public, err := decodeContractBase64(key.PublicKey, ed25519.PublicKeySize)
		if err != nil {
			return false
		}
		proof, err := decodeContractBase64(signature.Signature, ed25519.SignatureSize)
		if err != nil {
			return false
		}
		return ed25519.Verify(ed25519.PublicKey(public), message, proof)
	}
	return false
}

// KeyFingerprint is lowercase SHA-256 of the raw 32-byte Ed25519 public key.
func KeyFingerprint(public ed25519.PublicKey) string {
	hash := sha256.Sum256(public)
	return hex.EncodeToString(hash[:])
}

func signatureMessage(domain string, data []byte) []byte {
	message := make([]byte, 0, len(domain)+1+len(data))
	message = append(message, domain...)
	message = append(message, 0)
	return append(message, data...)
}

func decodeContractBase64(value string, size int) ([]byte, error) {
	decoded, err := base64.StdEncoding.Strict().DecodeString(value)
	if err != nil || len(decoded) != size || base64.StdEncoding.EncodeToString(decoded) != value {
		return nil, errors.New("invalid canonical base64")
	}
	return decoded, nil
}

func containsFingerprint(values []string, fingerprint string) bool {
	for _, value := range values {
		if value == fingerprint {
			return true
		}
	}
	return false
}
