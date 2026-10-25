// storage_binding_test.go
// Verifies storage requires the same browser proof as protected pipeline routes.
// Bridges signed cookie requests, the real storage handler and stubbed database authorization.
// Prevents a session cookie alone from disclosing protected files or minting its missing bindings.
package router

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/site_assistant"
	"easelect/backend/pipeline/device_id_check"
	"easelect/backend/pipeline/fingerprint_check"

	"github.com/gorilla/securecookie"
	"github.com/gorilla/sessions"
)

const storageBindingFile = "104/7/original/private.txt"

// Build on a separate request so every tested request must decode its signed cookie.
func storageBindingBrowser(t *testing.T, values map[interface{}]interface{}) signedInBrowser {
	t.Helper()
	carrier := httptest.NewRequest(http.MethodGet, "/", nil)
	session := e_sessions.NewSessionWithCookieOptions()
	session.Values = values
	w := httptest.NewRecorder()
	if err := e_sessions.Save(w, carrier, session); err != nil {
		t.Fatal(err)
	}
	return signedInBrowser{
		sessionCookie:     responseCookie(w, e_sessions.SessionName),
		deviceCookie:      &http.Cookie{Name: e_sessions.DeviceIDCookieName(), Value: rootHandlerTestDeviceID},
		fingerprintCookie: &http.Cookie{Name: e_sessions.FingerprintCookieName(), Value: rootHandlerTestFingerprint},
	}
}

func storageBindingValues(userID int) map[interface{}]interface{} {
	return map[interface{}]interface{}{
		"user_id": userID, "user_role": "basic", "authenticated": true,
		"device_id": rootHandlerTestDeviceID, "fingerprint_hash": rootHandlerTestFingerprint,
		auth_generation.SessionKey: int64(7),
	}
}

func allowStorageBindingActor(t *testing.T, wantUserID int) {
	t.Helper()
	storageAuthorizeRead = func(_ context.Context, _ dbutils.Querier, _ *sql.DB,
		actor dbutils.RequestActorContext, _ dtt_1_row_read.StorageReadRequest,
	) (dtt_1_row_read.StorageReadDecision, error) {
		if actor.UserID != wantUserID || (wantUserID == 1 && (actor.UserRole != "guest" || actor.IsAdmin)) {
			t.Fatalf("storage actor = %#v, want user %d", actor, wantUserID)
		}
		return dtt_1_row_read.StorageReadAllowed, nil
	}
}

func TestStorageBindingMatchesPipelineIdentityExemptions(t *testing.T) {
	for _, identity := range []struct {
		name   string
		userID int
		extra  map[interface{}]interface{}
	}{
		{"ordinary", 42, nil},
		{"administrator", 42, map[interface{}]interface{}{"user_role": "admin"}},
		{"automation", 42, map[interface{}]interface{}{auth_generation.AutomationSessionKey: true, "api_only": true}},
		{"delegated", 42, map[interface{}]interface{}{site_assistant.SessionDelegationKey: "test-delegation"}},
		{"guest", 1, nil},
	} {
		for _, bound := range []bool{false, true} {
			name := identity.name + "/session-only"
			if bound {
				name = identity.name + "/bound"
			}
			t.Run(name, func(t *testing.T) {
				setupStorageHandlerTest(t)
				storageCheckLoginToBrowse = func() (bool, error) { return identity.userID > 1, nil }
				writeStorageHandlerFixture(t, storageBindingFile, "private-content")
				allowStorageBindingActor(t, identity.userID)
				values := storageBindingValues(identity.userID)
				for key, value := range identity.extra {
					values[key] = value
				}
				browser := storageBindingBrowser(t, values)
				cookies := []*http.Cookie{browser.sessionCookie}
				if bound {
					cookies = append(cookies, browser.deviceCookie, browser.fingerprintCookie)
				}
				// Channel markers never replace either binding. The production
				// automation guard additionally refuses /storage/ altogether.
				request := rootPageNavigation("/api/get-results", cookies...)
				request.Header.Set(auth_generation.AutomationHeader, "1")
				pipelineAllowed := false
				fingerprint_check.WithFingerprintCheck(device_id_check.WithDeviceIDCheck(
					func(http.ResponseWriter, *http.Request) { pipelineAllowed = true },
				))(httptest.NewRecorder(), request)
				wantAllowed := bound || identity.userID <= 1
				if pipelineAllowed != wantAllowed {
					t.Fatalf("pipeline binding verdict = %v, want %v", pipelineAllowed, wantAllowed)
				}
				response := httptest.NewRecorder()
				ServeStorage(response, rootPageNavigation("/storage/"+storageBindingFile, cookies...))
				if wantAllowed {
					if response.Code != http.StatusOK || response.Body.String() != "private-content" {
						t.Fatalf("bound/guest storage = %d %q", response.Code, response.Body.String())
					}
				} else {
					anonymous := httptest.NewRecorder()
					ServeStorage(anonymous, httptest.NewRequest(http.MethodGet, "/storage/"+storageBindingFile, nil))
					if response.Code != http.StatusNotFound || response.Body.String() != anonymous.Body.String() ||
						!reflect.DeepEqual(response.Header(), anonymous.Header()) {
						t.Fatalf("unbound storage response differs from anonymous: %d %v %q vs %d %v %q",
							response.Code, response.Header(), response.Body.String(), anonymous.Code, anonymous.Header(), anonymous.Body.String())
					}
				}
				assertProtectedStorageHeaders(t, response)
			})
		}
	}
}

