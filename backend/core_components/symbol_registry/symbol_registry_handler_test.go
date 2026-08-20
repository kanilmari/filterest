// symbol_registry_handler_test.go
// Verifies the public symbol asset boundary and pre-transaction assignment validation.
// Bridges HTTP requests with the filesystem SVG allowlist without database mutation.
// Exists so unknown keys fall back safely while paths and unregistered assignments fail closed.
package symbol_registry

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAssetHandlerServesRegisteredSymbolWithSecurityHeaders(t *testing.T) {
	directory := t.TempDir()
	writeTestSymbol(t, directory, "table.svg", `<svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg>`)
	writeTestSymbol(t, directory, "payments.svg", `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>`)
	ConfigureDirectory(directory)

	request := httptest.NewRequest(http.MethodGet, "/symbol-assets/payments.svg", nil)
	response := httptest.NewRecorder()
	AssetHandler(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("X-Resolved-Symbol-Key"); got != "payments" {
		t.Fatalf("X-Resolved-Symbol-Key = %q, want payments", got)
	}
	if got := response.Header().Get("Content-Security-Policy"); !strings.Contains(got, "default-src 'none'") {
		t.Fatalf("Content-Security-Policy = %q, want fail-closed policy", got)
	}
	if strings.Contains(response.Body.String(), "<script") {
		t.Fatal("response unexpectedly contains script markup")
	}
}

func TestAssetHandlerFallsBackForUnknownSafeKeyAndRejectsPaths(t *testing.T) {
	directory := t.TempDir()
	writeTestSymbol(t, directory, "table.svg", `<svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg>`)
	ConfigureDirectory(directory)

	unknownResponse := httptest.NewRecorder()
	AssetHandler(unknownResponse, httptest.NewRequest(http.MethodGet, "/symbol-assets/missing.svg", nil))
	if unknownResponse.Code != http.StatusOK {
		t.Fatalf("unknown status = %d, want %d", unknownResponse.Code, http.StatusOK)
	}
	if got := unknownResponse.Header().Get("X-Resolved-Symbol-Key"); got != "table" {
		t.Fatalf("unknown resolved key = %q, want table", got)
	}

	pathResponse := httptest.NewRecorder()
	AssetHandler(pathResponse, httptest.NewRequest(http.MethodGet, "/symbol-assets/subdir/table.svg", nil))
	if pathResponse.Code != http.StatusNotFound {
		t.Fatalf("path status = %d, want %d", pathResponse.Code, http.StatusNotFound)
	}
}

func TestAdminHandlerRejectsUnregisteredKeyBeforeTransaction(t *testing.T) {
	directory := t.TempDir()
	writeTestSymbol(t, directory, "table.svg", `<svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg>`)
	ConfigureDirectory(directory)

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/admin/symbols",
		strings.NewReader(`{"target_type":"dataset","target_uid":12,"icon_key":"../../secret"}`),
	)
	response := httptest.NewRecorder()
	AdminHandler(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}
