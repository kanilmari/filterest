// first_run_access.go
// Requires operator proof for remote first-administrator setup.
// Connects the pending setup form, direct network peer and one process-local key.
// Only the server log receives the generated key; forwarded headers confer no access.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"easelect/backend/core_components/logging"
	"encoding/hex"
	"net"
	"net/http"
	"sync"
)

var firstRunAccess struct {
	sync.Once
	proof string
	err   error
}

func firstRunAccessAllowed(r *http.Request) bool {
	firstRunAccess.Do(func() {
		var bytes [32]byte
		if _, firstRunAccess.err = rand.Read(bytes[:]); firstRunAccess.err == nil {
			firstRunAccess.proof = hex.EncodeToString(bytes[:])
			logging.Infof("First-run setup token (send as X-Filterest-Setup-Token): %s", firstRunAccess.proof)
		}
	})
	if ip := net.ParseIP(getClientIP(r)); ip != nil && ip.IsLoopback() {
		return true
	}
	if firstRunAccess.err != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Filterest-Setup-Token")), []byte(firstRunAccess.proof)) == 1
}
