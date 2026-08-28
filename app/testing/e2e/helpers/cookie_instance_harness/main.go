// main.go
// Runs a minimal HTTP instance around Easelect's real authentication-cookie helpers.
// Bridges Playwright's same-host multi-port test to the production session package.
// Exists so cookie isolation, logout, reset, and browser restart can be proven
// without depending on a mutable development database or real user credentials.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"

	e_sessions "easelect/backend/core_components/sessions"
)

type stateResponse struct {
	Authenticated     bool                       `json:"authenticated"`
	CookieNames       e_sessions.AuthCookieNames `json:"cookie_names"`
	DeviceCookie      bool                       `json:"device_cookie"`
	FingerprintCookie bool                       `json:"fingerprint_cookie"`
}

func main() {
	e_sessions.InitSessionStore()

	mux := http.NewServeMux()
	mux.HandleFunc("/login", login)
	mux.HandleFunc("/state", state)
	mux.HandleFunc("/logout", logout)
	mux.HandleFunc("/api/reset-session", e_sessions.ResetSessionHandler)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("READY http://%s\n", listener.Addr().String())
	if err := http.Serve(listener, mux); err != nil {
		log.Fatal(err)
	}
}

func login(w http.ResponseWriter, r *http.Request) {
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	session.Values["user_id"] = 42
	if err := session.Save(r, w); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	e_sessions.SetDeviceIDCookie(w, "browser-device")
	e_sessions.SetFingerprintCookie(w, "browser-fingerprint")
	w.WriteHeader(http.StatusNoContent)
}

func state(w http.ResponseWriter, r *http.Request) {
	session, err := e_sessions.GetOrCreateSession(nil, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_, deviceErr := r.Cookie(e_sessions.DeviceIDCookieName())
	_, fingerprintErr := r.Cookie(e_sessions.FingerprintCookieName())
	response := stateResponse{
		Authenticated:     session.Values["user_id"] == 42,
		CookieNames:       e_sessions.CurrentAuthCookieNames(),
		DeviceCookie:      deviceErr == nil,
		FingerprintCookie: fingerprintErr == nil,
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("encode state response: %v", err)
	}
}

func logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	session.Options.MaxAge = -1
	if err := session.Save(r, w); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	e_sessions.ExpireCurrentAuthCookies(w)
	w.WriteHeader(http.StatusNoContent)
}
