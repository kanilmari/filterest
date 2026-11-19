// search_indexing_header_test.go
// Pins which responses carry the search-engine exclusion header and which stay indexable.
package middlewares

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSearchIndexingHeaderMarksDataAndSignInResponses(t *testing.T) {
	handler := WithSecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	cases := []struct {
		target, want string
	}{
		{"/api/get-results?dataset=travel_deals", "noindex"},
		{"/api/datasets", "noindex"},
		{"/login", "noindex, nofollow"},
		{"/login?redirect=%2F", "noindex, nofollow"},
		{"/first-run", "noindex, nofollow"},
		{"/registered_buildings/12-old-town-hall", ""},
		{"/registered_buildings", ""},
		{"/admin/permissions", "noindex, nofollow"},
		{"/?login-entry=1", "noindex, nofollow"},
		{"/?register-entry=1", "noindex, nofollow"},
		{"/", ""},
		{"/travel_deals/287-helsinki-to-vienna", ""},
		{"/sitemap.xml", ""},
		{"/robots.txt", ""},
		{"/storage/10007/159/original/10007_159_177.jpg", ""},
		{"/apiary", ""},
		{"/administration_reports", ""},
	}
	for _, c := range cases {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, c.target, nil))
		if got := recorder.Header().Get("X-Robots-Tag"); got != c.want {
			t.Errorf("%s: X-Robots-Tag = %q, want %q", c.target, got, c.want)
		}
	}
}
