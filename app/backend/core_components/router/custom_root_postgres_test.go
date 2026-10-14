// custom_root_postgres_test.go
// Proves the real system_config reader drives the root/asset matrix without a migration.
// Uses the neighbouring disposable PostgreSQL fixture, temporary files and signed test cookies.
// Never reads installation credentials or changes an existing database.
package router

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/sign_in_revocation"
	"github.com/gorilla/sessions"
)

func TestCustomRootPostgresConfigurationMatrix(t *testing.T) {
	db := routeIdentityDisposableDB(t)
	if _, err := db.Exec(`CREATE TABLE public.system_config (
        key text PRIMARY KEY, boolean_value boolean, text_value text, json_value jsonb);
        INSERT INTO public.system_config(key,boolean_value) VALUES ('first_run',false),('login_to_browse',false);`); err != nil {
		t.Fatal(err)
	}
	for _, setting := range []string{"absent", "false", "true", "NULL"} {
		for _, present := range []bool{false, true} {
			for _, loginRequired := range []bool{false, true} {
				for _, userID := range []int{0, 1, 42} {
					t.Run(fmt.Sprintf("setting=%s/present=%t/login=%t/user=%d", setting, present, loginRequired, userID), func(t *testing.T) {
						setupCustomRootFixture(t, false, present, loginRequired)
						backend.Db = db
						if _, err := db.Exec(`DELETE FROM public.system_config WHERE key=$1`, backend.DisplayIndexHTMLAtStartupKey); err != nil {
							t.Fatal(err)
						}
						if setting != "absent" {
							var value any
							if setting != "NULL" {
								value = setting == "true"
							}
							if _, err := db.Exec(`INSERT INTO public.system_config(key,boolean_value) VALUES($1,$2)`, backend.DisplayIndexHTMLAtStartupKey, value); err != nil {
								t.Fatal(err)
							}
						}
						if _, err := db.Exec(`UPDATE public.system_config SET boolean_value=$1 WHERE key='login_to_browse'`, loginRequired); err != nil {
							t.Fatal(err)
						}
						for _, method := range []string{"GET", "HEAD"} {
							for _, target := range []string{"/", "/.site_root/styles/site.css"} {
								response := customRootResponse(t, method, target, userID)
								custom := setting == "true" && present
								want := 200
								if target != "/" && !custom {
									want = 404
								}
								if loginRequired && (userID == 0 || (userID == 1 && (custom || target != "/"))) {
									want = 303
								}
								if response.Code != want {
									t.Fatal(method, target, response.Code, want, response.Body.String())
								}
								if target != "/" || custom {
									assertSiteRootCacheHeaders(t, response)
								}
								if target == "/" && want == 200 && method == "GET" && strings.Contains(response.Body.String(), "custom-root-document") != custom {
									t.Fatal("database switch was not authoritative", response.Body.String())
								}
								if target != "/" && want == 200 {
									assertCustomRootHeaders(t, response, "text/css; charset=utf-8")
								}
							}
						}
					})
				}
			}
		}
	}
}

func TestCustomRootAuthenticationGenerationErrorPostgres(t *testing.T) {
	db := routeIdentityDisposableDB(t)
	if _, err := db.Exec(`CREATE TABLE public.system_config (
        key text PRIMARY KEY, boolean_value boolean, text_value text, json_value jsonb);
        INSERT INTO public.system_config(key,boolean_value) VALUES
        ('first_run',false),('login_to_browse',true),('display_index_html_at_startup',true);`); err != nil {
		t.Fatal(err)
	}
	setupCustomRootFixture(t, true, true, true)
	backend.Db, backend.DbConfidential = db, db
	withRootAuthenticationGenerationMatch(t, func(ctx context.Context, querier auth_generation.Querier, session *sessions.Session, userID int) (bool, error) {
		session.Values[auth_generation.SessionKey] = int64(1)
		// Matches answers "no match" before querying when the sign-in id is missing (native run 14.10. 12:41: 303).
		session.Values[sign_in_revocation.SessionKey] = "acting"
		// The credential tables are deliberately unavailable in this disposable DB.
		// Exercise the real generation query's PostgreSQL error, not a mocked refusal.
		return auth_generation.Matches(ctx, querier, session, userID)
	})
	handler := customRootCacheMux(t)
	for _, target := range []string{"/", "/.site_root/styles/site.css"} {
		for _, method := range []string{"GET", "HEAD"} {
			request := httptest.NewRequest(method, target, nil)
			attachRootHandlerSessionUser(t, request, 42)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != 503 || !strings.Contains(response.Body.String(), "authentication state unavailable") {
				t.Fatal(method, target, response.Code, response.Body.String())
			}
			assertSiteRootCacheHeaders(t, response)
		}
	}
}
