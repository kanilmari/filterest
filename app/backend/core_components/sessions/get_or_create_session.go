// get_or_create_session.go
// Retrieves an existing Gorilla session or creates a new one if the cookie is
// invalid or missing. Automatically clears corrupted securecookie cookies to
// prevent clients from being permanently locked out.

package e_sessions

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gorilla/sessions"
)

var sessionLog = os.Getenv("SESSION_LOG") == "1"

// GetOrCreateSession returns the session for the request or creates a new one
// if the existing cookie can't be decoded. When a securecookie error occurs,
// the old cookie is cleared so the client doesn't need to do it manually. If w
// is nil, cookie clearing is skipped.
func GetOrCreateSession(w http.ResponseWriter, r *http.Request) (*sessions.Session, error) {
	store := GetStore()

	if sessionLog {
		if cookie, errCookie := r.Cookie(SessionName); errCookie == nil {
			val := cookie.Value
			if len(val) > 12 {
				val = val[:12]
			}
			log.Printf("[GetOrCreateSession] session cookie received: %s...", val)
		} else {
			log.Println("[GetOrCreateSession] session cookie not found")
		}
	}

	session, err := store.Get(r, SessionName)
	if err != nil {
		if strings.Contains(err.Error(), "securecookie") {
			if sessionLog {
				if cookie, errCookie := r.Cookie(SessionName); errCookie == nil {
					val := cookie.Value
					if len(val) > 12 {
						val = val[:12]
					}
					log.Printf("[GetOrCreateSession] securecookie error (%v), session cookie: %s... -> deleting", err, val)
				} else {
					log.Printf("[GetOrCreateSession] securecookie error (%v), but cookie not found", err)
				}
				log.Println("[GetOrCreateSession] deleting session cookie")
			}
			if w != nil {
				http.SetCookie(w, &http.Cookie{
					Name:   SessionName,
					Value:  "",
					Path:   "/",
					MaxAge: -1,
				})
			}
			return sessions.NewSession(store, SessionName), nil
		}
		return nil, fmt.Errorf("session get failed: %w", err)
	}

	if sessionLog {
		if session.IsNew {
			log.Println("[GetOrCreateSession] new session created")
		} else if uid, ok := session.Values["user_id"]; ok {
			log.Printf("[GetOrCreateSession] session fetched, user_id=%v", uid)
		} else {
			log.Println("[GetOrCreateSession] session fetched, but user_id missing")
		}
	}

	return session, nil
}
