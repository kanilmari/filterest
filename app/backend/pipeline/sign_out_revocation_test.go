// sign_out_revocation_test.go
// Walks the race that undid a sign-out, and the four ordinary journeys around it.
// Between the sign-out handler, the authentication stage that refuses a signed-out
// sign-in, the two binding stages that renew a used one, and the browser holding
// the cookies.
// Exists because signing out only expired the cookies in the browser: a request
// already in flight in another tab finished afterwards, wrote all three back, and
// the person held working credentials they believed they had given up. On the code
// before this file the first test here fails — the resurrected cookies still work.
package pipeline_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/sign_in_deadline"
	"easelect/backend/core_components/sign_in_revocation"
	"easelect/backend/pipeline/auth_check"
	"easelect/backend/pipeline/device_id_check"
	"easelect/backend/pipeline/fingerprint_check"

	gorillaSessions "github.com/gorilla/sessions"
)

// signOutTestSite is the installation this walk happens on: whether visitors may
// browse without signing in, what the signed-in person's credentials say, and the
// sign-outs the server has recorded so far.
type signOutTestSite struct {
	loginRequiredToBrowse    bool
	authenticationGeneration int64
	revokedSignIns           map[string]time.Time
	recordedDeadline         time.Time
	signInLimit              time.Duration
	now                      time.Time
	unreachable              bool
	revocationReads          int
}

type signOutTestDriver struct{ site *signOutTestSite }
type signOutTestConn struct{ site *signOutTestSite }
type signOutTestRows struct {
	names  []string
	values []driver.Value
	done   bool
}

func (d signOutTestDriver) Open(string) (driver.Conn, error)   { return &signOutTestConn{d.site}, nil }
func (c *signOutTestConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("unused") }
func (c *signOutTestConn) Close() error                        { return nil }
func (c *signOutTestConn) Begin() (driver.Tx, error)           { return nil, errors.New("unused") }
func (r *signOutTestRows) Columns() []string                   { return r.names }
func (r *signOutTestRows) Close() error                        { return nil }
func (r *signOutTestRows) Next(values []driver.Value) error {
	if r.done {
		return io.EOF
	}
	copy(values, r.values)
	r.done = true
	return nil
}

func (c *signOutTestConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if c.site.unreachable {
		return nil, errors.New("the database is unreachable")
	}
	switch {
	case strings.Contains(query, "public.system_revoked_sign_ins"):
		// One question: may this sign-in still be used? No if it was signed out,
		// and no if it has reached the deadline it was given.
		c.site.revocationReads++
		signInID, _ := args[0].Value.(string)
		expiresAt, _ := args[1].Value.(int64)
		unlimited, _ := args[2].Value.(bool)
		withinDeadline := unlimited || c.site.now.Before(time.Unix(expiresAt, 0))
		expiry, recorded := c.site.revokedSignIns[signInID]
		stillRefused := recorded && expiry.After(c.site.now)
		return &signOutTestRows{names: []string{"usable"},
			values: []driver.Value{withinDeadline && !stillRefused}}, nil
	case strings.Contains(query, "SELECT now()") && strings.Contains(query, "system_config"):
		// What a sign-in asks before it is stamped: the database's own clock and
		// the configured ceiling.
		return &signOutTestRows{names: []string{"now", "json_value"},
			values: []driver.Value{c.site.now, c.site.signInLimitPolicy()}}, nil
	case strings.Contains(query, "'login_to_browse'"):
		return &signOutTestRows{names: []string{"boolean_value"},
			values: []driver.Value{c.site.loginRequiredToBrowse}}, nil
	case strings.Contains(query, "FROM system_config"):
		// only_admin_can_login is not set on this site, so sign-in is unrestricted.
		return &signOutTestRows{names: []string{"boolean_value"}, done: true}, nil
	case strings.Contains(query, "SELECT ur.authentication_generation"):
		return &signOutTestRows{names: []string{"authentication_generation"},
			values: []driver.Value{c.site.authenticationGeneration}}, nil
	}
	return nil, fmt.Errorf("unexpected query: %s", query)
}

