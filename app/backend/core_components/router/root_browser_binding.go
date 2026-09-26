// root_browser_binding.go
// Decides which visitor of the public root page may be handed a browser binding.
// Between the public root page and the device and fingerprint pipeline stages.
// Exists because the root page runs neither of those stages, so a request that
// owns nothing but a stolen session cookie must not be able to ask this page for
// the very values that later prove it is the browser which signed in. A visitor
// who did sign in is compared with, and renewed by, e_sessions.RenewUsedSignIn —
// the same call the device stage makes — so this file owns only the guest side.
package router

import (
	"log"
	"net/http"

	e_sessions "easelect/backend/core_components/sessions"

	"github.com/google/uuid"
	"github.com/gorilla/sessions"
)

// The session entries "device_id" and "fingerprint_hash" are what together bind
// a session to one browser. The stages that enforce them are
// app/backend/pipeline/device_id_check and app/backend/pipeline/fingerprint_check;
// this file only writes the same values for a guest, never decides what they
// mean. The two names are spelled as literals here because that is how every
// other file in the application spells them, and a constant covering only this
// one would leave the application with two spellings for one key.

// isSignedInUserID reports whether a session identity belongs to a person who
// signed in, rather than to the shared guest identity (1) or to no identity at
// all. It is the mirror image of isGuestUserID and draws the line at the same
// place the device and fingerprint stages draw it.
func isSignedInUserID(userIDVal interface{}) bool {
	userID, ok := userIDVal.(int)
	return ok && userID > 1
}

// establishGuestBrowserBinding gives a visitor who has not signed in the device
// and fingerprint values the rest of the application expects to find, keeping
// whichever the browser already carries so a returning guest stays the same
// guest. Minting them here is safe precisely because there is no sign-in to
// protect; only the root handler's guest branch calls it, and the comment there
// explains why a signed-in request must never arrive.
func establishGuestBrowserBinding(w http.ResponseWriter, r *http.Request, session *sessions.Session) {
	changed := false

	// Varmista device_id
	cDev, cDevErr := r.Cookie(e_sessions.DeviceIDCookieName())
	var deviceID string
	if cDevErr != nil || cDev.Value == "" {
		deviceID = uuid.NewString()
		changed = true
	} else {
		deviceID = cDev.Value
	}
	if sessID, _ := session.Values["device_id"].(string); sessID != deviceID {
		session.Values["device_id"] = deviceID
		changed = true
	}
	if changed {
		e_sessions.SetDeviceIDCookie(w, deviceID)
	}

	// Varmista fingerprint
	cF, cFErr := r.Cookie(e_sessions.FingerprintCookieName())
	var fingerprint string
	if cFErr != nil || cF.Value == "" {
		fingerprint = uuid.NewString()
		changed = true
	} else {
		fingerprint = cF.Value
	}
	if sessFp, _ := session.Values["fingerprint_hash"].(string); sessFp != fingerprint {
		session.Values["fingerprint_hash"] = fingerprint
		changed = true
	}
	if changed {
		e_sessions.SetFingerprintCookie(w, fingerprint)
		if errSave := session.Save(r, w); errSave != nil {
			log.Printf("\033[31merror: session save failed: %s\033[0m\n", errSave.Error())
		}
	}
}
