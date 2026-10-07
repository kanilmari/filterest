// release_ed25519_key_validator_test.go
// Derives small-order Edwards points and reproduces release/possession forgeries.
// Connects published curve constants to independently constructed attack vectors.
// Ensures copied blocklists cannot hide an incomplete degenerate-key defense.
package release_updates

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"testing"
)

func TestReleaseTrustRejectsSmallOrderKeysIncludingNoncanonical(t *testing.T) {
	vectors := []string{
		"0000000000000000000000000000000000000000000000000000000000000000",
		"0100000000000000000000000000000000000000000000000000000000000000",
		"26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
		"c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
		"ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
		"edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
		"eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
	}
	for _, vector := range vectors {
		for _, sign := range []byte{0, 0x80} {
			public, err := hex.DecodeString(vector)
			if err != nil {
				t.Fatal(err)
			}
			public[31] |= sign
			assertSmallOrderPolicyRefused(t, public)
		}
	}
	// Every independently derived order-eight encoding must also match the
	// published Edwards list; Montgomery u-coordinates fail this comparison.
	for _, public := range independentlyDerivedOrderEightKeys(t) {
		coordinate := append([]byte{}, public...)
		coordinate[31] &= 0x7f
		if hex.EncodeToString(coordinate) != vectors[2] && hex.EncodeToString(coordinate) != vectors[3] {
			t.Fatalf("derived Edwards coordinate absent from list: %x", coordinate)
		}
		assertSmallOrderPolicyRefused(t, public)
	}
}

func assertSmallOrderPolicyRefused(t *testing.T, public ed25519.PublicKey) {
	t.Helper()
	policy := rotationTestPolicy(t, "trust_policy.json")
	policy.Compositions[0].Keys[0].PublicKey = base64.StdEncoding.EncodeToString(public)
	policy.Compositions[0].Keys[0].Fingerprint = KeyFingerprint(public)
	if _, err := ParseTrustPolicy(contractJSON(t, policy)); !errors.Is(err, ErrInvalidTrustPolicy) {
		t.Fatalf("small-order key accepted: %x: %v", public, err)
	}
}

func TestReleaseSmallOrderForgedManifestAndPossessionRefused(t *testing.T) {
	points := independentlyDerivedOrderEightKeys(t)
	identity := make(ed25519.PublicKey, 32)
	identity[0] = 1
	points = append(points, identity)
	for _, public := range points {
		t.Run(hex.EncodeToString(public), func(t *testing.T) {
			// R=identity, S=0 needs no private key. For order-eight A it verifies
			// whenever the reduced challenge is divisible by eight; search valid
			// canonical documents, then confirm the forgery using standard Go.
			forgery := make([]byte, ed25519.SignatureSize)
			forgery[0] = 1
			manifest, err := ParseManifest(contractFixture(t, "public_manifest.json"))
			if err != nil {
				t.Fatal(err)
			}
			data := findOrderEightForgery(t, public, forgery, ManifestSignatureDomain, func(i int) []byte {
				manifest.ReleaseID = fmt.Sprintf("forged-order-eight-%d", i)
				return canonicalContractJSON(t, manifest)
			})
			policy := rotationTestPolicy(t, "trust_policy.json")
			key := &policy.Compositions[0].Keys[0]
			key.PublicKey, key.Fingerprint = base64.StdEncoding.EncodeToString(public), KeyFingerprint(public)
			envelope := &SignatureEnvelopeV1{SchemaVersion: 1, SignatureType: "ed25519_detached", Domain: ManifestSignatureDomain, Signatures: []DetachedSignatureV1{{KeyFingerprint: key.Fingerprint, Signature: base64.StdEncoding.EncodeToString(forgery)}}}
			t.Run("manifest", func(t *testing.T) {
				if _, err := VerifyManifest(data, contractJSON(t, envelope), policy, contractOptions("filterest")); !errors.Is(err, ErrInvalidTrustPolicy) || !strings.Contains(err.Error(), "composition key") {
					t.Fatalf("forged small-order manifest accepted: %v", err)
				}
			})
			// Real current keys authorize the policy; the new order-eight key
			// contributes only a forged possession proof, over those same bytes.
			next := rotationTestPolicy(t, "rotation_policy.json")
			next.Compositions[0].Keys[1] = *key
			data = findOrderEightForgery(t, public, forgery, TrustPolicySignatureDomain, func(i int) []byte {
				next.PolicyRevision = uint64(i + 2)
				return canonicalContractJSON(t, next)
			})
			proofs, err := ParseSignatures(rotationTestSignatures(t, data, TrustPolicySignatureDomain, "public", "private"), TrustPolicySignatureDomain)
			if err != nil {
				t.Fatal(err)
			}
			proofs.Signatures = append(proofs.Signatures, envelope.Signatures[0])
			t.Run("possession", func(t *testing.T) {
				if _, err := VerifyTrustPolicyUpdate(data, contractJSON(t, proofs), rotationTestPolicy(t, "trust_policy.json"), contractOptions("filterest")); !errors.Is(err, ErrInvalidTrustPolicy) || !strings.Contains(err.Error(), "composition key") {
					t.Fatalf("forged small-order possession accepted: %v", err)
				}
			})
		})
	}
}

