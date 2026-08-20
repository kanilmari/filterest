// admin_ui_feature_flags_test.go
// Verifies the protected UI feature-flag response stays boolean and allowlisted.
// Bridges the admin handler seam with its narrow JSON contract and method guard.
// Exists so internal preview settings cannot expand into a generic config leak.
package system_table_tools

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetAdminUIFeatureFlagsHandlerReturnsOnlyAllowlistedFlag(t *testing.T) {
	originalReader := readAdminUIFeatureFlags
	readAdminUIFeatureFlags = func() (AdminUIFeatureFlagsResponse, error) {
		return AdminUIFeatureFlagsResponse{ViewAdminCoverImageTestPalette: true}, nil
	}
	t.Cleanup(func() { readAdminUIFeatureFlags = originalReader })

	request := httptest.NewRequest(http.MethodGet, "/api/admin/ui-feature-flags", nil)
	response := httptest.NewRecorder()
	GetAdminUIFeatureFlagsHandler(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var payload map[string]bool
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload) != 1 || !payload[adminCoverImageTestPaletteConfigKey] {
		t.Fatalf("payload = %#v, want one enabled allowlisted flag", payload)
	}
}

func TestGetAdminUIFeatureFlagsHandlerRejectsNonGetWithoutReadingConfig(t *testing.T) {
	originalReader := readAdminUIFeatureFlags
	readCalled := false
	readAdminUIFeatureFlags = func() (AdminUIFeatureFlagsResponse, error) {
		readCalled = true
		return AdminUIFeatureFlagsResponse{}, nil
	}
	t.Cleanup(func() { readAdminUIFeatureFlags = originalReader })

	request := httptest.NewRequest(http.MethodPost, "/api/admin/ui-feature-flags", nil)
	response := httptest.NewRecorder()
	GetAdminUIFeatureFlagsHandler(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
	if readCalled {
		t.Fatal("non-GET request read protected configuration")
	}
}

func TestGetAdminUIFeatureFlagsHandlerFailsClosedOnReadError(t *testing.T) {
	originalReader := readAdminUIFeatureFlags
	readAdminUIFeatureFlags = func() (AdminUIFeatureFlagsResponse, error) {
		return AdminUIFeatureFlagsResponse{}, errors.New("database unavailable")
	}
	t.Cleanup(func() { readAdminUIFeatureFlags = originalReader })

	request := httptest.NewRequest(http.MethodGet, "/api/admin/ui-feature-flags", nil)
	response := httptest.NewRecorder()
	GetAdminUIFeatureFlagsHandler(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
}