func (c *signOutTestConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(query, "INSERT INTO public.system_revoked_sign_ins") {
		return nil, fmt.Errorf("unexpected statement: %s", query)
	}
	if c.site.unreachable {
		return nil, errors.New("the database is unreachable")
	}
	for signInID, expiry := range c.site.revokedSignIns {
		if !expiry.After(c.site.now) {
			delete(c.site.revokedSignIns, signInID)
		}
	}
	signInID, _ := args[0].Value.(string)
	expiresAt, _ := args[1].Value.(int64)
	unlimited, _ := args[2].Value.(bool)

	// A sign-in already past its deadline needs no record; the deadline refuses it.
	if !unlimited && !time.Unix(expiresAt, 0).After(c.site.now) {
		return driver.RowsAffected(0), nil
	}
	deadline := signOutForever
	if !unlimited {
		deadline = time.Unix(expiresAt, 0)
	}
	c.site.recordedDeadline = deadline
	if _, already := c.site.revokedSignIns[signInID]; !already {
		c.site.revokedSignIns[signInID] = deadline
	}
	return driver.RowsAffected(1), nil
}

// signOutForever stands in for the database's infinity: the end of a record for a
// sign-in that was never given a deadline.
var signOutForever = time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)

// signInLimitPolicy is what this site's settings row says. A site that names no
// limit is given the ordinary thirty days.
func (s *signOutTestSite) signInLimitPolicy() string {
	limit := s.signInLimit
	if limit == 0 {
		limit = 30 * 24 * time.Hour
	}
	return fmt.Sprintf(`{"limit_enabled": true, "limit_unit": "hours", "limit_amount": %d}`,
		int(limit/time.Hour))
}

// signInDeadline is the moment a sign-in started at this site would be given.
func (s *signOutTestSite) signInDeadline(signedInAt time.Time) time.Time {
	limit := s.signInLimit
	if limit == 0 {
		limit = 30 * 24 * time.Hour
	}
	return signedInAt.Add(limit)
}

var signOutTestCounter int64

// useTestSite points every database the authentication path reads at one
// in-memory installation.
func useTestSite(t *testing.T, site *signOutTestSite) *signOutTestSite {
	t.Helper()
	if site.revokedSignIns == nil {
		site.revokedSignIns = map[string]time.Time{}
	}
	if site.now.IsZero() {
		site.now = time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	}
	if site.authenticationGeneration == 0 {
		site.authenticationGeneration = 1
	}
	name := fmt.Sprintf("sign_out_site_%d", atomic.AddInt64(&signOutTestCounter, 1))
	sql.Register(name, signOutTestDriver{site})
	database, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("open the test site's database: %v", err)
	}
	originalDb, originalConfidential := backend.Db, backend.DbConfidential
	backend.Db, backend.DbConfidential = database, database
	t.Cleanup(func() {
		backend.Db, backend.DbConfidential = originalDb, originalConfidential
		_ = database.Close()
	})
	return site
}

// signInOneBrowser writes what a completed sign-in writes: the identity, the
// generation the credentials had, this sign-in's own identity, and the three
// cookies that carry it. The sign-in identity is minted by the same function the
// sign-in handler uses, so a test cannot pass with an identity the product would
// not have given.
func signInOneBrowser(
	t *testing.T,
	store *gorillaSessions.CookieStore,
	jar *browserCookieJar,
	site *signOutTestSite,
	deviceID, fingerprint string,
	now time.Time,
) string {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	recorder := httptest.NewRecorder()
	session, err := store.Get(request, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("sign-in: store.Get: %v", err)
	}
	session.Values["authenticated"] = true
	session.Values["user_id"] = bindingTestUserID
	session.Values["username"] = "the-person"
	session.Values["user_role"] = "basic"
	session.Values["authentication_generation"] = site.authenticationGeneration
	session.Values["device_id"] = deviceID
	session.Values["fingerprint_hash"] = fingerprint
	signInIDFromMint, err := sign_in_revocation.NewSignInID()
	if err != nil {
		t.Fatalf("sign-in: mint the sign-in identity: %v", err)
	}
	session.Values[sign_in_revocation.SessionKey] = signInIDFromMint
	// The same stamp the sign-in handler writes: the last moment this sign-in may
	// be used, decided once from the site's clock and never revised.
	if err := sign_in_deadline.Stamp(context.Background(), backend.Db, session); err != nil {
		t.Fatalf("sign-in: stamp the deadline: %v", err)
	}
	signInID, present := sign_in_revocation.SessionValue(session)
	if !present {
		t.Fatal("sign-in: the session carries no sign-in identity")
	}
	if err := session.Save(request, recorder); err != nil {
		t.Fatalf("sign-in: session.Save: %v", err)
	}
	e_sessions.SetDeviceIDCookie(recorder, deviceID)
	e_sessions.SetFingerprintCookie(recorder, fingerprint)
	jar.store(recorder, now)
	return signInID
}

