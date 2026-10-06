// front_page_background_transaction_test.go
// Proves background replacement cleans files at commit or rollback, never at response time.
// Uses the real saver and lazy transaction hooks with a database driver accepting only this API's writes.
package system_table_tools

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtimepaths"
)

type frontPageBackgroundDriver struct{}
type frontPageBackgroundConn struct{}
type frontPageBackgroundTx struct{}

var frontPageBackgroundDriverID atomic.Int64

func (frontPageBackgroundDriver) Open(string) (driver.Conn, error) {
	return frontPageBackgroundConn{}, nil
}
func (frontPageBackgroundConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (frontPageBackgroundConn) Close() error              { return nil }
func (frontPageBackgroundConn) Begin() (driver.Tx, error) { return frontPageBackgroundTx{}, nil }
func (frontPageBackgroundTx) Commit() error               { return nil }
func (frontPageBackgroundTx) Rollback() error             { return nil }
func (frontPageBackgroundConn) ExecContext(_ context.Context, q string, _ []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(q, "pg_advisory_xact_lock") && !strings.Contains(q, "INSERT INTO public.system_config") {
		return nil, fmt.Errorf("unexpected write: %s", q)
	}
	return driver.RowsAffected(1), nil
}

func TestFrontPageBackgroundReplacementCommitAndRollback(t *testing.T) {
	for _, commit := range []bool{false, true} {
		t.Run(fmt.Sprintf("commit=%t", commit), func(t *testing.T) {
			oldPaths := runtimepaths.Current()
			if !filepath.IsAbs(oldPaths.InstallationRoot) {
				cwd, err := os.Getwd()
				if err != nil {
					t.Fatal(err)
				}
				oldPaths, err = runtimepaths.Resolve(cwd, cwd, false)
				if err != nil {
					t.Fatal(err)
				}
			}
			paths, err := runtimepaths.Resolve(t.TempDir(), t.TempDir(), true)
			if err != nil {
				t.Fatal(err)
			}
			if err := runtimepaths.Configure(paths); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := runtimepaths.Configure(oldPaths); err != nil {
					t.Error(err)
				}
			})
			oldReader := frontPageBackgroundReader
			frontPageBackgroundReader = func(context.Context, *sql.DB) (*backend.FrontPageBackground, error) {
				return &backend.FrontPageBackground{StorageKey: "site_media/front_page/original/old.png", MIMEType: "image/png", FocalX: 0.5, FocalY: 0.5}, nil
			}
			t.Cleanup(func() { frontPageBackgroundReader = oldReader })
			for _, variant := range []string{"original", "1000", "2160"} {
				dir := filepath.Join(paths.StorageRoot, frontPageBackgroundRoot, variant)
				if err := os.MkdirAll(dir, 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(dir, "old.png"), frontPageTestPNG(t), 0644); err != nil {
					t.Fatal(err)
				}
			}
			name := fmt.Sprintf("front_page_background_%d", frontPageBackgroundDriverID.Add(1))
			sql.Register(name, frontPageBackgroundDriver{})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			lazy := dbutils.NewLazyTx(db)
			defer lazy.Rollback()
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			part, err := writer.CreateFormFile("background_image", "new.png")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write(frontPageTestPNG(t)); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest("POST", "/api/admin/front-page/background", &body)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			request = request.WithContext(dbutils.SetLazyTx(request.Context(), lazy))
			response := httptest.NewRecorder()
			FrontPageBackgroundHandler(response, request)
			if response.Code != 200 {
				t.Fatal(response.Code, response.Body.String())
			}
			originalDir := filepath.Join(paths.StorageRoot, frontPageBackgroundRoot, "original")
			files, err := os.ReadDir(originalDir)
			if err != nil || len(files) != 2 {
				t.Fatal("old removed before commit", files, err)
			}
			if commit {
				err = lazy.Commit()
			} else {
				err = lazy.Rollback()
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, variant := range []string{"original", "1000", "2160"} {
				files, err := os.ReadDir(filepath.Join(paths.StorageRoot, frontPageBackgroundRoot, variant))
				if err != nil || len(files) != 1 {
					t.Fatal("incomplete cleanup", variant, files, err)
				}
				if (files[0].Name() == "old.png") == commit {
					t.Fatal("wrong image kept", variant, files[0].Name(), commit)
				}
			}
		})
	}
}
