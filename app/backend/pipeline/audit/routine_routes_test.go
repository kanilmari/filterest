// routine_routes_test.go
// Proves the five routine routes alone gain successful-read audit exclusions.
// Connects exact router registrations and operation inference to queue decisions.
// Keeps failures, writes, nearby routes and authentication events auditable.
package audit

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAuditRoutineRoutesSkipExactlyFiveSuccessfulReads(t *testing.T) {
	routes := map[string]string{
		"symbol_registry.AssetHandler":          "/symbol-assets/table.svg",
		"auth.CSRFTokenHandler":                 "/api/csrf-token",
		"lang.GetPublicUILanguagesHandler":      "/api/ui-languages",
		"product_identity.Handler":              "/api/product-identity",
		"router.adminUpdateNoticeStreamHandler": "/api/admin/update-notice/stream",
	}
	if len(routineSuccessfulAuditRoutes) != len(routes) {
		t.Fatal("routine route skip list changed beyond the five approved routes")
	}
	router, err := os.ReadFile(filepath.Join("..", "..", "core_components", "router", "router.go"))
	if err != nil {
		t.Fatal(err)
	}
	for handler, path := range routes {
		t.Run(handler, func(t *testing.T) {
			registeredPath := path
			if handler == "symbol_registry.AssetHandler" {
				registeredPath = "/symbol-assets/"
			}
			registered := false
			for _, line := range strings.Split(string(router), "\n") {
				if strings.Contains(line, `functionRegisterHandler("`+registeredPath+`"`) && strings.Contains(line, `"`+handler+`"`) {
					registered = true
				}
			}
			if !registered {
				t.Fatal("skip no longer matches an exact router registration")
			}
			operation := InferOperationType(handler)
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				if shouldEnqueueAuditEvent(handler, operation, method, 200, path) {
					t.Fatal("routine successful read was audited", method)
				}
			}
			for _, status := range []int{400, 401, 403, 404, 429, 500} {
				if !shouldEnqueueAuditEvent(handler, operation, http.MethodGet, status, path) {
					t.Fatal("security/error outcome was skipped", status)
				}
			}
			for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions} {
				if !shouldEnqueueAuditEvent(handler, operation, method, 200, path) {
					t.Fatal("non-read was skipped", method)
				}
			}
			for _, operation := range []string{"create", "update", "delete", "admin"} {
				if !shouldEnqueueAuditEvent(handler, operation, http.MethodGet, 200, path) {
					t.Fatal("mutating/admin operation was skipped", operation)
				}
			}
			for _, adjacent := range []string{path + "/extra", path + "-admin", "/other" + path} {
				if !shouldEnqueueAuditEvent(handler, operation, http.MethodGet, 200, adjacent) {
					t.Fatal("nearby route was skipped", adjacent)
				}
			}
		})
	}
	for handler, path := range map[string]string{
		"symbol_registry.AdminHandler":         "/api/admin/symbols",
		"lang.AdminUILanguagesHandler":         "/api/admin/ui-languages",
		"router.productionUpdateNoticeHandler": "/system/update-notice",
		"auth.LoginAPIHandler":                 "/api/login",
		"auth.LogoutHandler":                   "/api/logout",
		"auth.ResetPasswordWithOTPHandler":     "/api/reset-password",
		"auth.SignOutOtherDevicesHandler":      "/api/sign-out-other-devices",
		"auth.AdminUserAuthenticationHandler":  "/api/admin/user-authentication",
	} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			if !shouldEnqueueAuditEvent(handler, InferOperationType(handler), method, 200, path) {
				t.Fatal("security-relevant neighbor skipped", handler, method)
			}
		}
	}
}
