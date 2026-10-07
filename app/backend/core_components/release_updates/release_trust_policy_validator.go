// release_trust_policy_validator.go
// Validates operator trust and authenticated composition-key rotations.
// Connects independently provisioned policy keys to release and possession proofs.
// Preserves publisher scope, revocation history and the retained revision floor.
package release_updates

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const MaxTrustPolicyBytes = 256 << 10

var (
	ErrInvalidTrustPolicy = errors.New("invalid operator trust policy")
	ErrStaleTrustPolicy   = errors.New("trust policy is expired, future-dated or below the required revision")
)

// TrustPolicyV1 is independently provisioned composition/publisher trust. Parsed
// values alone do not prove provenance; rotations require existing authorization.
type TrustPolicyV1 struct {
	SchemaVersion  int                  `json:"schema_version"`
	PolicyType     string               `json:"policy_type"`
	PolicyRevision uint64               `json:"policy_revision"`
	IssuedAt       string               `json:"issued_at"`
	ExpiresAt      string               `json:"expires_at"`
	Compositions   []CompositionTrustV1 `json:"compositions"`
}
type CompositionTrustV1 struct {
	ID        string         `json:"id"`
	Publisher string         `json:"publisher"`
	Keys      []TrustedKeyV1 `json:"keys"`
}
type TrustedKeyV1 struct {
	Fingerprint string `json:"fingerprint"`
	PublicKey   string `json:"public_key"`
	NotBefore   string `json:"not_before"`
	NotAfter    string `json:"not_after"`
	Revoked     bool   `json:"revoked"`
}

// ParseTrustPolicy does not establish provenance. Bytes must come from operator
// provisioning or VerifyTrustPolicyUpdate, never a downloaded release bundle.
func ParseTrustPolicy(data []byte) (*TrustPolicyV1, error) {
	var policy TrustPolicyV1
	if err := decodeContractJSON(data, MaxTrustPolicyBytes, &policy); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidTrustPolicy, err)
	}
	if err := validateTrustPolicy(&policy); err != nil {
		return nil, err
	}
	return &policy, nil
}

// ReadTrustPolicyFile requires a protected regular operator/root-owned file.
// Its path is an installation input and must not be selected by the manifest.
func ReadTrustPolicyFile(path string) (*TrustPolicyV1, error) {
	data, err := readProtectedReleaseFile(path, MaxTrustPolicyBytes, 0022)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidTrustPolicy, err)
	}
	policy, err := ParseTrustPolicy(data)
	if err != nil {
		return nil, err
	}
	if err := rejectTestOnlySigningKeys(policy); err != nil {
		return nil, err
	}
	return policy, nil
}

func rejectTestOnlySigningKeys(policy *TrustPolicyV1) error {
	for _, scope := range policy.Compositions {
		for _, key := range scope.Keys {
			if testOnlySigningFingerprints[key.Fingerprint] {
				return fmt.Errorf("%w: public test-only fixture keys cannot establish operator trust", ErrInvalidTrustPolicy)
			}
		}
	}
	return nil
}

// VerifyTrustPolicyUpdate requires an increasing, fresh revision, approval by an
// existing live key for every enrolled composition, and proof from every new key,
// including future-dated keys. It returns the verified policy without persisting it.
// Enrolled keys remain in every revision; retirement keeps revoked tombstones.
// Public test-only fixture keys cannot authorize or enter an operator policy.
// Adding a composition or recovering expired/compromised trust requires independent
// operator provisioning. A signature from a compromised key cannot make recovery safe.
func VerifyTrustPolicyUpdate(data, signatures []byte, current *TrustPolicyV1, options VerificationOptions) (*TrustPolicyV1, error) {
	if err := validateTrustAt(current, options); err != nil {
		return nil, err
	}
	if err := rejectTestOnlySigningKeys(current); err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > MaxTrustPolicyBytes {
		return nil, ErrInvalidTrustPolicy
	}
	envelope, err := parseSignatureEnvelope(signatures, TrustPolicySignatureDomain)
	if err != nil {
		return nil, err
	}
	for _, scope := range current.Compositions {
		if len(verifyTrustedSignatures(data, envelope, scope.Keys, options.Now)) == 0 {
			return nil, fmt.Errorf("%w: rotation lacks existing key authorization", ErrUntrustedRelease)
		}
	}
	next, err := ParseTrustPolicy(data)
	if err != nil {
		return nil, err
	}
	if err := rejectTestOnlySigningKeys(next); err != nil {
		return nil, err
	}
	if next.PolicyRevision <= current.PolicyRevision {
		return nil, ErrStaleTrustPolicy
	}
	if err := validateTrustAt(next, options); err != nil {
		return nil, err
	}
	if len(next.Compositions) != len(current.Compositions) {
		return nil, fmt.Errorf("%w: composition enrollment requires operator provisioning", ErrInvalidTrustPolicy)
	}
	for _, oldScope := range current.Compositions {
		newScope, err := policyComposition(next, oldScope.ID)
		if err != nil {
			return nil, err
		}
		if newScope.Publisher != oldScope.Publisher {
			return nil, fmt.Errorf("%w: publisher cannot change during rotation", ErrInvalidTrustPolicy)
		}
		// Every key must remain enrolled. Retirement marks it revoked and keeps a
		// tombstone, so its authorizing proof remains verifiable by CLI signing.
		for _, old := range oldScope.Keys {
			retained := false
			for _, key := range newScope.Keys {
				if key.Fingerprint == old.Fingerprint && (!old.Revoked || key.Revoked) {
					retained = true
				}
			}
			if !retained {
				return nil, fmt.Errorf("%w: enrolled keys must be retained; retire keys with revocation tombstones", ErrInvalidTrustPolicy)
			}
		}
		proofs := verifyTrustedSignatures(data, envelope, newScope.Keys, options.Now)
		if len(proofs) == 0 {
			return nil, fmt.Errorf("%w: rotation leaves no live signing key", ErrUntrustedRelease)
		}
		for _, key := range newScope.Keys {
			if key.Revoked {
				continue
			}
			existed := false
			for _, old := range oldScope.Keys {
				if old.Fingerprint == key.Fingerprint && !old.Revoked {
					existed = true
				}
			}
			if !existed && !keyHasSignatureProof(signatureMessage(TrustPolicySignatureDomain, data), envelope, key) {
				return nil, fmt.Errorf("%w: new key lacks proof of possession", ErrUntrustedRelease)
			}
		}
	}
	return next, nil
}

