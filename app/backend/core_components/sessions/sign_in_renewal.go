// sign_in_renewal.go
// Renews the three cookies that carry a sign-in for one fresh lifetime, together.
// Between the stages and pages that have just compared a request's browser binding
// with its session, and the browser that holds the cookies.
// Exists because the session and its two browser bindings used to renew on
// different rhythms — the bindings on every protected request, the session only
// when a handler happened to write it — so a person who used the site every day
// without a full page load could still be signed out by the cookie that lapsed first.
package e_sessions

import (
	"log"
	"net/http"

	"github.com/gorilla/sessions"
)

// The session entries "device_id" and "fingerprint_hash" are what together bind
// a session to one browser. The stages that enforce them are
// app/backend/pipeline/device_id_check and app/backend/pipeline/fingerprint_check;
// this file only compares the same values and re-issues them, never decides what
// they mean. The two names are spelled as literals here because that is how every
// other file in the application spells them, and a constant covering only this
// one would leave the application with two spellings for one key.

// RequestCarriesSessionBinding reports whether this request already presents
// the device and fingerprint values its own session stores.
//
// It compares and never writes. A value accepted from the request would become
// the proof that the protected routes demand afterwards, so the only safe
// question is whether the browser already holds what the session holds. An
// absent session value counts as a mismatch: a sign-in with nothing to compare
// against cannot have proved anything, which is also how the device stage reads it.
func RequestCarriesSessionBinding(r *http.Request, session *sessions.Session) bool {
	if r == nil || session == nil {
		return false
	}
	return requestCookieMatchesSessionValue(r, DeviceIDCookieName(), session, "device_id") &&
		requestCookieMatchesSessionValue(r, FingerprintCookieName(), session, "fingerprint_hash")
}

func requestCookieMatchesSessionValue(
	r *http.Request,
	cookieName string,
	session *sessions.Session,
	sessionKey string,
) bool {
	storedValue, _ := session.Values[sessionKey].(string)
	if storedValue == "" {
		return false
	}
	cookie, cookieErr := r.Cookie(cookieName)
	return cookieErr == nil && cookie.Value == storedValue
}

// RenewUsedSignIn gives a sign-in that has just been used one fresh lifetime:
// it re-issues the session cookie and both binding cookies for SignInLifetime,
// counted from now, so the three can only ever run out together. It reports
// whether it did so.
//
// This is the one place a sign-in is renewed. The device stage calls it after
// the fingerprint stage and it have both compared the request's binding with
// the session's, and the public root page calls it in place of running those
// stages. Renewal follows use, not the calendar: a browser that stops visiting
// renews nothing, and comes back to the one ended-sign-in answer.
//
// Renewing is not accepting. Nothing is written unless the request already
// carries both binding values the session stores, so whoever calls this — even
// from a route that ran only one of the two stages — can only ever hand back a
// binding the browser already had. The values written are the session's own.
//
// The session cookie is written here even though a later handler may write it
// again; the browser keeps the last one, and both carry the same lifetime.
func RenewUsedSignIn(w http.ResponseWriter, r *http.Request, session *sessions.Session) bool {
	if !RequestCarriesSessionBinding(r, session) {
		return false
	}
	deviceID, _ := session.Values["device_id"].(string)
	fingerprint, _ := session.Values["fingerprint_hash"].(string)
	SetDeviceIDCookie(w, deviceID)
	SetFingerprintCookie(w, fingerprint)
	if err := session.Save(r, w); err != nil {
		log.Printf("\033[31m[sessions] renewing a used sign-in could not write the session: %v\033[0m", err)
	}
	return true
}
