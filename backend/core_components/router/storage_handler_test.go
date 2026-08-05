// storage_handler_test.go
// Verifies strict storage path parsing, guest identity, cache isolation, and HTTP file semantics.
// Stubs only the database authorization decision while exercising the real filesystem handler.
package router

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	e_sessions "easelect/backend/core_components/sessions"
)

func TestParseProtectedStoragePathRejectsNonCanonicalShapes(t *testing.T) {
	testCases := []string{
		"104/7/original",
		"104/7/original/file.png/extra",
		"0/7/original/file.png",
		"104/0/original/file.png",
		"0104/7/original/file.png",
		"104/07/original/file.png",
		"abc/7/original/file.png",
		"104/abc/original/file.png",
		"104/7/640/file.png",
		`104/7/original/bad\file.png`,
		"104/7/original/..",
		"104/7/original/ file.png",
	}
	for _, input := range testCases {
		if parsed, ok := parseProtectedStoragePath(input); ok {
			t.Errorf("parseProtectedStoragePath(%q) = %#v, want rejection", input, parsed)
		}
	}

	for _, variant := range []string{"300", "1000", "2160", "original"} {
		input := "104/7/" + variant + "/104_7_9.png"
		if _, ok := parseProtectedStoragePath(input); !ok {
			t.Errorf("parseProtectedStoragePath(%q) rejected supported variant", input)
		}
	}
}

func TestPublicStorageAllowlistStaysExact(t *testing.T) {
	for _, path := range []string{"project_logo.png", "project_logo.svg", "service_catalog_logos/firefox.svg"} {
		if !isPublicStoragePath(path) {
			t.Errorf("isPublicStoragePath(%q) = false, want true", path)
		}
	}
	for _, path := range []string{"project_logo.png.bak", "nested/project_logo.png", "service_catalog_logos_evil/firefox.svg", "104/7/original/file.png"} {
		if isPublicStoragePath(path) {
			t.Errorf("isPublicStoragePath(%q) = true, want false", path)
		}
	}
}

func TestProtectedSVGDownloadsWhilePublicBrandingRemainsInline(t *testing.T) {
	protectedResponse := httptest.NewRecorder()
	setStorageDownloadHeaders(protectedResponse, "104/7/original/104_7_9.svg")
	if got := protectedResponse.Header().Get("Content-Disposition"); !strings.Contains(got, "attachment") {
		t.Fatalf("protected SVG Content-Disposition = %q, want attachment", got)
	}

	publicResponse := httptest.NewRecorder()
	setStorageDownloadHeaders(publicResponse, "project_logo.svg")
	if got := publicResponse.Header().Get("Content-Disposition"); got != "" {
		t.Fatalf("public branding SVG Content-Disposition = %q, want inline delivery", got)
	}
}

func setupStorageHandlerTest(t *testing.T) *sql.DB {
	t.Helper()
	setupRootHandlerSessionStore(t)

	testDB := openRouterAliasTestDB(t)
	savedDB, savedAdmin := backend.Db, backend.DbAdmin
	savedBasic, savedGuest := backend.DbBasic, backend.DbGuest
	backend.Db = testDB
	backend.DbAdmin = testDB
	backend.DbBasic = testDB
	backend.DbGuest = testDB

	savedStorageDir := localStorageDir
	localStorageDir = t.TempDir()
	savedAuthorizer := storageAuthorizeRead
	savedLoginCheck := storageCheckLoginToBrowse
	t.Cleanup(func() {
		storageAuthorizeRead = savedAuthorizer
		storageCheckLoginToBrowse = savedLoginCheck
		localStorageDir = savedStorageDir
		backend.Db, backend.DbAdmin = savedDB, savedAdmin
		backend.DbBasic, backend.DbGuest = savedBasic, savedGuest
		_ = testDB.Close()
	})
	return testDB
}

func writeStorageHandlerFixture(t *testing.T, relativePath, content string) {
	t.Helper()
	fullPath := filepath.Join(localStorageDir, filepath.FromSlash(relativePath))
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		t.Fatalf("MkdirAll(%s): %v", fullPath, err)
	}
	if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile(%s): %v", fullPath, err)
	}
}

func attachStorageHandlerSessionActor(t *testing.T, req *http.Request, userID int, userRole string) {
	t.Helper()
	session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("Store.Get() error = %v", err)
	}
	session.Values["user_id"] = userID
	session.Values["user_role"] = userRole

	rr := httptest.NewRecorder()
	if err := session.Save(req, rr); err != nil {
		t.Fatalf("session.Save() error = %v", err)
	}
	for _, cookie := range rr.Result().Cookies() {
		req.AddCookie(cookie)
	}
}

