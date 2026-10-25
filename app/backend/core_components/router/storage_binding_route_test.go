// storage_binding_route_test.go
// Proves anonymous equivalence through the registered storage route's complete pipeline.
// Connects real cookie decoding, automation/delegation guards and filesystem delivery.
// Prevents an earlier stage from disclosing an unbound session's identity or validity.
package router

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/site_assistant"
	"easelect/backend/pipeline"

	"github.com/gorilla/securecookie"
	"github.com/gorilla/sessions"
)

// This driver answers the real automation guard's confidential policy query.
// Neither the automation guard nor the delegation guard is replaced.
type storageRoutePolicy struct {
	apiOnly bool
	queries atomic.Int64
}

type storageRoutePolicyConn struct{ policy *storageRoutePolicy }

func (p *storageRoutePolicy) Open(string) (driver.Conn, error) {
	return &storageRoutePolicyConn{p}, nil
}
func (*storageRoutePolicyConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("unexpected prepare")
}
func (*storageRoutePolicyConn) Close() error { return nil }
func (*storageRoutePolicyConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("unexpected transaction")
}
func (c *storageRoutePolicyConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.policy.queries.Add(1)
	if !strings.Contains(query, "ur.api_only") || len(args) != 1 || args[0].Value != int64(42) {
		return nil, fmt.Errorf("unexpected identity query")
	}
	return &rootHandlerMockRows{
		cols: []string{"api_only", "authentication_generation", "enabled"},
		vals: []driver.Value{c.policy.apiOnly, int64(7), true},
	}, nil
}

func setupStorageBindingRoute(t *testing.T, policy *storageRoutePolicy, debugLogging bool) http.Handler {
	t.Helper()
	setupStorageHandlerTest(t)
	e_sessions.Store.Options = e_sessions.SessionCookieOptions()
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("REQUEST_LOGGING_DEBUG", "false")
	if debugLogging {
		t.Setenv("REQUEST_LOGGING_DEBUG", "true")
	}
	name := fmt.Sprintf("storage_binding_policy_%d", atomic.AddInt64(&rootHandlerDriverCounter, 1))
	sql.Register(name, policy)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	originalDB := backend.DbConfidential
	backend.DbConfidential = db
	definitions, registered := routeDefinitions, registeredFunctions
	frontend, apps := localFrontendDir, localAppsDir
	t.Cleanup(func() {
		backend.DbConfidential = originalDB
		_ = db.Close()
		routeDefinitions, registeredFunctions = definitions, registered
		localFrontendDir, localAppsDir = frontend, apps
	})
	RegisterRoutes("frontend", localStorageDir)
	mux := http.NewServeMux()
	for _, route := range GetRouteDefinitions() {
		if route.HandlerName == "router.ServeStorage" {
			ctx := pipeline.RouteContext{URLPattern: route.UrlPattern, HandlerName: route.HandlerName, DB: backend.Db}
			mux.HandleFunc(route.UrlPattern, pipeline.BuildHandler(route.HandlerFunc, ctx, pipeline.GetProfile(route.HandlerName)))
			return mux
		}
	}
	t.Fatal("storage route is not registered")
	return nil
}