func validateTrustPolicy(policy *TrustPolicyV1) error {
	if policy == nil || policy.SchemaVersion != 1 || policy.PolicyType != "filterest_release_trust" || policy.PolicyRevision == 0 || len(policy.Compositions) == 0 {
		return ErrInvalidTrustPolicy
	}
	issued, err := contractTime(policy.IssuedAt)
	if err != nil {
		return ErrInvalidTrustPolicy
	}
	expires, err := contractTime(policy.ExpiresAt)
	if err != nil || !expires.After(issued) {
		return ErrInvalidTrustPolicy
	}
	scopes, fingerprints := map[string]bool{}, map[string]bool{}
	for _, scope := range policy.Compositions {
		if !contractIDPattern.MatchString(scope.ID) || !contractIDPattern.MatchString(scope.Publisher) || scopes[scope.ID] || len(scope.Keys) == 0 || len(scope.Keys) > 32 {
			return ErrInvalidTrustPolicy
		}
		scopes[scope.ID] = true
		for _, key := range scope.Keys {
			public, err := decodeContractBase64(key.PublicKey, ed25519.PublicKeySize)
			if err != nil || smallOrderEd25519PublicKey(public) || !contractHashPattern.MatchString(key.Fingerprint) || KeyFingerprint(ed25519.PublicKey(public)) != key.Fingerprint || fingerprints[key.Fingerprint] {
				return fmt.Errorf("%w: invalid or reused composition key", ErrInvalidTrustPolicy)
			}
			fingerprints[key.Fingerprint] = true
			before, err := contractTime(key.NotBefore)
			if err != nil {
				return ErrInvalidTrustPolicy
			}
			after, err := contractTime(key.NotAfter)
			if err != nil || !after.After(before) {
				return ErrInvalidTrustPolicy
			}
		}
	}
	return nil
}

func validateTrustAt(policy *TrustPolicyV1, options VerificationOptions) error {
	if err := validateTrustPolicy(policy); err != nil {
		return err
	}
	if options.Now.IsZero() || options.MinimumTrustPolicyRevision == 0 || !contractIDPattern.MatchString(options.CompositionID) {
		return fmt.Errorf("%w: trusted clock, composition and revision floor are required", ErrInvalidTrustPolicy)
	}
	issued, _ := contractTime(policy.IssuedAt)
	expires, _ := contractTime(policy.ExpiresAt)
	if policy.PolicyRevision < options.MinimumTrustPolicyRevision || options.Now.Before(issued) || !options.Now.Before(expires) {
		return ErrStaleTrustPolicy
	}
	_, err := policyComposition(policy, options.CompositionID)
	return err
}

func policyComposition(policy *TrustPolicyV1, id string) (*CompositionTrustV1, error) {
	for i := range policy.Compositions {
		if policy.Compositions[i].ID == id {
			return &policy.Compositions[i], nil
		}
	}
	return nil, fmt.Errorf("%w: composition is not enrolled", ErrUntrustedRelease)
}

func keyLiveAt(key TrustedKeyV1, at time.Time) bool {
	before, _ := contractTime(key.NotBefore)
	after, _ := contractTime(key.NotAfter)
	return !key.Revoked && !at.Before(before) && at.Before(after)
}

// Public fixtures ship in source, including their deterministic private keys.
// The denylist applies at operator-file provisioning and policy updates. Parsing
// alone remains available for cross-language fixtures and signing proof tests.
var testOnlySigningFingerprints = map[string]bool{
	"33b87fb9373923c2d9fbf65e4b79a7951181402f797dc339c38e8a310e15dab4": true, // public
	"6cf2acd9378a94dca8ed64443def72b6dcea229bfc976fb92f8e90340dfb2673": true, // private
	"554124820e5296b062bcc1f7fdb6870822df081aaa55c08f440a68c24360a447": true, // rotation
	"051c54879972a3e8063c96ae06199556e8c9010c4feebebdc0079cd885b9d53c": true, // wrong
}

// VerifyTrustPolicySignatureProofs checks every proof against the policy's own
// public keys before the CLI publishes a combined envelope. It proves possession,
// including retired/future keys, not authorization or freshness of a rotation.
func VerifyTrustPolicySignatureProofs(data []byte, envelope *SignatureEnvelopeV1, policy *TrustPolicyV1) error {
	if err := validateTrustPolicy(policy); err != nil {
		return err
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return ErrInvalidSignature
	}
	proofs, err := parseSignatureEnvelope(encoded, TrustPolicySignatureDomain)
	if err != nil {
		return err
	}
	message := signatureMessage(TrustPolicySignatureDomain, data)
	for _, proof := range proofs.Signatures {
		found := false
		for _, scope := range policy.Compositions {
			for _, key := range scope.Keys {
				if key.Fingerprint == proof.KeyFingerprint && keyHasSignatureProof(message, proofs, key) {
					found = true
				}
			}
		}
		if !found {
			return fmt.Errorf("%w: policy proof lacks a matching public key or valid signature", ErrUntrustedRelease)
		}
	}
	return nil
}
