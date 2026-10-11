// dataset_alias_secondary_request_test.go
// Proves published secondary aliases stay reachable for anonymous browser requests.
// Connects the real root router with guest permission and active-alias fixtures.
// Guards against a valid old dataset address being redirected to sign-in.
package router

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGuestRequestToActiveSecondaryAliasServesDataset(t *testing.T) {
	setupRootHandlerMockDBWithConfig(t, rootHandlerMockConfig{secondaryAlias: "old-orders"})
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)
	response := httptest.NewRecorder()
	rootHandler(response, httptest.NewRequest("GET", "/old-orders?search=ferry", nil))
	if response.Code != 200 || response.Header().Get("Location") != "" || !strings.Contains(response.Body.String(), "root-shell") {
		t.Fatalf("published secondary alias denied to guest: %d %s", response.Code, response.Header().Get("Location"))
	}
}
