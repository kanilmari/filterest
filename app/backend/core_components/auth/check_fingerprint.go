// check_fingerprint.go
// Validates device fingerprints submitted by the client and stores them in the session.
// Bridges the frontend fingerprinting POST, the session store, and the HMAC cookie.
// Exists to protect signed-in sessions; guests never enroll browser identities.
package auth

import (
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/session_expiry"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"log"
	"net/http"
)

// setFingerprintCookie updates the fingerprint HTTP cookie to keep it in sync
// with session.Values["fingerprint_hash"]. Otherwise the cookie would mismatch
// the HMAC stored by this handler, causing
// WithFingerprintCheck to reject subsequent requests.
func setFingerprintCookie(w http.ResponseWriter, hmacVal string) {
	e_sessions.SetFingerprintCookie(w, hmacVal)
}

func CheckFingerprintHandler(w http.ResponseWriter, r *http.Request) {

	// Read without a response writer: an absent/unreadable sign-in is a no-op,
	// including for older clients, and must not create or repair any cookies.
	session, err := e_sessions.Load(r)
	userID := 0
	if session != nil {
		userID, _ = session.Values["user_id"].(int)
	}
	if err != nil || userID <= 1 {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
		return
	}

	var req struct {
		Fingerprint string `json:"fingerprint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[CheckFingerprintHandler] decode error: %v", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Fingerprint == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing fingerprint")
		return
	}

	sessFingerprint, _ := session.Values["fingerprint_hash"].(string)

	// No fingerprint in a signed-in session yet.
	// Accept the submitted fingerprint by computing its HMAC and storing it.
	if sessFingerprint == "" {
		hmacVal := HMACFingerprint(req.Fingerprint)
		session.Values["fingerprint_hash"] = hmacVal
		setFingerprintCookie(w, hmacVal)
		_ = e_sessions.Save(w, r, session)
		log.Printf("[CheckFingerprintHandler] new fingerprint saved to session ✅")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
		return
	}

	// A signed-in browser whose fingerprint differs must lose its sign-in.
	if !VerifyFingerprintHMAC(req.Fingerprint, sessFingerprint) {
		// A signed-in session whose browser no longer matches is ended here, not
		// only refused. Refusing alone left the identity in the session: the
		// browser was sent to the login page, the login page sent the apparently
		// signed-in visitor back to the application, and the application refused
		// again, until the browser's own reset happened to win the race. Clearing
		// and saving the identity before the answer makes it one clean sign-out.
		session_expiry.RespondSignInNoLongerValid(w, r, session, "fingerprint mismatch")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}
