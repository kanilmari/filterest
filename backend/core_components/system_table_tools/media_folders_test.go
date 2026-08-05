// media_folders_test.go
// Verifies that read-only media checks and filesystem repairs accept only their intended HTTP methods.
// Bridges handler entry guards and the API pipeline's CSRF protection contract.
// Exists to prevent state-changing media repairs from becoming callable as unprotected GET requests.
package system_table_tools

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheckMediaSubfoldersHandlerRejectsPost(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/check-media-subfolders?dataset=example", nil)
	response := httptest.NewRecorder()

	CheckMediaSubfoldersHandler(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
}

func TestFixMediaSubfoldersHandlerRejectsReadAndUnsupportedMethods(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			request := httptest.NewRequest(method, "/api/fix-media-subfolders?dataset=example", nil)
			response := httptest.NewRecorder()

			FixMediaSubfoldersHandler(response, request)

			if response.Code != http.StatusMethodNotAllowed {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
			}
		})
	}
}
