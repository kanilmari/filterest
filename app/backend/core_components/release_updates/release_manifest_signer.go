// release_manifest_signer.go
// Signs canonical offline manifests and policies with domain-separated Ed25519.
// Connects in-memory signing keys to detached proofs and combined rotation envelopes.
// Keeps document digests unique and prevents signature-domain substitution.
package release_updates

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
)

// SignManifest accepts canonical JSON with a final LF, matching the existing
// release_contract_v1.py canonical_json_line. Verification never reserializes.
func SignManifest(data []byte, key ed25519.PrivateKey) (*SignatureEnvelopeV1, error) {
	if _, err := ParseManifest(data); err != nil {
		return nil, err
	}
	return signContractDocument(data, key, ManifestSignatureDomain)
}

// SignTrustPolicy signs canonical policy bytes in their own domain; the resulting
// proof establishes possession, while existing policy keys authorize rotation.
func SignTrustPolicy(data []byte, key ed25519.PrivateKey) (*SignatureEnvelopeV1, error) {
	if _, err := ParseTrustPolicy(data); err != nil {
		return nil, err
	}
	return signContractDocument(data, key, TrustPolicySignatureDomain)
}

// MergeSignatures assembles rotation proofs without introducing any public keys.
func MergeSignatures(envelopes ...*SignatureEnvelopeV1) (*SignatureEnvelopeV1, error) {
	if len(envelopes) == 0 || envelopes[0] == nil {
		return nil, ErrInvalidSignature
	}
	merged := &SignatureEnvelopeV1{SchemaVersion: 1, SignatureType: "ed25519_detached", Domain: envelopes[0].Domain, Signatures: []DetachedSignatureV1{}}
	if merged.Domain != ManifestSignatureDomain && merged.Domain != TrustPolicySignatureDomain {
		return nil, ErrInvalidSignature
	}
	for _, envelope := range envelopes {
		data, err := json.Marshal(envelope)
		if err != nil {
			return nil, ErrInvalidSignature
		}
		parsed, err := parseSignatureEnvelope(data, merged.Domain)
		if err != nil {
			return nil, err
		}
		merged.Signatures = append(merged.Signatures, parsed.Signatures...)
	}
	data, _ := json.Marshal(merged)
	return parseSignatureEnvelope(data, merged.Domain)
}

func signContractDocument(data []byte, key ed25519.PrivateKey, domain string) (*SignatureEnvelopeV1, error) {
	if !validSigningKey(key) {
		return nil, errors.New("invalid Ed25519 private key")
	}
	if err := ValidateCanonicalReleaseJSON(data); err != nil {
		return nil, err
	}
	public := key.Public().(ed25519.PublicKey)
	return &SignatureEnvelopeV1{SchemaVersion: 1, SignatureType: "ed25519_detached", Domain: domain, Signatures: []DetachedSignatureV1{{KeyFingerprint: KeyFingerprint(public), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, signatureMessage(domain, data)))}}}, nil
}

// ValidateCanonicalReleaseJSON checks the signer/verifier byte identity contract.
// Callers first use a strict typed parser so duplicate keys cannot disappear.
func ValidateCanonicalReleaseJSON(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return errors.New("cannot read canonical signing input")
	}
	var canonical bytes.Buffer
	encoder := json.NewEncoder(&canonical)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil || !bytes.Equal(data, canonical.Bytes()) {
		return errors.New("signing input must be canonical UTF-8 JSON with final LF")
	}
	return nil
}