// requestForData is one ordinary request the application makes for data, carrying
// whatever the browser still holds.
func requestForData(jar *browserCookieJar, now time.Time) *http.Request {
	request := httptest.NewRequest(http.MethodGet, "/api/user-permissions", nil)
	request.Header.Set("Accept", "*/*")
	request.Header.Set("Sec-Fetch-Mode", "cors")
	jar.attach(request, now)
	return request
}

// protectedRoute wires the stages a signed-in route runs, in the order
// PipelineOrder wires them: the authentication stage first, then the two that
// compare the browser binding and renew the sign-in.
func protectedRoute(handler http.HandlerFunc) http.HandlerFunc {
	return auth_check.EnsureLoggedIn(
		fingerprint_check.WithFingerprintCheck(
			device_id_check.WithDeviceIDCheck(handler),
		),
	)
}

// askForData runs one request through the protected stages and reports who the
// handler acted as: the signed-in person, 1 for a visitor, or 0 when the request
// never reached the handler.
func askForData(t *testing.T, jar *browserCookieJar, now time.Time) (int, *httptest.ResponseRecorder) {
	t.Helper()
	request := requestForData(jar, now)
	recorder := httptest.NewRecorder()
	actedAs := 0
	protectedRoute(func(w http.ResponseWriter, r *http.Request) {
		if session, err := e_sessions.GetOrCreateSession(w, r); err == nil {
			actedAs, _ = session.Values["user_id"].(int)
		}
		w.WriteHeader(http.StatusOK)
	})(recorder, request)
	jar.store(recorder, now)
	return actedAs, recorder
}

// signOut is the person pressing the sign-out control in one browser.
func signOut(t *testing.T, jar *browserCookieJar, now time.Time) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/logout", nil)
	jar.attach(request, now)
	recorder := httptest.NewRecorder()
	auth.LogoutHandler(recorder, request)
	jar.store(recorder, now)
	return recorder
}

func assertRefusedAsAnEndedSignIn(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d", recorder.Code, http.StatusForbidden)
	}
	var body map[string]any
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatalf("decode the answer: %v", err)
	}
	if body["auth_failure"] != true {
		t.Fatalf("the answer does not say the sign-in ended: %#v", body)
	}
}

// The defect, walked. A person has the site open in two tabs. One tab asks for
// data; while that request is still being served, they sign out in the other. The
// first tab's answer arrives afterwards, and because every protected request
// renews a used sign-in, that answer carries all three cookies with a fresh seven
// days. The person believes they are signed out; the browser holds a working
// sign-in again.
//
// On the code before this test, the last check fails: the resurrected cookies are
// accepted and the request acts as the signed-in person.
func TestASignOutSurvivesAnAnswerThatArrivesAfterIt(t *testing.T) {
	store := useTestSessionStore(t)
	site := useTestSite(t, &signOutTestSite{loginRequiredToBrowse: true})
	jar := newBrowserCookieJar()

	signedInAt := site.now
	signInOneBrowser(t, store, jar, site, bindingTestDeviceID, bindingTestFingerprint, signedInAt)

	// The first tab asks for data. The sign-out happens while that request is in
	// flight, from the second tab, with the cookies the browser holds right now.
	inFlight := requestForData(jar, signedInAt)
	inFlightAnswer := httptest.NewRecorder()
	signedOutDuringTheRequest := false
	protectedRoute(func(w http.ResponseWriter, r *http.Request) {
		signOut(t, jar, signedInAt)
		signedOutDuringTheRequest = true
		w.WriteHeader(http.StatusOK)
	})(inFlightAnswer, inFlight)

	if !signedOutDuringTheRequest {
		t.Fatal("the first tab's request never reached its handler, so the race was not walked")
	}
	for _, name := range signInCookieNames() {
		if jar.holds(name, signedInAt) {
			t.Fatalf("after signing out the browser still holds %q", name)
		}
	}

	// Now the earlier request finishes and its answer reaches the browser, which
	// keeps what it was given.
	jar.store(inFlightAnswer, signedInAt)
	resurrected := 0
	for _, name := range signInCookieNames() {
		if jar.holds(name, signedInAt) {
			resurrected++
		}
	}
	if resurrected != len(signInCookieNames()) {
		t.Fatalf("the earlier answer put back %d of the %d sign-in cookies; the race this test walks needs all three",
			resurrected, len(signInCookieNames()))
	}

	// The browser holds working-looking credentials again. They must not work.
	actedAs, recorder := askForData(t, jar, signedInAt.Add(time.Minute))
	if actedAs == bindingTestUserID {
		t.Fatal("the answer that arrived after the sign-out put the person back in: they are signed in again without knowing it")
	}
	assertRefusedAsAnEndedSignIn(t, recorder)
}