func TestStorageRejectsPartialOrMismatchedBrowserBinding(t *testing.T) {
	for _, policy := range []struct {
		name          string
		loginToBrowse bool
	}{
		{"login-required", true},
		{"guest-browsing", false},
	} {
		t.Run(policy.name, func(t *testing.T) {
			for _, binding := range []struct{ name, device, fingerprint string }{
				{"missing-both", "", ""},
				{"missing-device", "", rootHandlerTestFingerprint},
				{"missing-fingerprint", rootHandlerTestDeviceID, ""},
				{"wrong-device", "other", rootHandlerTestFingerprint},
				{"wrong-fingerprint", rootHandlerTestDeviceID, "other"},
			} {
				t.Run(binding.name, func(t *testing.T) {
					setupStorageHandlerTest(t)
					// Match new and decoded sessions to the production cookie policy.
					e_sessions.Store.Options = e_sessions.SessionCookieOptions()
					storageCheckLoginToBrowse = func() (bool, error) { return policy.loginToBrowse, nil }
					storageAuthenticationGenerationMatches = func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) {
						t.Fatal("unbound storage must fall back before querying authenticated state")
						return false, nil
					}
					const publicFile = "104/8/original/public.txt"
					writeStorageHandlerFixture(t, storageBindingFile, "private-content")
					writeStorageHandlerFixture(t, publicFile, "public-content")
					storageAuthorizeRead = func(_ context.Context, _ dbutils.Querier, _ *sql.DB,
						actor dbutils.RequestActorContext, file dtt_1_row_read.StorageReadRequest,
					) (dtt_1_row_read.StorageReadDecision, error) {
						if actor.UserID != 1 || actor.UserRole != "guest" || actor.IsAdmin {
							t.Fatalf("unbound request retained signed-in authority: %#v", actor)
						}
						if file.TableUID == "104" && file.ParentRowID == 8 && file.Filename == "public.txt" {
							return dtt_1_row_read.StorageReadAllowed, nil
						}
						return dtt_1_row_read.StorageReadForbidden, nil
					}
					anonymous := httptest.NewRecorder()
					ServeStorage(anonymous, rootPageNavigation("/storage/"+storageBindingFile))
					values := storageBindingValues(42)
					values["user_role"] = "admin"
					browser := storageBindingBrowser(t, values)
					request := rootPageNavigation("/storage/"+storageBindingFile, browser.sessionCookie)
					if binding.device != "" {
						request.AddCookie(&http.Cookie{Name: e_sessions.DeviceIDCookieName(), Value: binding.device})
					}
					if binding.fingerprint != "" {
						request.AddCookie(&http.Cookie{Name: e_sessions.FingerprintCookieName(), Value: binding.fingerprint})
					}
					response := httptest.NewRecorder()
					ServeStorage(response, request)
					if response.Code != http.StatusNotFound || response.Code != anonymous.Code || response.Body.String() != anonymous.Body.String() {
						t.Fatalf("invalid binding response = %d %q, anonymous = %d %q",
							response.Code, response.Body.String(), anonymous.Code, anonymous.Body.String())
					}
					assertProtectedStorageHeaders(t, response)
					responseHeaders := storageGuestResponseHeaders(t, response, !policy.loginToBrowse)
					anonymousHeaders := storageGuestResponseHeaders(t, anonymous, !policy.loginToBrowse)
					if !reflect.DeepEqual(responseHeaders, anonymousHeaders) {
						t.Fatalf("invalid binding headers = %v, anonymous = %v", responseHeaders, anonymousHeaders)
					}
					if policy.loginToBrowse {
						return
					}
					// Replay every response cookie through real authorization and delivery.
					for _, file := range []struct {
						path, body string
						status     int
					}{
						{publicFile, "public-content", http.StatusOK},
						{storageBindingFile, anonymous.Body.String(), http.StatusNotFound},
					} {
						followup := httptest.NewRecorder()
						ServeStorage(followup, rootPageNavigation("/storage/"+file.path, response.Result().Cookies()...))
						if followup.Code != file.status || followup.Body.String() != file.body {
							t.Fatalf("guest replay %s = %d %q, want %d %q", file.path,
								followup.Code, followup.Body.String(), file.status, file.body)
						}
						assertProtectedStorageHeaders(t, followup)
					}
				})
			}
		})
	}
}

