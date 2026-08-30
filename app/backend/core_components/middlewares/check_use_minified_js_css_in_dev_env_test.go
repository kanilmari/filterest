// check_use_minified_js_css_in_dev_env_test.go
// Verifies explicit source/dist selection without requiring a database fixture.
// Bridges per-instance runtime configuration with the production dist-only safety rule.
// Exists so local source and release-preview processes cannot silently converge again.
package middlewares

import "testing"

func TestResolveFrontendAssetModeOverride(t *testing.T) {
	tests := []struct {
		name            string
		environmentType string
		requestedMode   string
		wantMinified    bool
		wantResolved    bool
		wantError       bool
	}{
		{name: "development source", environmentType: "dev", requestedMode: "source", wantResolved: true},
		{name: "development dist", environmentType: "dev", requestedMode: "dist", wantMinified: true, wantResolved: true},
		{name: "development mode is normalized", environmentType: "dev", requestedMode: " DIST ", wantMinified: true, wantResolved: true},
		{name: "empty development mode keeps database fallback", environmentType: "dev", wantResolved: false},
		{name: "invalid development mode fails closed", environmentType: "dev", requestedMode: "bundle", wantMinified: true, wantResolved: true, wantError: true},
		{name: "production cannot select source", environmentType: "prod", requestedMode: "source", wantMinified: true, wantResolved: true},
		{name: "missing environment fails closed to dist", environmentType: "", requestedMode: "source", wantMinified: true, wantResolved: true},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			gotMinified, gotResolved, err := resolveFrontendAssetModeOverride(
				testCase.environmentType,
				testCase.requestedMode,
			)
			if gotMinified != testCase.wantMinified {
				t.Fatalf("minified = %v, want %v", gotMinified, testCase.wantMinified)
			}
			if gotResolved != testCase.wantResolved {
				t.Fatalf("resolved = %v, want %v", gotResolved, testCase.wantResolved)
			}
			if (err != nil) != testCase.wantError {
				t.Fatalf("error = %v, wantError %v", err, testCase.wantError)
			}
		})
	}
}
