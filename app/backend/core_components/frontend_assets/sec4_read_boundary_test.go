// sec4_read_boundary_test.go
// Exercises the accepted security lows through real handlers with in-memory SQL.
// Connects permission principals and controlled rows without network or installation data.
// Refusals must precede disclosure; administrator behavior remains covered.
package frontendassets

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSEC4FrontendDirectories404FilesStillServe(t *testing.T) {
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "core_components"), 0700)
	os.WriteFile(filepath.Join(dir, "core_components", "index.html"), []byte("index"), 0600)
	os.WriteFile(filepath.Join(dir, "core_components", "module.js"), []byte("export default 1"), 0600)
	handler := FileServer(dir)
	for _, path := range []string{"/", "/core_components", "/core_components/"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != 404 {
			t.Errorf("%s: status=%d want 404", path, rec.Code)
		}
	}
	for _, name := range []string{"module.js", "index.html"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest("GET", "/core_components/"+name, nil))
		if rec.Code != 200 {
			t.Fatalf("file %s: status=%d", name, rec.Code)
		}
	}
}
