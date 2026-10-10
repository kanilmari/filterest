// sitemap_handler_test.go
// Verifies that /sitemap.xml announces only the dataset addresses a signed-out visitor can open.
// Bridges the sitemap, the visitor identity's read right and the root page that answers each address.
// Exists because the sitemap once listed every dataset not hidden from the interface, which on a
// site open to search engines published the names of datasets no signed-out visitor may read.
package router

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
)

// sitemapTestBaseURL is the address the test installation publishes itself under.
const sitemapTestBaseURL = "https://visitor.example"

// sitemapTestUpdated is when every test dataset last changed, so the sitemap's lastmod can be checked.
var sitemapTestUpdated = time.Date(2026, 10, 8, 12, 30, 0, 0, time.UTC)

// sitemapTestDataset is one dataset of the test installation. Every one of them is shown in
// the interface (not ui_hidden); what differs is whether the visitor identity holds the read
// right on it, and whether that right can be checked at all.
type sitemapTestDataset struct {
	name            string
	visitorCanRead  bool
	rightCheckFails bool
}

var sitemapTestDatasets = []sitemapTestDataset{
	// Readable without signing in; its address is the public alias service_catalog.
	{name: "app_service_catalog", visitorCanRead: true},
	// Readable without signing in, under its own name.
	{name: "travel_deals", visitorCanRead: true},
	// Datasets only signed-in people may read. Their names must stay out of the sitemap.
	{name: "dev_agent_worklines"},
	{name: "ai_usage_logs"},
	// A cloud management dataset, which an application instance hides from everyone even
	// when a read right on it exists.
	{name: "app_cloud_services", visitorCanRead: true},
	// A dataset whose read right cannot be checked counts as unreadable.
	{name: "deletion_log", visitorCanRead: true, rightCheckFails: true},
}

func findSitemapTestDataset(name string) (sitemapTestDataset, bool) {
	for _, dataset := range sitemapTestDatasets {
		if dataset.name == name {
			return dataset, true
		}
	}
	return sitemapTestDataset{}, false
}

// sitemapMockConn answers the dataset list, dataset existence and read-right questions for
// the datasets above, and leaves every other question to the root-page fixture.
type sitemapMockDriver struct{}

type sitemapMockConn struct {
	*rootHandlerMockConn
}

type sitemapMockRows struct {
	cols []string
	vals [][]driver.Value
	next int
}

func (sitemapMockDriver) Open(string) (driver.Conn, error) {
	return sitemapMockConn{&rootHandlerMockConn{config: rootHandlerMockConfig{
		instanceRole: backend.EaselectInstanceRoleApplication,
	}}}, nil
}

func (r *sitemapMockRows) Columns() []string { return r.cols }
func (r *sitemapMockRows) Close() error      { return nil }

func (r *sitemapMockRows) Next(dest []driver.Value) error {
	if r.next >= len(r.vals) {
		return io.EOF
	}
	copy(dest, r.vals[r.next])
	r.next++
	return nil
}

func (c sitemapMockConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "NOT t.ui_hidden"):
		rows := &sitemapMockRows{cols: []string{"table_name", "updated"}}
		for _, dataset := range sitemapTestDatasets {
			rows.vals = append(rows.vals, []driver.Value{dataset.name, sitemapTestUpdated})
		}
		return rows, nil
	case strings.Contains(query, "SELECT EXISTS (SELECT 1 FROM system_db_tables WHERE table_name = $1)") && len(args) > 0:
		_, known := findSitemapTestDataset(fmt.Sprint(args[0].Value))
		return &rootHandlerMockRows{cols: []string{"exists"}, vals: []driver.Value{known}}, nil
	case strings.Contains(query, "FROM system_group_table_func_rights") && len(args) > 2:
		dataset, known := findSitemapTestDataset(fmt.Sprint(args[2].Value))
		if known && dataset.rightCheckFails {
			return nil, fmt.Errorf("rights unavailable")
		}
		allowed := known && dataset.visitorCanRead &&
			fmt.Sprint(args[0].Value) == "/api/get-results" &&
			fmt.Sprint(args[1].Value) == "1"
		return &rootHandlerMockRows{cols: []string{"allowed"}, vals: []driver.Value{1}, empty: !allowed}, nil
	}
	return c.rootHandlerMockConn.QueryContext(ctx, query, args)
}

func setupSitemapMockDB(t *testing.T) {
	t.Helper()
	// The fixture puts the original database pools back when the test ends.
	setupRootHandlerMockDB(t, false)
	name := fmt.Sprintf("sitemap_%d", atomic.AddInt64(&rootHandlerDriverCounter, 1))
	sql.Register(name, sitemapMockDriver{})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	backend.Db = db
	backend.DbConfidential = db
	backend.ResetEaselectInstanceRoleCache()
	t.Cleanup(func() { _ = db.Close() })
}

func TestSitemapListsOnlyDatasetAddressesASignedOutVisitorCanOpen(t *testing.T) {
	t.Setenv("BASE_URL", sitemapTestBaseURL)
	setupSitemapMockDB(t)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	rr := httptest.NewRecorder()
	sitemapHandler(rr, httptest.NewRequest(http.MethodGet, "/sitemap.xml", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("sitemap status = %d, want %d", rr.Code, http.StatusOK)
	}
	var sitemap urlSet
	if err := xml.Unmarshal(rr.Body.Bytes(), &sitemap); err != nil {
		t.Fatalf("sitemap is not readable XML: %v\n%s", err, rr.Body.String())
	}

	var listed []string
	for _, entry := range sitemap.URLs {
		listed = append(listed, entry.Loc)
	}
	want := []string{
		sitemapTestBaseURL + "/",
		sitemapTestBaseURL + "/service_catalog",
		sitemapTestBaseURL + "/travel_deals",
	}
	if strings.Join(listed, "\n") != strings.Join(want, "\n") {
		t.Fatalf("sitemap lists\n  %s\nwant\n  %s", strings.Join(listed, "\n  "), strings.Join(want, "\n  "))
	}
	for _, entry := range sitemap.URLs[1:] {
		if entry.LastMod != sitemapTestUpdated.Format(time.RFC3339) {
			t.Errorf("%s lastmod = %q, want %q", entry.Loc, entry.LastMod, sitemapTestUpdated.Format(time.RFC3339))
		}
	}

	// The sitemap and the root page must give the same answer: every dataset address the
	// sitemap lists opens for a signed-out visitor, and every dataset it leaves out sends
	// that visitor to the login page instead.
	listedPaths := make(map[string]bool, len(listed))
	for _, loc := range listed {
		listedPaths[strings.TrimPrefix(loc, sitemapTestBaseURL)] = true
	}
	for _, dataset := range sitemapTestDatasets {
		path := "/" + resolvePublicDatasetName(dataset.name)
		visit := httptest.NewRecorder()
		rootHandler(visit, httptest.NewRequest(http.MethodGet, path, nil))
		opens := visit.Code == http.StatusOK
		if opens != listedPaths[path] {
			t.Errorf("%s: a signed-out visitor gets status %d (Location %q), but listed in the sitemap = %v",
				path, visit.Code, visit.Header().Get("Location"), listedPaths[path])
		}
		if !opens && !strings.HasPrefix(visit.Header().Get("Location"), "/login") {
			t.Errorf("%s: status %d with Location %q, want a login redirect", path, visit.Code, visit.Header().Get("Location"))
		}
	}
}
