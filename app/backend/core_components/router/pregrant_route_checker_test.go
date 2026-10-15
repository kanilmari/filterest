// pregrant_route_checker_test.go
// Guards the complete Filterest route inventory against unreviewed pre-grant writes.
// Connects real environment-specific registrations to the reusable contract checker.
// Proves new writers and missing method declarations cannot silently pass review.
package router

import (
	"net/http"
	"strings"
	"testing"

	"easelect/backend/pipeline"
)

func TestRegisteredPreGrantWritersAreReviewed(t *testing.T) {
	allowances, err := ReviewedPreGrantWriteAllowances()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pipeline.ResetRouteProfiles(); ResetRouteDefinitions() })
	for _, scenario := range DefaultRouteManifestScenarios() {
		t.Run(scenario.Name, func(t *testing.T) {
			t.Setenv("ENVIRONMENT_TYPE", scenario.EnvironmentType)
			t.Setenv("ENABLE_API_LANGUAGE", "false")
			if scenario.EnableAPILanguage {
				t.Setenv("ENABLE_API_LANGUAGE", "true")
			}
			pipeline.ResetRouteProfiles()
			RegisterRoutes(t.TempDir(), t.TempDir())
			pipeline.ApplyDevOverrides()
			routes := GetRouteDefinitions()
			if len(routes) == 0 {
				t.Fatal("guard must inspect real registrations")
			}
			if err := ValidatePreGrantRouteContracts(routes, allowances); err != nil {
				t.Fatal(err)
			}
			t.Logf("checked %d registrations against %d reviewed exceptions", len(routes), len(allowances))
		})
	}
}

func TestPreGrantGuardRejectsUnreviewedWriter(t *testing.T) {
	// Use an existing LoginOnly handler identity but a new path: reviewing the
	// handler at one address must not authorize a new registration implicitly.
	route := RouteDefinition{UrlPattern: "/fixture/unreviewed", HandlerName: "auth.UserProfileUpdateHandler", Methods: []string{http.MethodPost}}
	allowances, err := ReviewedPreGrantWriteAllowances()
	if err != nil {
		t.Fatal(err)
	}
	err = ValidatePreGrantRouteContracts([]RouteDefinition{route}, allowances)
	if err == nil || !strings.Contains(err.Error(), "unreviewed pre-grant writer: POST /fixture/unreviewed") {
		t.Fatalf("negative control did not fail the guard: %v", err)
	}
	t.Logf("negative control: %v", err)
}

func TestPreGrantGuardRejectsEmptyMethods(t *testing.T) {
	for _, methods := range [][]string{nil, {"", " "}} {
		for _, name := range []string{"auth.UserProfileUpdateHandler", "router.adminHandler"} {
			route := RouteDefinition{UrlPattern: "/fixture/no-methods", HandlerName: name, Methods: methods}
			err := ValidatePreGrantRouteContracts([]RouteDefinition{route}, nil)
			if err == nil || !strings.Contains(err.Error(), "has no declared methods") {
				t.Fatalf("empty-contract negative control did not fail: %v", err)
			}
			t.Logf("negative control: %v", err)
		}
	}
}

func TestPreGrantAllowancesRequireReasonAndExactContract(t *testing.T) {
	route := RouteDefinition{UrlPattern: "/fixture/reviewed", HandlerName: "auth.UserProfileUpdateHandler", Methods: []string{http.MethodPost}}
	allowance := PreGrantWriteAllowance{PathPattern: route.UrlPattern, HandlerName: route.HandlerName, Profile: "login_only", Methods: route.Methods, Reason: "Changes only the current account."}
	if err := ValidatePreGrantRouteContracts([]RouteDefinition{route}, []PreGrantWriteAllowance{allowance}); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*PreGrantWriteAllowance){
		func(a *PreGrantWriteAllowance) { a.Reason = " " },
		func(a *PreGrantWriteAllowance) { a.Reason = "first line\nsecond line" },
		func(a *PreGrantWriteAllowance) { a.HandlerName = "other.Handler" },
		func(a *PreGrantWriteAllowance) { a.Profile = "public" },
		func(a *PreGrantWriteAllowance) { a.Methods = []string{http.MethodPut} },
	} {
		altered := allowance
		change(&altered)
		if err := ValidatePreGrantRouteContracts([]RouteDefinition{route}, []PreGrantWriteAllowance{altered}); err == nil {
			t.Fatal("incomplete or mismatched review passed")
		}
	}
}