func TestServeStoragePreservesProtectedGETHEADAndRangeSemantics(t *testing.T) {
	setupStorageHandlerTest(t)
	const relativePath = "104/7/original/104_7_9.txt"
	writeStorageHandlerFixture(t, relativePath, "abcdef")

	authorizationCalls := 0
	storageAuthorizeRead = func(
		_ context.Context,
		_ dbutils.Querier,
		_ *sql.DB,
		actor dbutils.RequestActorContext,
		request dtt_1_row_read.StorageReadRequest,
	) (dtt_1_row_read.StorageReadDecision, error) {
		authorizationCalls++
		if actor.UserID != 42 || actor.UserRole != "basic" {
			t.Fatalf("storage actor = %#v, want basic user 42", actor)
		}
		if request.TableUID != "104" || request.ParentRowID != 7 || request.Filename != "104_7_9.txt" {
			t.Fatalf("storage request = %#v, want parsed protected path", request)
		}
		return dtt_1_row_read.StorageReadAllowed, nil
	}

	t.Run("GET", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/storage/"+relativePath, nil)
		attachRootHandlerSessionUser(t, req, 42)
		rr := httptest.NewRecorder()
		ServeStorage(rr, req)
		if rr.Code != http.StatusOK || rr.Body.String() != "abcdef" {
			t.Fatalf("GET storage response = status %d body %q, want 200 abcdef", rr.Code, rr.Body.String())
		}
		assertProtectedStorageHeaders(t, rr)
		if got := rr.Header().Get("Content-Disposition"); !strings.Contains(got, "attachment") {
			t.Fatalf("Content-Disposition = %q, want attachment", got)
		}
	})

	t.Run("HEAD", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodHead, "/storage/"+relativePath, nil)
		attachRootHandlerSessionUser(t, req, 42)
		rr := httptest.NewRecorder()
		ServeStorage(rr, req)
		if rr.Code != http.StatusOK || rr.Body.Len() != 0 {
			t.Fatalf("HEAD storage response = status %d body bytes %d, want 200 empty", rr.Code, rr.Body.Len())
		}
		assertProtectedStorageHeaders(t, rr)
	})

	t.Run("Range", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/storage/"+relativePath, nil)
		req.Header.Set("Range", "bytes=1-3")
		attachRootHandlerSessionUser(t, req, 42)
		rr := httptest.NewRecorder()
		ServeStorage(rr, req)
		if rr.Code != http.StatusPartialContent || rr.Body.String() != "bcd" {
			t.Fatalf("Range storage response = status %d body %q, want 206 bcd", rr.Code, rr.Body.String())
		}
		assertProtectedStorageHeaders(t, rr)
	})

	if authorizationCalls != 3 {
		t.Fatalf("authorizationCalls = %d, want 3", authorizationCalls)
	}
}

func TestServeStorageAuthorizesBeforeFilesystemDisclosure(t *testing.T) {
	setupStorageHandlerTest(t)
	const existingPath = "104/7/original/104_7_9.txt"
	writeStorageHandlerFixture(t, existingPath, "secret-file-content")

	t.Run("denied existing file stays undisclosed", func(t *testing.T) {
		storageAuthorizeRead = func(
			context.Context,
			dbutils.Querier,
			*sql.DB,
			dbutils.RequestActorContext,
			dtt_1_row_read.StorageReadRequest,
		) (dtt_1_row_read.StorageReadDecision, error) {
			return dtt_1_row_read.StorageReadNotFound, nil
		}
		req := httptest.NewRequest(http.MethodGet, "/storage/"+existingPath, nil)
		attachRootHandlerSessionUser(t, req, 42)
		rr := httptest.NewRecorder()
		ServeStorage(rr, req)
		if rr.Code != http.StatusNotFound || strings.Contains(rr.Body.String(), "secret-file-content") {
			t.Fatalf("denied existing file response = status %d body %q, want 404 without file content", rr.Code, rr.Body.String())
		}
	})

	t.Run("missing file is still authorized first", func(t *testing.T) {
		authorizationCalls := 0
		storageAuthorizeRead = func(
			context.Context,
			dbutils.Querier,
			*sql.DB,
			dbutils.RequestActorContext,
			dtt_1_row_read.StorageReadRequest,
		) (dtt_1_row_read.StorageReadDecision, error) {
			authorizationCalls++
			return dtt_1_row_read.StorageReadAllowed, nil
		}
		req := httptest.NewRequest(http.MethodGet, "/storage/104/7/original/missing.txt", nil)
		attachRootHandlerSessionUser(t, req, 42)
		rr := httptest.NewRecorder()
		ServeStorage(rr, req)
		if rr.Code != http.StatusNotFound || authorizationCalls != 1 {
			t.Fatalf("missing file response = status %d calls %d, want 404 after one authorization", rr.Code, authorizationCalls)
		}
	})
}

