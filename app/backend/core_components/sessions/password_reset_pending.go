// password_reset_pending.go
// Seals fixed-size reset state even when ordinary session-cookie encryption is disabled.
// Bridges the instance signing secret and the pre-login reset challenge.
// Exists so neither readable cookie content nor cookie length can enumerate accounts.
package e_sessions

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"os"
	"time"
)

func resetPendingCipher() (cipher.AEAD, error) {
	secret := os.Getenv("SESSION_KEY")
	if secret == "" {
		return nil, errors.New("session signing key unavailable")
	}
	block, err := aes.NewCipher(DeriveCurrentAuthKey(secret, "password-reset-pending"))
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// SealPasswordResetPending always encrypts exactly three unsigned 64-bit words.
func SealPasswordResetPending(userID int, generation int64) (string, error) {
	aead, err := resetPendingCipher()
	if err != nil {
		return "", err
	}
	plain := make([]byte, 24)
	binary.BigEndian.PutUint64(plain, uint64(userID))
	binary.BigEndian.PutUint64(plain[8:], uint64(generation))
	binary.BigEndian.PutUint64(plain[16:], uint64(time.Now().Add(5*time.Minute).Unix()))
	nonce := make([]byte, aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(aead.Seal(nonce, nonce, plain, nil)), nil
}

// OpenPasswordResetPending collapses damaged or expired states into the unknown-account state.
func OpenPasswordResetPending(value string) (int, int64) {
	aead, err := resetPendingCipher()
	if err != nil {
		return 0, 0
	}
	encrypted, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(encrypted) != aead.NonceSize()+24+aead.Overhead() {
		return 0, 0
	}
	plain, err := aead.Open(nil, encrypted[:aead.NonceSize()], encrypted[aead.NonceSize():], nil)
	if err != nil || int64(binary.BigEndian.Uint64(plain[16:])) < time.Now().Unix() {
		return 0, 0
	}
	return int(binary.BigEndian.Uint64(plain)), int64(binary.BigEndian.Uint64(plain[8:]))
}