// An ordinary sign-out, with nothing racing it, still signs the person out.
func TestAnOrdinarySignOutStillSignsThePersonOut(t *testing.T) {
	store := useTestSessionStore(t)
	site := useTestSite(t, &signOutTestSite{loginRequiredToBrowse: true})
	jar := newBrowserCookieJar()

	signedInAt := site.now
	signInOneBrowser(t, store, jar, site, bindingTestDeviceID, bindingTestFingerprint, signedInAt)
	if actedAs, _ := askForData(t, jar, signedInAt); actedAs != bindingTestUserID {
		t.Fatalf("the person was not signed in to begin with: the request acted as %d", actedAs)
	}

	recorder := signOut(t, jar, signedInAt)
	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("signing out answered %d, want %d", recorder.Code, http.StatusSeeOther)
	}
	if destination := recorder.Header().Get("Location"); destination != "/login" {
		t.Fatalf("signing out sent the person to %q, want the login page", destination)
	}
	for _, name := range signInCookieNames() {
		if jar.holds(name, signedInAt) {
			t.Fatalf("after signing out the browser still holds %q", name)
		}
	}
	if actedAs, _ := askForData(t, jar, signedInAt.Add(time.Minute)); actedAs == bindingTestUserID {
		t.Fatal("the person is still signed in after an ordinary sign-out")
	}
}

// Signing out on one browser signs out that browser and no other. This is the
// owner's decision: a sign-out on a phone must leave the desktop alone. Ending
// every sign-in of an account at once remains the separate authentication
// generation, which a credential change or a disabled account uses.
func TestTheSamePersonsOtherBrowserStaysSignedIn(t *testing.T) {
	store := useTestSessionStore(t)
	site := useTestSite(t, &signOutTestSite{loginRequiredToBrowse: true})

	phone := newBrowserCookieJar()
	desktop := newBrowserCookieJar()
	signedInAt := site.now
	signInOneBrowser(t, store, phone, site, "the-phones-device", "the-phones-fingerprint", signedInAt)
	desktopSignInID := signInOneBrowser(t, store, desktop, site, "the-desktops-device", "the-desktops-fingerprint", signedInAt)

	signOut(t, phone, signedInAt)

	actedAs, recorder := askForData(t, desktop, signedInAt.Add(time.Minute))
	if actedAs != bindingTestUserID {
		t.Fatalf("signing out on the phone signed the same person out of their desktop: the desktop's request acted as %d, status %d",
			actedAs, recorder.Code)
	}
	if _, desktopWasRecorded := site.revokedSignIns[desktopSignInID]; desktopWasRecorded {
		t.Fatal("the desktop's sign-in was recorded as signed out")
	}
	if len(site.revokedSignIns) != 1 {
		t.Fatalf("one sign-out recorded %d sign-ins as ended", len(site.revokedSignIns))
	}
}