func TestProtectedAuthorizationFailuresAreIndistinguishable(t *testing.T) {
	for _, decision := range []storageAuthorizationDecision{
		storageAuthorizationNotFound,
		storageAuthorizationForbidden,
		storageAuthorizationInternalError,
	} {
		rr := httptest.NewRecorder()
		respondToStorageAuthorization(rr, decision)
		if rr.Code != http.StatusNotFound || !strings.Contains(rr.Body.String(), "file not found") {
			t.Fatalf("decision %d response = status %d body %q, want uniform 404", decision, rr.Code, rr.Body.String())
		}
	}
}

func assertProtectedStorageHeaders(t *testing.T, rr *httptest.ResponseRecorder) {
	t.Helper()
	if got := rr.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	if got := rr.Header().Get("Vary"); !strings.Contains(got, "Cookie") {
		t.Fatalf("Vary = %q, want Cookie", got)
	}
}

func TestServeStorageUsesGuestActorOnlyWhenBrowsingIsOpen(t *testing.T) {
	setupStorageHandlerTest(t)
	const relativePath = "104/7/original/104_7_9.png"
	writeStorageHandlerFixture(t, relativePath, "png")

	t.Run("guest browsing open", func(t *testing.T) {
		storageCheckLoginToBrowse = func() (bool, error) { return false, nil }
		authorizationCalls := 0
		storageAuthorizeRead = func(
			_ context.Context,
			_ dbutils.Querier,
			_ *sql.DB,
			actor dbutils.RequestActorContext,
			_ dtt_1_row_read.StorageReadRequest,
		) (dtt_1_row_read.StorageReadDecision, error) {
			authorizationCalls++
			if actor.UserID != 1 || actor.UserRole != "guest" || actor.IsAdmin {
				t.Fatalf("guest storage actor = %#v, want guest user 1", actor)
			}
			return dtt_1_row_read.StorageReadAllowed, nil
		}

		rr := httptest.NewRecorder()
		ServeStorage(rr, httptest.NewRequest(http.MethodGet, "/storage/"+relativePath, nil))
		if rr.Code != http.StatusOK || authorizationCalls != 1 {
			t.Fatalf("guest storage response = status %d calls %d, want 200 and one authorization", rr.Code, authorizationCalls)
		}

		staleRoleReq := httptest.NewRequest(http.MethodGet, "/storage/"+relativePath, nil)
		attachStorageHandlerSessionActor(t, staleRoleReq, 1, "admin")
		staleRoleResponse := httptest.NewRecorder()
		ServeStorage(staleRoleResponse, staleRoleReq)
		if staleRoleResponse.Code != http.StatusOK || authorizationCalls != 2 {
			t.Fatalf(
				"stale-role guest storage response = status %d calls %d, want 200 and two total authorizations",
				staleRoleResponse.Code,
				authorizationCalls,
			)
		}
	})

	t.Run("login required", func(t *testing.T) {
		storageCheckLoginToBrowse = func() (bool, error) { return true, nil }
		authorizationCalls := 0
		storageAuthorizeRead = func(
			context.Context,
			dbutils.Querier,
			*sql.DB,
			dbutils.RequestActorContext,
			dtt_1_row_read.StorageReadRequest,
		) (dtt_1_row_read.StorageReadDecision, error) {
			authorizationCalls++
			return dtt_1_row_read.StorageReadAllowed, nil
		}

		rr := httptest.NewRecorder()
		ServeStorage(rr, httptest.NewRequest(http.MethodGet, "/storage/"+relativePath, nil))
		if rr.Code != http.StatusNotFound || authorizationCalls != 0 {
			t.Fatalf("login-required storage response = status %d calls %d, want 404 and no authorization", rr.Code, authorizationCalls)
		}
		assertProtectedStorageHeaders(t, rr)

		persistedGuestReq := httptest.NewRequest(http.MethodGet, "/storage/"+relativePath, nil)
		attachRootHandlerSessionUser(t, persistedGuestReq, 1)
		persistedGuestResponse := httptest.NewRecorder()
		ServeStorage(persistedGuestResponse, persistedGuestReq)
		if persistedGuestResponse.Code != http.StatusNotFound || authorizationCalls != 0 {
			t.Fatalf(
				"persisted guest with login required response = status %d calls %d, want 404 and no authorization",
				persistedGuestResponse.Code,
				authorizationCalls,
			)
		}
		assertProtectedStorageHeaders(t, persistedGuestResponse)
	})
}

