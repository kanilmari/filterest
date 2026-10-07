// password_reset_pending_test.go
// Verifies reset envelopes fail closed and keep fixed size independent of account ids.
// Bridges the signing-key-only configuration and the encrypted reset-state reader.
// Exists because cookie signing alone must not reveal the account existence result.
package e_sessions

import (
	"encoding/base64"
	"fmt"
	"testing"
)

func TestPasswordResetPendingFixedSizeTamperAndPurposeIsolation(t *testing.T) {
	t.Setenv("SESSION_KEY", "reset-pending-unit-test-secret")
	for _, id := range []int{0, 42, 9999999} {
		expectedGeneration := int64(id) + 1
		value, err := SealPasswordResetPending(id, expectedGeneration)
		if err != nil {
			t.Fatal(err)
		}
		if len(value) != 70 {
			t.Fatalf("length=%d", len(value))
		}
		got, generation := OpenPasswordResetPending(value)
		if got != id || generation != expectedGeneration {
			t.Fatal("lost reset snapshot")
		}
		envelope, err := base64.RawURLEncoding.DecodeString(value)
		if err != nil {
			t.Fatal(err)
		}
		aead, err := resetPendingCipher()
		if err != nil {
			t.Fatal(err)
		}
		// Mutate actual bytes: base64's unused trailing bits can change a
		// character without changing the authenticated envelope at all.
		for _, part := range []struct {
			name   string
			offset int
		}{
			{"nonce", 0},
			{"ciphertext", aead.NonceSize()},
			{"tag", len(envelope) - aead.Overhead()},
		} {
			t.Run(fmt.Sprintf("%s/id_%d", part.name, id), func(t *testing.T) {
				modified := append([]byte(nil), envelope...)
				modified[part.offset] ^= 1
				if got, generation := OpenPasswordResetPending(base64.RawURLEncoding.EncodeToString(modified)); got != 0 || generation != 0 {
					t.Fatal("accepted modified envelope")
				}
			})
		}
		t.Setenv("SESSION_KEY", "different-key")
		if got, generation := OpenPasswordResetPending(value); got != 0 || generation != 0 {
			t.Fatal("accepted another signing key")
		}
		t.Setenv("SESSION_KEY", "reset-pending-unit-test-secret")
	}
	if got, _ := OpenPasswordResetPending("expired-or-missing"); got != 0 {
		t.Fatal("accepted missing envelope")
	}
}
