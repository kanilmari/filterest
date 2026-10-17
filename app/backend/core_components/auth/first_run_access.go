// first_run_access.go
// Requires operator proof for every first-administrator setup submission.
// Connects the pending setup form and one process-local key, independent of network identity.
// Only the server log receives the generated key; failed generation refuses every caller.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"easelect/backend/core_components/logging"
	"encoding/hex"
	"net/http"
	"sync"
)

type firstRunAccessCode struct {
	sync.Once
	proof string
	err   error
}

var firstRunAccess = &firstRunAccessCode{}

func ensureFirstRunAccessCode() {
	firstRunAccess.Do(func() {
		var bytes [32]byte
		if _, firstRunAccess.err = rand.Read(bytes[:]); firstRunAccess.err == nil {
			firstRunAccess.proof = hex.EncodeToString(bytes[:])
			logging.Infof("First-run setup token (enter in the Setup code field of the first-run form, or send as X-Filterest-Setup-Token): %s", firstRunAccess.proof)
		}
	})
}

func firstRunAccessAllowed(r *http.Request) bool {
	ensureFirstRunAccessCode()
	if firstRunAccess.err != nil {
		return false
	}
	// Only the POST body and script header carry proof; URL parameters never do.
	// Fixed-size digests keep comparisons constant-time even for wrong lengths.
	expected := sha256.Sum256([]byte(firstRunAccess.proof))
	field := sha256.Sum256([]byte(r.PostForm.Get("setup_code")))
	header := sha256.Sum256([]byte(r.Header.Get("X-Filterest-Setup-Token")))
	return (subtle.ConstantTimeCompare(field[:], expected[:]) | subtle.ConstantTimeCompare(header[:], expected[:])) == 1
}