func serveStorageBindingRoute(handler http.Handler, request *http.Request) *httptest.ResponseRecorder {
	// Keep the real rate-limit stage, without touching its database configuration.
	request.Header.Set("X-Bypass-Ratelimit", "test-mode")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func storageRouteIdentity(t *testing.T, kind string) map[interface{}]interface{} {
	t.Helper()
	values := storageBindingValues(42)
	switch kind {
	case "administrator":
		values["user_role"] = "admin"
	case "automation":
		values[auth_generation.AutomationSessionKey] = true
		values["api_only"] = true
	case "delegated", "expired-delegated", "mismatched-delegated":
		store := site_assistant.NewStore()
		previous := site_assistant.DefaultStore
		site_assistant.DefaultStore = store
		t.Cleanup(func() { site_assistant.DefaultStore = previous })
		now := time.Now()
		store.SetClock(func() time.Time { return now })
		delegationUser := 42
		if kind == "mismatched-delegated" {
			delegationUser = 43
		}
		_, delegation, err := store.Issue(delegationUser, "storage-binding-test", "localhost", time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		values[site_assistant.SessionDelegationKey] = delegation.ID
		values["user_role"] = "admin"
		if kind == "expired-delegated" {
			now = now.Add(2 * time.Minute)
		}
	}
	return values
}

// Compare decoded functional session contents without normalizing browser bindings.
// WO91 removes both guest binding entries; neither may survive even as an empty value.
func storageRouteGuestCookies(t *testing.T, response *httptest.ResponseRecorder) map[interface{}]interface{} {
	t.Helper()
	values := map[interface{}]interface{}{}
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == e_sessions.SessionName {
			if err := securecookie.DecodeMulti(cookie.Name, cookie.Value, &values, e_sessions.GetStore().Codecs...); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, key := range []string{"device_id", "fingerprint_hash"} {
		if _, exists := values[key]; exists {
			t.Fatalf("guest session retained browser binding %s", key)
		}
	}
	return values
}

func TestRegisteredStorageUnboundAnswerEqualsAnonymous(t *testing.T) {
	for _, loginToBrowse := range []bool{false, true} {
		for _, kind := range []string{"ordinary", "administrator", "automation", "delegated", "expired-delegated"} {
			for _, binding := range []struct{ name, device, fingerprint string }{
				{"none", "", ""},
				{"device-only", rootHandlerTestDeviceID, ""},
				{"fingerprint-only", "", rootHandlerTestFingerprint},
				{"wrong-device", "other", rootHandlerTestFingerprint},
				{"wrong-fingerprint", rootHandlerTestDeviceID, "other"},
				{"both-wrong", "other-device", "other-fingerprint"},
			} {
				t.Run(fmt.Sprintf("login=%t/%s/%s", loginToBrowse, kind, binding.name), func(t *testing.T) {
					values := storageRouteIdentity(t, kind)
					policy := &storageRoutePolicy{apiOnly: kind == "automation"}
					// Logging is an identity reader too, before either channel guard.
					handler := setupStorageBindingRoute(t, policy, true)
					storageCheckLoginToBrowse = func() (bool, error) { return loginToBrowse, nil }
					storageAuthenticationGenerationMatches = func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) {
						t.Fatal("unbound route queried authentication generation")
						return false, nil
					}
					const publicFile = "104/8/original/public.txt"
					writeStorageHandlerFixture(t, storageBindingFile, "private-content")
					writeStorageHandlerFixture(t, publicFile, "public-content")
					storageAuthorizeRead = func(_ context.Context, _ dbutils.Querier, _ *sql.DB, actor dbutils.RequestActorContext, file dtt_1_row_read.StorageReadRequest) (dtt_1_row_read.StorageReadDecision, error) {
						if actor.UserID != 1 || actor.UserRole != "guest" || actor.IsAdmin {
							t.Fatalf("unbound route retained authority: %#v", actor)
						}
						if file.ParentRowID == 8 {
							return dtt_1_row_read.StorageReadAllowed, nil
						}
						return dtt_1_row_read.StorageReadForbidden, nil
					}
					browser := storageBindingBrowser(t, values)
					for _, file := range []string{storageBindingFile, publicFile} {
						anonymous := serveStorageBindingRoute(handler, rootPageNavigation("/storage/"+file))
						request := rootPageNavigation("/storage/"+file, browser.sessionCookie)
						if binding.device != "" {
							request.AddCookie(&http.Cookie{Name: e_sessions.DeviceIDCookieName(), Value: binding.device})
						}
						if binding.fingerprint != "" {
							request.AddCookie(&http.Cookie{Name: e_sessions.FingerprintCookieName(), Value: binding.fingerprint})
						}
						response := serveStorageBindingRoute(handler, request)
						wantStatus := http.StatusNotFound
						if file == publicFile && !loginToBrowse {
							wantStatus = http.StatusOK
						}
						if response.Code != wantStatus || response.Code != anonymous.Code || response.Body.String() != anonymous.Body.String() {
							t.Fatalf("route %s = %d %q, anonymous = %d %q", file, response.Code, response.Body.String(), anonymous.Code, anonymous.Body.String())
						}
						assertProtectedStorageHeaders(t, response)
						if !reflect.DeepEqual(storageGuestResponseHeaders(t, response, !loginToBrowse), storageGuestResponseHeaders(t, anonymous, !loginToBrowse)) ||
							!reflect.DeepEqual(storageRouteGuestCookies(t, response), storageRouteGuestCookies(t, anonymous)) {
							t.Fatal("unbound route headers or decoded cookies differ from anonymous")
						}
						if policy.queries.Load() != 0 {
							t.Fatal("unbound route read confidential identity state")
						}
					}
				})
			}
		}
	}
}

func TestRegisteredStorageBoundGuardsAreUnchanged(t *testing.T) {
	for _, tc := range []struct {
		kind   string
		status int
		body   string
	}{
		{"ordinary", http.StatusOK, "private-content"},
		{"administrator", http.StatusOK, "private-content"},
		{"automation", http.StatusForbidden, "automation_api_channel_required"},
		{"delegated", http.StatusOK, "private-content"},
		{"expired-delegated", http.StatusUnauthorized, "site_assistant_delegation_expired"},
		{"mismatched-delegated", http.StatusUnauthorized, "site_assistant_delegation_mismatch"},
		{"revoked-generation", http.StatusNotFound, "file not found"},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			values := storageRouteIdentity(t, tc.kind)
			policy := &storageRoutePolicy{apiOnly: tc.kind == "automation"}
			handler := setupStorageBindingRoute(t, policy, false)
			storageCheckLoginToBrowse = func() (bool, error) { return true, nil }
			writeStorageHandlerFixture(t, storageBindingFile, "private-content")
			allowStorageBindingActor(t, 42)
			checks := 0
			storageAuthenticationGenerationMatches = func(_ context.Context, database auth_generation.Querier, session *sessions.Session, userID int) (bool, error) {
				checks++
				if database != backend.DbConfidential || userID != 42 || session.Values[auth_generation.SessionKey] != int64(7) {
					t.Fatal("bound generation check lost its identity or confidential pool")
				}
				return tc.kind != "revoked-generation", nil
			}
			browser := storageBindingBrowser(t, values)
			request := rootPageNavigation("/storage/"+storageBindingFile, browser.sessionCookie, browser.deviceCookie, browser.fingerprintCookie)
			request.Header.Set(auth_generation.AutomationHeader, "1")
			response := serveStorageBindingRoute(handler, request)
			if response.Code != tc.status || !strings.Contains(response.Body.String(), tc.body) || policy.queries.Load() != 1 {
				t.Fatalf("bound route = %d %q, policy reads %d", response.Code, response.Body.String(), policy.queries.Load())
			}
			wantChecks := 0
			if tc.status == http.StatusOK || tc.kind == "revoked-generation" {
				wantChecks = 1
			}
			if checks != wantChecks {
				t.Fatalf("bound generation checks = %d, want %d", checks, wantChecks)
			}
			if tc.kind == "revoked-generation" {
				cleared, err := e_sessions.Load(rootPageNavigation("/", response.Result().Cookies()...))
				if err != nil || cleared.Values["user_id"] != nil || cleared.Values[auth_generation.SessionKey] != nil {
					t.Fatal("bound revoked identity survived")
				}
			}
		})
	}
}