// A visitor who never signed in is untouched: they keep browsing a site that
// allows it, and the check costs them no question of the database.
func TestAVisitorWhoNeverSignedInIsUnaffected(t *testing.T) {
	useTestSessionStore(t)
	site := useTestSite(t, &signOutTestSite{loginRequiredToBrowse: false})
	jar := newBrowserCookieJar()

	actedAs, recorder := askForData(t, jar, site.now)
	if actedAs != 1 {
		t.Fatalf("a visitor's request acted as %d, want the guest identity 1 (status %d)", actedAs, recorder.Code)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("a visitor's request answered %d, want %d", recorder.Code, http.StatusOK)
	}

	// Signing a visitor out records nothing: there is no sign-in to end.
	signOut(t, jar, site.now)
	if len(site.revokedSignIns) != 0 {
		t.Fatalf("a visitor's sign-out recorded %d sign-ins as ended", len(site.revokedSignIns))
	}
	if site.revocationReads != 0 {
		t.Fatalf("a visitor cost %d lookups in the revoked sign-in store", site.revocationReads)
	}
	if actedAs, _ := askForData(t, jar, site.now.Add(time.Minute)); actedAs != 1 {
		t.Fatalf("the visitor could no longer browse after someone signed out: acted as %d", actedAs)
	}
}

// On a site that lets visitors browse, a person who signs out becomes a visitor
// again rather than being stopped, and the browser they signed out of cannot get
// their identity back.
func TestOnASiteThatLetsVisitorsBrowseASignedOutPersonBecomesAVisitor(t *testing.T) {
	store := useTestSessionStore(t)
	site := useTestSite(t, &signOutTestSite{loginRequiredToBrowse: false})
	jar := newBrowserCookieJar()

	signedInAt := site.now
	signInOneBrowser(t, store, jar, site, bindingTestDeviceID, bindingTestFingerprint, signedInAt)

	inFlight := requestForData(jar, signedInAt)
	inFlightAnswer := httptest.NewRecorder()
	protectedRoute(func(w http.ResponseWriter, r *http.Request) {
		signOut(t, jar, signedInAt)
		w.WriteHeader(http.StatusOK)
	})(inFlightAnswer, inFlight)
	jar.store(inFlightAnswer, signedInAt)

	actedAs, recorder := askForData(t, jar, signedInAt.Add(time.Minute))
	if actedAs != 1 {
		t.Fatalf("after signing out on a public site the request acted as %d, want the guest identity 1 (status %d)",
			actedAs, recorder.Code)
	}
}

// The two binding stages still do exactly what they did: a request carrying
// another browser's binding is refused, and the refusal renews nothing. Signing
// out is a third reason to refuse, added beside them, not in place of them.
func TestTheBrowserBindingIsStillCheckedAfterTheSignOutCheck(t *testing.T) {
	store := useTestSessionStore(t)
	site := useTestSite(t, &signOutTestSite{loginRequiredToBrowse: true})
	jar := newBrowserCookieJar()

	signedInAt := site.now
	signInOneBrowser(t, store, jar, site, bindingTestDeviceID, bindingTestFingerprint, signedInAt)

	jar.held[e_sessions.DeviceIDCookieName()] = heldCookie{value: "another-browsers-device"}
	actedAs, recorder := askForData(t, jar, signedInAt.Add(time.Minute))
	if actedAs != 0 {
		t.Fatalf("a request carrying another browser's binding reached the handler as %d", actedAs)
	}
	assertRefusedAsAnEndedSignIn(t, recorder)
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == e_sessions.DeviceIDCookieName() && cookie.Value == bindingTestDeviceID {
			t.Fatal("the refused request was handed the session's own device binding")
		}
	}
}

