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
	"slices"
	"strings"

	"github.com/gorilla/sessions"
)

var sessionLog = os.Getenv("SESSION_LOG") == "1"

// maxStrayCookieDirectories bounds how many directories one response clears.
// Application paths are a few levels deep; the bound only keeps a crafted path
// from turning one request into thousands of response headers.
const maxStrayCookieDirectories = 8

// GetOrCreateSession returns the session for the request or creates a new one
// if the existing cookie can't be decoded. When a securecookie error occurs,
// the old cookie is cleared so the client doesn't need to do it manually, and
// the replacement is written with the same cookie options as every other
// session. If w is nil, cookie clearing is skipped.
func GetOrCreateSession(w http.ResponseWriter, r *http.Request) (*sessions.Session, error) {
	store := GetStore()

	if w != nil {
		clearStraySessionCookies(w, r)
	}

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
			return NewSessionWithCookieOptions(), nil
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

// clearStraySessionCookies removes copies of the session cookie that a browser
// keeps under a directory instead of the site root. Before the replacement
// session carried its options, a session written after an unreadable cookie had
// no Path, so the browser filed it under the directory of that request, such
// as /api. The browser sends such a copy before the root cookie on every
// request below that directory, so API calls and pages read different sessions
// and a sign-in page's CSRF token never matches. A browser sends a cookie only
// for directories above the requested path, so when it sends more than one
// session cookie, the copies are on those directories; they are cleared and
// the root cookie is kept. The sign-in page then recovers by fetching the
// session's token again.
func clearStraySessionCookies(w http.ResponseWriter, r *http.Request) {
	sessionCookies := 0
	for _, cookie := range r.Cookies() {
		if cookie.Name == SessionName {
			sessionCookies++
		}
	}
	if sessionCookies < 2 {
		return
	}

	alreadySet := w.Header().Values("Set-Cookie")
	for _, directory := range directoriesAbove(r.URL.EscapedPath()) {
		clearing := (&http.Cookie{Name: SessionName, Value: "", Path: directory, MaxAge: -1}).String()
		if slices.Contains(alreadySet, clearing) {
			continue
		}
		w.Header().Add("Set-Cookie", clearing)
	}
	if sessionLog {
		log.Printf("[GetOrCreateSession] %d session cookies received for %s; cleared the copies below the root", sessionCookies, r.URL.Path)
	}
}

// directoriesAbove lists the directories of a request path below the site
// root, nearest the root first: "/api/app/tasks" gives "/api", "/api/app" and
// "/api/app/tasks". These are the only paths a cookie sent with the request
// can have besides "/". The path is the escaped form the browser sent, the form
// browsers store a default cookie path in. A directory the cookie writer would
// alter is skipped: dropping the semicolon from "/;" would leave "/" and clear
// the root cookie instead of the copy.
func directoriesAbove(requestPath string) []string {
	var directories []string
	for index := 1; index <= len(requestPath) && len(directories) < maxStrayCookieDirectories; index++ {
		if index < len(requestPath) && requestPath[index] != '/' {
			continue
		}
		directory := requestPath[:index]
		if directory != "/" && isWritableCookiePath(directory) && !slices.Contains(directories, directory) {
			directories = append(directories, directory)
		}
	}
	return directories
}

// isWritableCookiePath reports whether a Set-Cookie header carries path exactly
// as given; net/http silently drops control bytes, non-ASCII bytes and ';'.
func isWritableCookiePath(path string) bool {
	for index := 0; index < len(path); index++ {
		if character := path[index]; character <= ' ' || character >= 0x7f || character == ';' {
			return false
		}
	}
	return true
}