func TestStorageDowngradeIsExclusiveToStorageProfile(t *testing.T) {
	for _, profile := range []struct {
		name    string
		profile pipeline.RouteProfile
	}{
		{"default", pipeline.DefaultProfile},
		{"login-only", pipeline.LoginOnlyProfile},
		{"admin", pipeline.AdminProfile},
		{"SSE", pipeline.AccessControlNoTxProfile},
		{"public", pipeline.PublicProfile},
		{"sign-out", pipeline.SignOutProfile},
	} {
		t.Run(profile.name, func(t *testing.T) {
			policy := &storageRoutePolicy{apiOnly: true}
			setupStorageBindingRoute(t, policy, false)
			ctx := pipeline.RouteContext{URLPattern: "/storage/", HandlerName: "router.ServeStorage", DB: backend.Db}
			handler := pipeline.BuildHandler(ServeStorage, ctx, profile.profile)
			browser := storageBindingBrowser(t, storageRouteIdentity(t, "automation"))
			response := serveStorageBindingRoute(handler, rootPageNavigation("/storage/"+storageBindingFile, browser.sessionCookie))
			if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "automation_api_channel_required") || policy.queries.Load() != 1 {
				t.Fatalf("other profile changed unbound behavior: %d %q", response.Code, response.Body.String())
			}
		})
	}
}