func TestServeStoragePublicLogoSkipsDatabaseAuthorizationAndPrivateCacheHeaders(t *testing.T) {
	setupStorageHandlerTest(t)
	writeStorageHandlerFixture(t, "project_logo.png", "logo")
	authorizationCalls := 0
	storageAuthorizeRead = func(
		context.Context,
		dbutils.Querier,
		*sql.DB,
		dbutils.RequestActorContext,
		dtt_1_row_read.StorageReadRequest,
	) (dtt_1_row_read.StorageReadDecision, error) {
		authorizationCalls++
		return dtt_1_row_read.StorageReadAllowed, nil
	}

	rr := httptest.NewRecorder()
	ServeStorage(rr, httptest.NewRequest(http.MethodGet, "/storage/project_logo.png", nil))
	if rr.Code != http.StatusOK || rr.Body.String() != "logo" || authorizationCalls != 0 {
		t.Fatalf("public logo response = status %d body %q calls %d, want 200 logo and no authorization", rr.Code, rr.Body.String(), authorizationCalls)
	}
	if got := rr.Header().Get("Cache-Control"); strings.Contains(got, "private") || strings.Contains(got, "no-store") {
		t.Fatalf("public logo Cache-Control = %q, want no protected cache directives", got)
	}
}

func TestServeStorageRejectsEscapingFileSymlink(t *testing.T) {
	setupStorageHandlerTest(t)
	externalDir := t.TempDir()
	externalFile := filepath.Join(externalDir, "secret.txt")
	if err := os.WriteFile(externalFile, []byte("outside-secret"), 0o644); err != nil {
		t.Fatalf("WriteFile external fixture: %v", err)
	}
	symlinkPath := filepath.Join(localStorageDir, "project_logo.png")
	if err := os.Symlink(externalFile, symlinkPath); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}

	rr := httptest.NewRecorder()
	ServeStorage(rr, httptest.NewRequest(http.MethodGet, "/storage/project_logo.png", nil))

	if rr.Code == http.StatusOK || strings.Contains(rr.Body.String(), "outside-secret") {
		t.Fatalf("escaping file symlink response = status %d body %q", rr.Code, rr.Body.String())
	}
}

func TestServeStorageRejectsEscapingDirectorySymlink(t *testing.T) {
	setupStorageHandlerTest(t)
	externalDir := t.TempDir()
	externalFile := filepath.Join(externalDir, "secret.svg")
	if err := os.WriteFile(externalFile, []byte("outside-directory-secret"), 0o644); err != nil {
		t.Fatalf("WriteFile external fixture: %v", err)
	}
	symlinkPath := filepath.Join(localStorageDir, "service_catalog_logos")
	if err := os.Symlink(externalDir, symlinkPath); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}

	rr := httptest.NewRecorder()
	ServeStorage(rr, httptest.NewRequest(http.MethodGet, "/storage/service_catalog_logos/secret.svg", nil))

	if rr.Code == http.StatusOK || strings.Contains(rr.Body.String(), "outside-directory-secret") {
		t.Fatalf("escaping directory symlink response = status %d body %q", rr.Code, rr.Body.String())
	}
}

func TestOpenContainedStorageFileRejectsFinalSymlink(t *testing.T) {
	tempDir := t.TempDir()
	realPath := filepath.Join(tempDir, "real.txt")
	if err := os.WriteFile(realPath, []byte("fixture"), 0o644); err != nil {
		t.Fatalf("WriteFile fixture: %v", err)
	}
	symlinkPath := filepath.Join(tempDir, "swapped.txt")
	if err := os.Symlink(realPath, symlinkPath); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}

	file, err := openContainedStorageFile(tempDir, "swapped.txt")
	if file != nil {
		_ = file.Close()
		t.Fatal("openContainedStorageFile returned a file for final-component symlink")
	}
	if err == nil {
		t.Fatal("openContainedStorageFile returned nil error for final-component symlink")
	}
}

func TestOpenContainedStorageFileRejectsIntermediateSymlink(t *testing.T) {
	storageRoot := t.TempDir()
	externalDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(externalDir, "secret.txt"), []byte("outside"), 0o644); err != nil {
		t.Fatalf("WriteFile external fixture: %v", err)
	}
	if err := os.Symlink(externalDir, filepath.Join(storageRoot, "linked")); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}

	file, err := openContainedStorageFile(storageRoot, filepath.Join("linked", "secret.txt"))
	if file != nil {
		_ = file.Close()
		t.Fatal("openContainedStorageFile followed an intermediate symlink")
	}
	if err == nil {
		t.Fatal("openContainedStorageFile returned nil error for intermediate symlink")
	}
}
