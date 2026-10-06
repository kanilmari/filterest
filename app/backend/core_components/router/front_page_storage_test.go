// front_page_storage_test.go
// Verifies configured front page images reuse storage actor, containment and HTTP range delivery.
// No storage path becomes public merely by living under site_media.
// Video originals retain range delivery while even existing sized copies stay private.
package router

import (
	"context"
	"database/sql"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	backend "easelect/backend/core_components"
)

func TestFrontPageStorageOnlyConfiguredImageAndBrowsingActor(t *testing.T) {
	setupStorageHandlerTest(t)
	settings, background := storageFrontPageSettingsReader, storageFrontPageBackgroundReader
	t.Cleanup(func() { storageFrontPageSettingsReader, storageFrontPageBackgroundReader = settings, background })
	on := true
	storageFrontPageSettingsReader = func(context.Context, *sql.DB) (backend.FrontPageSettings, error) {
		return backend.FrontPageSettings{SeparateFrontPage: on}, nil
	}
	storageFrontPageBackgroundReader = func(context.Context, *sql.DB) (*backend.FrontPageBackground, error) {
		return &backend.FrontPageBackground{StorageKey: "site_media/front_page/original/file.png", MIMEType: "image/png", FocalX: 0.5, FocalY: 0.5}, nil
	}
	for _, variant := range []string{"original", "1000", "2160"} {
		dir := filepath.Join(localStorageDir, "site_media", "front_page", variant)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "file.png"), []byte("0123456789"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	storageCheckLoginToBrowse = func() (bool, error) { return false, nil }
	request := httptest.NewRequest("GET", "/storage/site_media/front_page/1000/file.png", nil)
	request.Header.Set("Range", "bytes=2-4")
	response := httptest.NewRecorder()
	ServeStorage(response, request)
	if response.Code != 206 || response.Body.String() != "234" || response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal(response.Code, response.Header(), response.Body.String())
	}
	for _, path := range []string{"site_media/front_page/original/other.png", "site_media/front_page/300/file.png", "site_media/front_page/original/../original/file.png", `site_media/front_page/original/bad\file.png`} {
		if decision := authorizeStorageRequest(httptest.NewRecorder(), httptest.NewRequest("GET", "/storage/"+path, nil), path); decision != storageAuthorizationNotFound {
			t.Fatal(path, decision)
		}
	}
	on = false
	if decision := authorizeStorageRequest(httptest.NewRecorder(), request, "site_media/front_page/1000/file.png"); decision != storageAuthorizationNotFound {
		t.Fatal("off", decision)
	}
	on = true
	storageCheckLoginToBrowse = func() (bool, error) { return true, nil }
	if decision := authorizeStorageRequest(httptest.NewRecorder(), httptest.NewRequest("GET", "/storage/site_media/front_page/1000/file.png", nil), "site_media/front_page/1000/file.png"); decision != storageAuthorizationNotFound {
		t.Fatal("login site anonymous", decision)
	}
	signedIn := httptest.NewRequest("GET", "/storage/site_media/front_page/2160/file.png", nil)
	attachStorageHandlerSessionActor(t, signedIn, 42, "basic")
	if decision := authorizeStorageRequest(httptest.NewRecorder(), signedIn, "site_media/front_page/2160/file.png"); decision != storageAuthorizationAllowed {
		t.Fatal("signed in", decision)
	}
}

func TestFrontPageVideoStorageOriginalRangeAndNoVariants(t *testing.T) {
	setupStorageHandlerTest(t)
	settings, background := storageFrontPageSettingsReader, storageFrontPageBackgroundReader
	t.Cleanup(func() { storageFrontPageSettingsReader, storageFrontPageBackgroundReader = settings, background })
	storageFrontPageSettingsReader = func(context.Context, *sql.DB) (backend.FrontPageSettings, error) {
		return backend.FrontPageSettings{SeparateFrontPage: true}, nil
	}
	storageFrontPageBackgroundReader = func(context.Context, *sql.DB) (*backend.FrontPageBackground, error) {
		return &backend.FrontPageBackground{StorageKey: "site_media/front_page/original/movie.mp4", MIMEType: "video/mp4", FocalX: 0.5, FocalY: 0.5}, nil
	}
	storageCheckLoginToBrowse = func() (bool, error) { return false, nil }
	for _, variant := range []string{"original", "1000", "2160"} {
		dir := filepath.Join(localStorageDir, "site_media", "front_page", variant)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "movie.mp4"), []byte("0123456789"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	request := httptest.NewRequest("GET", "/storage/site_media/front_page/original/movie.mp4", nil)
	request.Header.Set("Range", "bytes=2-4")
	response := httptest.NewRecorder()
	ServeStorage(response, request)
	if response.Code != 206 || response.Body.String() != "234" || response.Header().Get("Content-Type") != "video/mp4" {
		t.Fatal(response.Code, response.Header(), response.Body.String())
	}
	for _, key := range []string{"site_media/front_page/1000/movie.mp4", "site_media/front_page/2160/movie.mp4", "site_media/front_page/original/other.mp4"} {
		if decision := authorizeStorageRequest(httptest.NewRecorder(), httptest.NewRequest("GET", "/storage/"+key, nil), key); decision != storageAuthorizationNotFound {
			t.Fatal(key, decision)
		}
	}
}