func TestRegisteredStoragePublicLogoBindingAnonymousEquivalence(t *testing.T) {
	for _, kind := range []string{"ordinary", "administrator", "automation", "delegated", "expired-delegated"} {
		for _, binding := range []struct{ name, device, fingerprint string }{
			{"none", "", ""},
			{"device-only", rootHandlerTestDeviceID, ""},
			{"fingerprint-only", "", rootHandlerTestFingerprint},
			{"wrong-device", "other", rootHandlerTestFingerprint},
			{"wrong-fingerprint", rootHandlerTestDeviceID, "other"},
			{"both-wrong", "other-device", "other-fingerprint"},
			{"bound", rootHandlerTestDeviceID, rootHandlerTestFingerprint},
		} {
			t.Run(kind+"/"+binding.name, func(t *testing.T) {
				values := storageRouteIdentity(t, kind)
				policy := &storageRoutePolicy{apiOnly: kind == "automation"}
				handler := setupStorageBindingRoute(t, policy, true)
				storageCheckLoginToBrowse = func() (bool, error) { t.Fatal("logo read browsing policy"); return true, nil }
				storageAuthenticationGenerationMatches = func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) {
					t.Fatal("logo read authentication generation")
					return false, nil
				}
				const file = "/storage/service_catalog_logos/public.png"
				writeStorageHandlerFixture(t, "service_catalog_logos/public.png", "public-content")
				baseline := serveStorageBindingRoute(handler, rootPageNavigation(file))
				browser := storageBindingBrowser(t, values)
				cookies := []*http.Cookie{browser.sessionCookie}
				if binding.device != "" {
					cookies = append(cookies, &http.Cookie{Name: e_sessions.DeviceIDCookieName(), Value: binding.device})
				}
				if binding.fingerprint != "" {
					cookies = append(cookies, &http.Cookie{Name: e_sessions.FingerprintCookieName(), Value: binding.fingerprint})
				}
				response := serveStorageBindingRoute(handler, rootPageNavigation(file, cookies...))
				wantStatus := http.StatusOK
				wantQueries := int64(0)
				if binding.name == "bound" {
					wantQueries = 1
					if kind == "automation" {
						wantStatus = http.StatusForbidden
						if !strings.Contains(response.Body.String(), "automation_api_channel_required") {
							t.Fatal("bound logo lost the automation guard")
						}
					}
					if kind == "expired-delegated" {
						wantStatus = http.StatusUnauthorized
						if !strings.Contains(response.Body.String(), "site_assistant_delegation_expired") {
							t.Fatal("bound logo lost the delegation guard")
						}
					}
				}
				if baseline.Code != http.StatusOK || response.Code != wantStatus || policy.queries.Load() != wantQueries {
					t.Fatalf("logo route = %d, anonymous = %d", response.Code, baseline.Code)
				}
				if wantStatus == http.StatusOK {
					expectedHeaders := baseline.Header().Clone()
					delegatedBound := binding.name == "bound" && kind == "delegated"
					if delegatedBound {
						// The existing delegation guard sets no-store even for public logos.
						expectedHeaders.Set("Cache-Control", "no-store")
					}
					if response.Body.String() != baseline.Body.String() || !reflect.DeepEqual(response.Header(), expectedHeaders) {
						t.Fatal("public logo delivery or caching changed")
					}
					if cache := baseline.Header().Get("Cache-Control"); strings.Contains(cache, "private") || strings.Contains(cache, "no-store") || response.Header().Get("Last-Modified") == "" {
						t.Fatal("public logo lost its public caching or revalidation")
					}
					anonymousConditional := rootPageNavigation(file)
					anonymousConditional.Header.Set("If-Modified-Since", baseline.Header().Get("Last-Modified"))
					anonymousRevalidation := serveStorageBindingRoute(handler, anonymousConditional)
					expectedRevalidationHeaders := anonymousRevalidation.Header().Clone()
					if delegatedBound {
						expectedRevalidationHeaders.Set("Cache-Control", "no-store")
					}
					request := rootPageNavigation(file, cookies...)
					request.Header.Set("If-Modified-Since", baseline.Header().Get("Last-Modified"))
					if conditional := serveStorageBindingRoute(handler, request); conditional.Code != http.StatusNotModified || conditional.Code != anonymousRevalidation.Code ||
						conditional.Body.String() != anonymousRevalidation.Body.String() || !reflect.DeepEqual(conditional.Header(), expectedRevalidationHeaders) {
						t.Fatalf("logo revalidation = %d", conditional.Code)
					}
					if policy.queries.Load() != 2*wantQueries {
						t.Fatal("unbound logo revalidation read confidential identity state")
					}
				}
			})
		}
	}
}

func TestRegisteredStorageBoundFileDelivery(t *testing.T) {
	handler := setupStorageBindingRoute(t, &storageRoutePolicy{}, false)
	storageCheckLoginToBrowse = func() (bool, error) { return true, nil }
	writeStorageHandlerFixture(t, storageBindingFile, "0123456789")
	allowStorageBindingActor(t, 42)
	browser := storageBindingBrowser(t, storageBindingValues(42))
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		request := rootPageNavigation("/storage/"+storageBindingFile, browser.sessionCookie, browser.deviceCookie, browser.fingerprintCookie)
		request.Method = method
		request.Header.Set("Range", "bytes=2-4")
		response := serveStorageBindingRoute(handler, request)
		// The registered method wrapper gives HEAD handlers GET semantics;
		// net/http suppresses that body on the wire, outside this recorder.
		if response.Code != http.StatusPartialContent || response.Body.String() != "234" || response.Header().Get("Content-Range") != "bytes 2-4/10" {
			t.Fatalf("bound %s range = %d %q %v", method, response.Code, response.Body.String(), response.Header())
		}
		assertProtectedStorageHeaders(t, response)
	}
}