// Compare every header, normalizing only the functional session's value and expiry.
// WO91 expires guest browser bindings instead of enrolling a fresh device.
// Decode each session Set-Cookie directly so no cached request session can hide a leak.
func storageGuestResponseHeaders(t *testing.T, response *httptest.ResponseRecorder, wantGuest bool) http.Header {
	t.Helper()
	headers := response.Header().Clone()
	cookies := response.Result().Cookies()
	wantCookies := 0
	if wantGuest {
		wantCookies = 3
	}
	if len(cookies) != wantCookies || len(headers.Values("Set-Cookie")) != wantCookies {
		t.Fatalf("fallback wrote %d cookies, want %d", len(cookies), wantCookies)
	}
	headers.Del("Set-Cookie")
	seen := make(map[string]bool)
	for _, cookie := range cookies {
		if seen[cookie.Name] || strings.Contains(cookie.Value, rootHandlerTestDeviceID) ||
			strings.Contains(cookie.Value, rootHandlerTestFingerprint) {
			t.Fatalf("fallback cookie %s is duplicated or carries a stolen binding", cookie.Name)
		}
		seen[cookie.Name] = true
		switch cookie.Name {
		case e_sessions.SessionName:
			if cookie.Value == "" || cookie.MaxAge <= 0 {
				t.Fatal("fallback must keep a live functional session cookie")
			}
			values := make(map[interface{}]interface{})
			if err := securecookie.DecodeMulti(cookie.Name, cookie.Value, &values, e_sessions.GetStore().Codecs...); err != nil {
				t.Fatalf("decode fallback session: %v", err)
			}
			if values["user_id"] != 1 || len(values) != 1 {
				t.Fatal("fallback session must contain only guest identity, without browser bindings")
			}
			cookie.Value = "fresh-guest-value"
			if !cookie.Expires.IsZero() {
				remaining := time.Until(cookie.Expires)
				if delta := remaining - time.Duration(cookie.MaxAge)*time.Second; delta < -5*time.Second || delta > 5*time.Second {
					t.Fatalf("fallback cookie %s has an unexpected expiry", cookie.Name)
				}
				cookie.Expires = time.Unix(1, 0).UTC()
			}
		case e_sessions.DeviceIDCookieName(), e_sessions.FingerprintCookieName():
			if cookie.Value != "" || cookie.MaxAge != -1 || !cookie.Expires.Equal(time.Unix(0, 0)) ||
				cookie.Path != "/" || !cookie.HttpOnly || cookie.Secure != e_sessions.ShouldUseSecureCookies() || cookie.SameSite != http.SameSiteLaxMode {
				t.Fatalf("fallback binding cookie %s was not expired with WO91's attributes", cookie.Name)
			}
		default:
			t.Fatalf("unexpected fallback cookie %s", cookie.Name)
		}
		headers.Add("Set-Cookie", cookie.String())
	}
	return headers
}

func TestUnboundStorageFallsBackToGuestWithoutDisclosingBindings(t *testing.T) {
	for _, guestCanRead := range []bool{false, true} {
		t.Run(map[bool]string{false: "protected", true: "public-row"}[guestCanRead], func(t *testing.T) {
			setupStorageHandlerTest(t)
			storageCheckLoginToBrowse = func() (bool, error) { return false, nil }
			writeStorageHandlerFixture(t, storageBindingFile, "row-content")
			storageAuthorizeRead = func(_ context.Context, _ dbutils.Querier, _ *sql.DB,
				actor dbutils.RequestActorContext, _ dtt_1_row_read.StorageReadRequest,
			) (dtt_1_row_read.StorageReadDecision, error) {
				if actor.UserID != 1 || actor.IsAdmin || actor.UserRole != "guest" {
					t.Fatalf("unbound request retained signed-in authority: %#v", actor)
				}
				if guestCanRead {
					return dtt_1_row_read.StorageReadAllowed, nil
				}
				return dtt_1_row_read.StorageReadForbidden, nil
			}
			values := storageBindingValues(42)
			values["user_role"] = "admin"
			browser := storageBindingBrowser(t, values)
			response := httptest.NewRecorder()
			ServeStorage(response, rootPageNavigation("/storage/"+storageBindingFile, browser.sessionCookie))
			wantStatus := http.StatusNotFound
			if guestCanRead {
				wantStatus = http.StatusOK
			}
			if response.Code != wantStatus {
				t.Fatalf("guest fallback status = %d, want %d", response.Code, wantStatus)
			}
			assertProtectedStorageHeaders(t, response)
			for _, cookie := range response.Result().Cookies() {
				if cookie.Value == rootHandlerTestDeviceID || cookie.Value == rootHandlerTestFingerprint {
					t.Fatalf("guest response disclosed an authenticated binding in %s", cookie.Name)
				}
			}
			// Applying every cookie the response wrote must still act only as a guest.
			followup := rootPageNavigation("/storage/"+storageBindingFile, response.Result().Cookies()...)
			guestSession, err := e_sessions.Load(followup)
			if err != nil || guestSession.Values["user_id"] != 1 || guestSession.Values["authenticated"] != nil {
				t.Fatalf("fallback session retained authenticated identity: %v, %v", guestSession.Values, err)
			}
			if e_sessions.RequestCarriesSessionBinding(followup, &sessions.Session{Values: values}) {
				t.Fatal("guest response supplied the stolen session's missing proof")
			}
		})
	}
}