// The record is kept to the sign-in's own deadline: exactly as long as that
// sign-in could still be presented, and not one moment more. It must not be a
// length recomputed from whatever the setting says today, because a setting that
// can shorten a record is a way to bring a signed-out sign-in back -- and one
// that can lengthen it keeps rows nobody can use.
//
// Past that deadline nothing is left to refuse: the sign-in is finished on its
// own, whatever signed the cookie since.
func TestTheRecordIsKeptToTheSignInsOwnDeadline(t *testing.T) {
	store := useTestSessionStore(t)
	site := useTestSite(t, &signOutTestSite{loginRequiredToBrowse: true})
	jar := newBrowserCookieJar()

	signedInAt := site.now
	signInOneBrowser(t, store, jar, site, bindingTestDeviceID, bindingTestFingerprint, signedInAt)
	signOut(t, jar, signedInAt)

	want := site.signInDeadline(signedInAt)
	if !site.recordedDeadline.Equal(want) {
		t.Fatalf("the sign-out was recorded until %v; the sign-in it refuses ends at %v",
			site.recordedDeadline, want)
	}
	if got := time.Duration(store.Options.MaxAge) * time.Second; got != e_sessions.SignInLifetime {
		t.Fatalf("the session cookie is written for %v, which is no longer what it was", got)
	}
}

// The browser's own copies run out at the same moment the record does, so a
// person who closes the laptop on the day they signed out and opens it weeks
// later has nothing left to present.
func TestWeeksLaterTheBrowserHasNothingLeftToPresent(t *testing.T) {
	store := useTestSessionStore(t)
	site := useTestSite(t, &signOutTestSite{loginRequiredToBrowse: true})
	jar := newBrowserCookieJar()

	signedInAt := site.now
	signInOneBrowser(t, store, jar, site, bindingTestDeviceID, bindingTestFingerprint, signedInAt)

	inFlight := requestForData(jar, signedInAt)
	inFlightAnswer := httptest.NewRecorder()
	protectedRoute(func(w http.ResponseWriter, r *http.Request) {
		signOut(t, jar, signedInAt)
		w.WriteHeader(http.StatusOK)
	})(inFlightAnswer, inFlight)
	jar.store(inFlightAnswer, signedInAt)

	threeWeeksLater := signedInAt.Add(21 * 24 * time.Hour)
	site.now = threeWeeksLater
	for _, name := range signInCookieNames() {
		if jar.holds(name, threeWeeksLater) {
			t.Fatalf("three weeks after signing out the browser still holds %q", name)
		}
	}
	if actedAs, _ := askForData(t, jar, threeWeeksLater); actedAs == bindingTestUserID {
		t.Fatal("three weeks after signing out the person came back signed in")
	}
}

// A store that cannot be read is not a pass. A signed-in person is asked to try
// again, with their sign-in intact, rather than being let through or signed out
// over a database that will be back in a minute.
func TestAnUnreachableStoreRefusesRatherThanLetsThrough(t *testing.T) {
	store := useTestSessionStore(t)
	site := useTestSite(t, &signOutTestSite{loginRequiredToBrowse: true})
	jar := newBrowserCookieJar()

	signedInAt := site.now
	signInOneBrowser(t, store, jar, site, bindingTestDeviceID, bindingTestFingerprint, signedInAt)

	site.unreachable = true
	actedAs, recorder := askForData(t, jar, signedInAt.Add(time.Minute))
	if actedAs == bindingTestUserID {
		t.Fatal("a request was served as the signed-in person while the store that says who is signed out could not be read")
	}
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d, want %d so the person is asked to try again rather than signed out",
			recorder.Code, http.StatusServiceUnavailable)
	}
}

// A sign-out this server could not write down is not presented as finished: the
// browser loses its cookies and the person is sent to the login page with the
// notice that says what is still uncertain.
func TestASignOutThatCouldNotBeRecordedSaysSo(t *testing.T) {
	store := useTestSessionStore(t)
	site := useTestSite(t, &signOutTestSite{loginRequiredToBrowse: false})
	jar := newBrowserCookieJar()

	signedInAt := site.now
	signInOneBrowser(t, store, jar, site, bindingTestDeviceID, bindingTestFingerprint, signedInAt)

	site.unreachable = true
	recorder := signOut(t, jar, signedInAt)

	destination := recorder.Header().Get("Location")
	if !strings.HasPrefix(destination, "/login?") || !strings.Contains(destination, "auth_notice=sign-out-not-recorded") {
		t.Fatalf("a sign-out that could not be recorded sent the person to %q", destination)
	}
	for _, name := range signInCookieNames() {
		if jar.holds(name, signedInAt) {
			t.Fatalf("a sign-out that could not be recorded left %q in the browser", name)
		}
	}
}
