// session_signature_age_test.go
// Pins the age the server itself enforces on a session cookie's signature.
// Between the session store's options, which the browser is told, and the
// signature inside the cookie, which only the server checks.
// Exists because the two were different: the browser was told seven days while
// the library went on accepting a thirty-day-old signature, so a session cookie
// kept elsewhere and presented on day eight was still read -- and, since a used
// sign-in is renewed, handed seven fresh days.
package e_sessions

import (
	"reflect"
	"testing"
	"time"

	"github.com/gorilla/securecookie"
)

func TestTheServerEnforcesTheSameAgeItTellsTheBrowser(t *testing.T) {
	initSessionTestStore(t)

	if got := time.Duration(Store.Options.MaxAge) * time.Second; got != SignInLifetime {
		t.Fatalf("the browser is told %v, want %v", got, SignInLifetime)
	}

	if len(Store.Codecs) == 0 {
		t.Fatal("the store has no codec to enforce an age")
	}

	// The signature carries its own age, which the library sets once when the
	// store is built and does not take from Options afterwards. It is private to
	// securecookie, so the test reads it rather than re-deriving it: nothing else
	// distinguishes "seven days" from the library's thirty-day default.
	for index, codec := range Store.Codecs {
		secure, ok := codec.(*securecookie.SecureCookie)
		if !ok {
			t.Fatalf("codec %d is not a SecureCookie", index)
		}
		field := reflect.ValueOf(secure).Elem().FieldByName("maxAge")
		if !field.IsValid() {
			t.Fatalf("codec %d has no age to check; the library changed shape", index)
		}
		if got := time.Duration(field.Int()) * time.Second; got != SignInLifetime {
			t.Fatalf("codec %d accepts a signature up to %v old, while the browser is told %v",
				index, got, SignInLifetime)
		}
	}
}
