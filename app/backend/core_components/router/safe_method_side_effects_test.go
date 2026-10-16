// safe_method_side_effects_test.go
// Audits registered GET/HEAD side effects against exact reviewed exceptions.
// Connects all runtime scenarios with known writers and negative controls.
// Makes a new address or weakened profile fail the same pre-grant security gate.
package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/pipeline"
)

func TestRegisteredSafeMethodSideEffectsAreReviewed(t *testing.T) {
	allowances, err := ReviewedSafeMethodSideEffectAllowances()
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
			if err := ValidateSafeMethodSideEffects(GetRouteDefinitions(), KnownSideEffectHandlers(), allowances); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSafeMethodGuardRejectsFixtureWriterAtNewPath(t *testing.T) {
	allowances, err := ReviewedSafeMethodSideEffectAllowances()
	if err != nil {
		t.Fatal(err)
	}
	for _, handler := range []string{"fixture.GetWriter", "router.ServeStorage", "ai_features.EmbeddingStreamHandler"} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			writes := 0
			route := RouteDefinition{UrlPattern: "/fixture/new-get-writer", HandlerName: handler, Methods: []string{method}, HandlerFunc: func(w http.ResponseWriter, _ *http.Request) { writes++; w.WriteHeader(201) }}
			route.HandlerFunc(httptest.NewRecorder(), httptest.NewRequest(method, route.UrlPattern, nil))
			if writes != 1 {
				t.Fatal("negative fixture did not write")
			}
			writers := append(KnownSideEffectHandlers(), "fixture.GetWriter")
			err := ValidateSafeMethodSideEffects([]RouteDefinition{route}, writers, allowances)
			if err == nil || !strings.Contains(err.Error(), "unreviewed safe-method side effect: "+method+" "+route.UrlPattern) {
				t.Fatalf("negative control passed for %s %s: %v", method, handler, err)
			}
			t.Log(err)
		}
	}
}

func TestSafeMethodAllowancesRequireReasonAndExactIdentity(t *testing.T) {
	route := RouteDefinition{UrlPattern: "/fixture/reviewed", HandlerName: "fixture.GetWriter", Methods: []string{http.MethodGet}}
	allowance := SafeMethodSideEffectAllowance{PathPattern: route.UrlPattern, HandlerName: route.HandlerName, Profile: "default", Reason: "Reviewed local fixture write."}
	validate := func(a SafeMethodSideEffectAllowance) error {
		return ValidateSafeMethodSideEffects([]RouteDefinition{route}, []string{route.HandlerName}, []SafeMethodSideEffectAllowance{a})
	}
	if err := validate(allowance); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*SafeMethodSideEffectAllowance){
		func(a *SafeMethodSideEffectAllowance) { a.Reason = " " },
		func(a *SafeMethodSideEffectAllowance) { a.PathPattern += "/other" },
		func(a *SafeMethodSideEffectAllowance) { a.HandlerName = "other.Writer" },
		func(a *SafeMethodSideEffectAllowance) { a.Profile = "public" },
	} {
		altered := allowance
		change(&altered)
		if err := validate(altered); err == nil {
			t.Fatal("incomplete or mismatched review passed")
		}
	}
}
