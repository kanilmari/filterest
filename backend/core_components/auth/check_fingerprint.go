// check_fingerprint.go
// Validates device fingerprints submitted by the client and stores them in the session.
// Bridges the frontend fingerprinting POST, the session store, and the HMAC cookie.
// Exists to enroll and re-enroll fingerprints so the pipeline fingerprint-check stage sees consistent values.
package auth

import (
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// setFingerprintCookie updates the fingerprint HTTP cookie to keep it in sync
// with session.Values["fingerprint_hash"]. Without this, rootHandler's initial
// UUID cookie would mismatch the HMAC stored by this handler, causing
// WithFingerprintCheck to reject subsequent requests.
func setFingerprintCookie(w http.ResponseWriter, hmacVal string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "fingerprint",
		Value:    hmacVal,
		Path:     "/",
		HttpOnly: false,
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		Secure:   e_sessions.ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode,
	})
}

func CheckFingerprintHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		log.Printf("[CheckFingerprintHandler] session get failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "session error")
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

	// No fingerprint in session yet (fresh/restarted session, or guest user).
	// Accept the submitted fingerprint by computing its HMAC and storing it.
	if sessFingerprint == "" {
		hmacVal := HMACFingerprint(req.Fingerprint)
		session.Values["fingerprint_hash"] = hmacVal
		setFingerprintCookie(w, hmacVal)
		if saveErr := session.Save(r, w); saveErr != nil {
			log.Printf("[CheckFingerprintHandler] session save failed: %v", saveErr)
		}
		log.Printf("[CheckFingerprintHandler] new fingerprint saved to session ✅")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
		return
	}

	// Session has a stored fingerprint that was NOT set by HMAC (e.g. random UUID
	// from routing_helpers.go guest flow). Verify fails → re-enroll rather than
	// rejecting the user.
	if !VerifyFingerprintHMAC(req.Fingerprint, sessFingerprint) {
		// Check if user is a guest (user_id == 1). Guests get re-enrolled
		// silently; authenticated users get a mismatch error.
		userID, _ := session.Values["user_id"].(int)
		if userID <= 1 {
			hmacVal := HMACFingerprint(req.Fingerprint)
			session.Values["fingerprint_hash"] = hmacVal
			setFingerprintCookie(w, hmacVal)
			if saveErr := session.Save(r, w); saveErr != nil {
				log.Printf("[CheckFingerprintHandler] session save failed: %v", saveErr)
			}
			log.Printf("[CheckFingerprintHandler] guest fingerprint re-registered ✅")
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"ok":true}`))
			return
		}
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "fingerprint mismatch")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}