func TestStorageBindingDoesNotBypassGenerationRevocation(t *testing.T) {
	setupStorageHandlerTest(t)
	storageCheckLoginToBrowse = func() (bool, error) { return true, nil }
	writeStorageHandlerFixture(t, storageBindingFile, "private-content")
	generationChecks := 0
	storageAuthenticationGenerationMatches = func(_ context.Context, _ auth_generation.Querier, session *sessions.Session, userID int) (bool, error) {
		generationChecks++
		if userID != 42 || session.Values[auth_generation.SessionKey] != int64(7) {
			t.Fatalf("wrong generation check: user %d, generation %v", userID, session.Values[auth_generation.SessionKey])
		}
		return false, nil
	}
	browser := storageBindingBrowser(t, storageBindingValues(42))
	response := httptest.NewRecorder()
	ServeStorage(response, rootPageNavigation("/storage/"+storageBindingFile,
		browser.sessionCookie, browser.deviceCookie, browser.fingerprintCookie))
	if response.Code != http.StatusNotFound || generationChecks != 1 {
		t.Fatalf("stale generation = %d, checks %d", response.Code, generationChecks)
	}
	cleared, err := e_sessions.Load(rootPageNavigation("/", response.Result().Cookies()...))
	if err != nil || cleared.Values["user_id"] != nil || cleared.Values[auth_generation.SessionKey] != nil {
		t.Fatalf("stale identity survived: %v, %v", cleared.Values, err)
	}
}

func TestPublicStorageCachingIsIndependentOfSessionBinding(t *testing.T) {
	setupStorageHandlerTest(t)
	const publicPath = "/storage/service_catalog_logos/public.png"
	writeStorageHandlerFixture(t, "service_catalog_logos/public.png", "public-content")
	storageCheckLoginToBrowse = func() (bool, error) { t.Fatal("public logo read login policy"); return true, nil }
	storageAuthenticationGenerationMatches = func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) {
		t.Fatal("public logo read authentication state")
		return false, nil
	}
	baseline := httptest.NewRecorder()
	ServeStorage(baseline, httptest.NewRequest(http.MethodGet, publicPath, nil))
	if baseline.Code != http.StatusOK || baseline.Body.String() != "public-content" {
		t.Fatalf("anonymous public read = %d %q", baseline.Code, baseline.Body.String())
	}
	if cookies := baseline.Header().Values("Set-Cookie"); len(cookies) != 0 {
		t.Fatalf("anonymous public read set cookies: %v", cookies)
	}
	for _, userID := range []int{1, 42} {
		browser := storageBindingBrowser(t, storageBindingValues(userID))
		response := httptest.NewRecorder()
		ServeStorage(response, rootPageNavigation(publicPath, browser.sessionCookie))
		if response.Code != baseline.Code || response.Body.String() != baseline.Body.String() ||
			!reflect.DeepEqual(response.Header(), baseline.Header()) {
			t.Fatalf("public response/caching changed for session user %d: %d %v", userID, response.Code, response.Header())
		}
		if cookies := response.Header().Values("Set-Cookie"); len(cookies) != 0 {
			t.Fatalf("unbound public read set cookies for session user %d: %v", userID, cookies)
		}
		conditional := rootPageNavigation(publicPath, browser.sessionCookie)
		conditional.Header.Set("If-Modified-Since", baseline.Header().Get("Last-Modified"))
		revalidation := httptest.NewRecorder()
		ServeStorage(revalidation, conditional)
		if revalidation.Code != http.StatusNotModified {
			t.Fatalf("public revalidation = %d", revalidation.Code)
		}
		if cookies := revalidation.Header().Values("Set-Cookie"); len(cookies) != 0 {
			t.Fatalf("public revalidation set cookies for session user %d: %v", userID, cookies)
		}
	}
}