func findOrderEightForgery(t *testing.T, public ed25519.PublicKey, proof []byte, domain string, document func(int) []byte) []byte {
	t.Helper()
	for i := 0; i < 4096; i++ {
		data := document(i)
		if ed25519.Verify(public, signatureMessage(domain, data), proof) {
			return data
		}
	}
	t.Fatal("could not reproduce small-order forgery")
	return nil
}

// RFC 8032's curve is -x²+y²=1+d*x²*y² with p=2^255-19,
// d=-121665/121666. A point doubling to order four has y(2P)=0,
// hence x²=-y² and d*y^4+2*y²-1=0. Solve this quadratic in y²,
// take its square roots and both x signs, and prove exact order by doubling.
// This uses only big.Int field arithmetic, independently of the production list.
func independentlyDerivedOrderEightKeys(t *testing.T) []ed25519.PublicKey {
	t.Helper()
	p := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 255), big.NewInt(19))
	d := new(big.Int).Mod(new(big.Int).Mul(big.NewInt(-121665), new(big.Int).ModInverse(big.NewInt(121666), p)), p)
	root := new(big.Int).ModSqrt(new(big.Int).Mod(new(big.Int).Add(big.NewInt(1), d), p), p)
	if root == nil {
		t.Fatal("curve quadratic lacks square root")
	}
	var y *big.Int
	for _, candidate := range []*big.Int{root, new(big.Int).Neg(root)} {
		z := new(big.Int).Mod(new(big.Int).Mul(new(big.Int).Sub(candidate, big.NewInt(1)), new(big.Int).ModInverse(d, p)), p)
		if squareRoot := new(big.Int).ModSqrt(z, p); squareRoot != nil {
			y = squareRoot
			break
		}
	}
	if y == nil {
		t.Fatal("curve has no order-eight y coordinate")
	}
	x := new(big.Int).ModSqrt(new(big.Int).Mod(new(big.Int).Neg(new(big.Int).Mul(y, y)), p), p)
	if x == nil {
		t.Fatal("order-eight point lacks x coordinate")
	}
	// Edwards doubling, with independent affine formulas (a=-1).
	double := func(x, y *big.Int) (*big.Int, *big.Int) {
		x2, y2 := new(big.Int).Mul(x, x), new(big.Int).Mul(y, y)
		product := new(big.Int).Mod(new(big.Int).Mul(d, new(big.Int).Mul(x2, y2)), p)
		xNext := new(big.Int).Mul(big.NewInt(2), new(big.Int).Mul(x, y))
		xNext.Mul(xNext, new(big.Int).ModInverse(new(big.Int).Add(big.NewInt(1), product), p)).Mod(xNext, p)
		yNext := new(big.Int).Add(x2, y2)
		yNext.Mul(yNext, new(big.Int).ModInverse(new(big.Int).Sub(big.NewInt(1), product), p)).Mod(yNext, p)
		return xNext, yNext
	}
	x2, y2 := double(x, y)
	x4, y4 := double(x2, y2)
	x8, y8 := double(x4, y4)
	if y2.Sign() != 0 || x4.Sign() != 0 || y4.Cmp(new(big.Int).Sub(p, big.NewInt(1))) != 0 || x8.Sign() != 0 || y8.Cmp(big.NewInt(1)) != 0 {
		t.Fatal("derived point does not have exact order eight")
	}
	var encodings []ed25519.PublicKey
	for _, coordinate := range []*big.Int{y, new(big.Int).Sub(p, y)} {
		for _, sign := range []byte{0, 0x80} {
			encoded := make(ed25519.PublicKey, 32)
			bigEndian := coordinate.Bytes()
			for i := range bigEndian {
				encoded[i] = bigEndian[len(bigEndian)-1-i]
			}
			encoded[31] |= sign
			encodings = append(encodings, encoded)
		}
	}
	return encodings
}
