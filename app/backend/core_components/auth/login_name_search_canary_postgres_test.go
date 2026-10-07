// login_name_search_canary_postgres_test.go
// Exercises LT10 through the actual public dataset search response.
// Bridges disposable account credentials, both actor roles and the paged listing.
// Proves indexed and NULL-vector searches find public names and never private ones.
package auth_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"easelect/backend/core_components/auth"
	"easelect/backend/core_components/auth/credentials"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	sessions "easelect/backend/core_components/sessions"
	"github.com/google/uuid"
)

// applyLaterReleaseMigrations brings the login-name fixture to the full release schema that the listing reads (for
// example dataset_media.hidden), applying every migration after the login-name ones in order.
func applyLaterReleaseMigrations(t *testing.T, db *sql.DB) {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join("..", "..", "..", "server_tools", "migrations", "*.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		if filepath.Base(path) < "20261005000015" {
			continue
		}
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(string(body)); err != nil {
			t.Fatalf("%s: %v", filepath.Base(path), err)
		}
	}
}

func TestLoginNamePublicSearchCanaryPostgres(t *testing.T) {
	db := auth.LoginNameDisposableClusterForTest(t)
	applyLaterReleaseMigrations(t, db)
	const password = "disposable-correct-password-123"
	names := []string{"a" + strings.ReplaceAll(uuid.NewString(), "-", ""), "a" + strings.ReplaceAll(uuid.NewString(), "-", "")}
	for index, id := range []int64{91001, 91002} {
		tx, err := db.BeginTx(context.Background(), nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = credentials.ChangeLoginName(tx, id, names[index]); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	// Public controls are unrelated to either random private name. Both an
	// indexed row and an unindexed row must be visible to each search actor.
	if _, err := db.Exec(`UPDATE system_users SET username=CASE id WHEN 91001 THEN 'CanaryPublicAdministrator' ELSE 'CanaryPublicUser' END,
		search_vector_simple=CASE id WHEN 91001 THEN to_tsvector('simple','CanaryPublicAdministrator') ELSE NULL END WHERE id IN (91001,91002)`); err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		request := httptest.NewRequest("POST", "/api/login", nil)
		session, err := sessions.GetOrCreateSession(nil, request)
		if err != nil {
			t.Fatal(err)
		}
		session.Values["csrf_token"] = "search-canary-csrf"
		seed := httptest.NewRecorder()
		if err = sessions.Save(seed, request, session); err != nil {
			t.Fatal(err)
		}
		payload, _ := json.Marshal(map[string]string{"username": name, "password": password, "fingerprint": "search-browser", "csrf_token": "search-canary-csrf"})
		request = httptest.NewRequest("POST", "/api/login", strings.NewReader(string(payload)))
		request.Header.Set("Content-Type", "application/json")
		request.RemoteAddr = "192.0.2.219:1234"
		request.AddCookie(seed.Result().Cookies()[0])
		response := httptest.NewRecorder()
		auth.LoginAPIHandler(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("login status=%d", response.Code)
		}
		var cookie *http.Cookie
		for _, candidate := range response.Result().Cookies() {
			if candidate.Name == sessions.SessionName && candidate.MaxAge >= 0 {
				cookie = candidate
			}
		}
		if cookie == nil {
			t.Fatal("search actor was not signed in")
		}
		for _, query := range append([]string{"CanaryPublicAdministrator", "CanaryPublicUser"}, names...) {
			request = httptest.NewRequest("GET", "/api/get-results?dataset=system_users&search="+url.QueryEscape(query), nil)
			request.AddCookie(cookie)
			response = httptest.NewRecorder()
			read.GetResults(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("search status=%d body=%s", response.Code, response.Body.String())
			}
			var result struct {
				Data []map[string]interface{} `json:"data"`
			}
			if err = json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			want := 0
			if strings.HasPrefix(query, "CanaryPublic") {
				want = 1
			}
			if len(result.Data) != want {
				t.Fatalf("search returned %d rows, want %d", len(result.Data), want)
			}
			for _, private := range names {
				if strings.Contains(response.Body.String(), private) || strings.Contains(response.Header().Get("Location"), private) {
					t.Fatal("private name in search response")
				}
			}
		}
		var retained bool
		if err = db.QueryRow(`SELECT EXISTS(SELECT 1 FROM restricted.users_restricted WHERE login_name=$1)`, name).Scan(&retained); err != nil || !retained {
			t.Fatal("restricted positive control missing", err)
		}
	}
}
