// build_pipeline_test.go
// Unit tests for pipeline assembly: resolveActiveStages, GetProfile, and ApplyDevOverrides.
// Between the pipeline package and its stage-resolution logic.
// Exists to verify correct pipeline profile construction and dev overrides.
package pipeline_test

import (
	"testing"

	"easelect/backend/pipeline"
)

// emptyCtx is a zero-value RouteContext sufficient for stage-list tests
// (no DB or HTTP server required).
var emptyCtx = pipeline.RouteContext{}

// containsAll checks that every element of want appears in got.
func containsAll(t *testing.T, got []string, want []string) {
	t.Helper()
	index := make(map[string]bool, len(got))
	for _, s := range got {
		index[s] = true
	}
	for _, s := range want {
		if !index[s] {
			t.Errorf("expected stage %q to be present; got %v", s, got)
		}
	}
}

// containsNone checks that none of the elements of forbidden appear in got.
func containsNone(t *testing.T, got []string, forbidden []string) {
	t.Helper()
	index := make(map[string]bool, len(got))
	for _, s := range got {
		index[s] = true
	}
	for _, s := range forbidden {
		if index[s] {
			t.Errorf("expected stage %q to be absent; got %v", s, got)
		}
	}
}

// ── resolveActiveStages (via DescribePipeline) ──────────────────────────────

// Test 1: AlwaysEnforced stages always present with PublicProfile.
func TestAlwaysEnforcedStagesAlwaysPresent(t *testing.T) {
	stages := pipeline.DescribePipeline(emptyCtx, pipeline.PublicProfile)

	alwaysEnforced := []string{
		"rate_limit",
		"request_size_limit",
		"logging",
		"error_handling",
		"audit",
	}
	containsAll(t, stages, alwaysEnforced)
}

// Test 2: PublicProfile skips optional stages.
func TestPublicProfileSkipsOptionalStages(t *testing.T) {
	stages := pipeline.DescribePipeline(emptyCtx, pipeline.PublicProfile)

	skipped := []string{
		"auth",
		"csrf",
		"fingerprint",
		"device_id",
		"access_control",
		"admin_check",
	}
	containsNone(t, stages, skipped)
}

// Test 3: admin_check only appears when AdminOnly=true.
func TestAdminCheckOnlyForAdminOnly(t *testing.T) {
	adminStages := pipeline.DescribePipeline(emptyCtx, pipeline.AdminProfile)
	containsAll(t, adminStages, []string{"admin_check"})

	defaultStages := pipeline.DescribePipeline(emptyCtx, pipeline.DefaultProfile)
	containsNone(t, defaultStages, []string{"admin_check"})
}

// Test 4: DefaultProfile skips nothing (all non-admin stages present).
func TestDefaultProfileSkipsNothing(t *testing.T) {
	stages := pipeline.DescribePipeline(emptyCtx, pipeline.DefaultProfile)

	expected := []string{
		"rate_limit",
		"request_size_limit",
		"logging",
		"error_handling",
		"auth",
		"csrf",
		"fingerprint",
		"device_id",
		"access_control",
		"transaction",
		"audit",
		"handler",
	}
	containsAll(t, stages, expected)
}

// Test 5: LoginOnlyProfile keeps auth/csrf/fingerprint/device_id, skips access_control and admin_check.
func TestLoginOnlyProfileSkipsAccessControlAndAdminCheck(t *testing.T) {
	stages := pipeline.DescribePipeline(emptyCtx, pipeline.LoginOnlyProfile)

	present := []string{
		"auth",
		"csrf",
		"fingerprint",
		"device_id",
	}
	containsAll(t, stages, present)

	absent := []string{
		"access_control",
		"admin_check",
	}
	containsNone(t, stages, absent)
}

// Test 6: The SSE route keeps ACL checks but skips transactions for long-lived streams.
func TestSSESubscribeProfileSkipsTransactionOnly(t *testing.T) {
	profile := pipeline.GetProfile("event_bus.SSESubscribeHandler")
	stages := pipeline.DescribePipeline(emptyCtx, profile)

	present := []string{
		"auth",
		"csrf",
		"fingerprint",
		"device_id",
		"access_control",
	}
	containsAll(t, stages, present)

	absent := []string{
		"admin_check",
		"transaction",
	}
	containsNone(t, stages, absent)
}

func TestDescribeRouteProfileNamesAccessControlNoTxProfile(t *testing.T) {
	descriptor := pipeline.DescribeRouteProfile("event_bus.SSESubscribeHandler")

	if descriptor.ProfileName != "access_control_no_tx" {
		t.Fatalf("SSE profile name = %q, want access_control_no_tx", descriptor.ProfileName)
	}
	containsAll(t, descriptor.SkipStages, []string{"admin_check", "transaction"})
}

// ── GetProfile ───────────────────────────────────────────────────────────────

// Test 7: Known handler returns its registered profile (PublicProfile).
func TestGetProfileKnownHandler(t *testing.T) {
	profile := pipeline.GetProfile("auth.LoginHandler")

	// PublicProfile skips auth; DefaultProfile does not.
	if !profile.Skips("auth") {
		t.Errorf("auth.LoginHandler should have PublicProfile (skips auth), got %+v", profile)
	}
}

// Test 8: Unknown handler returns DefaultProfile.
func TestGetProfileUnknownHandlerReturnsDefault(t *testing.T) {
	profile := pipeline.GetProfile("nonexistent.Handler")

	// DefaultProfile has empty SkipStages.
	if profile.Skips("auth") {
		t.Errorf("unknown handler should return DefaultProfile (no skips), got %+v", profile)
	}
	if profile.AdminOnly {
		t.Errorf("unknown handler should return DefaultProfile (AdminOnly=false), got %+v", profile)
	}
}

// ── ApplyDevOverrides ────────────────────────────────────────────────────────

// explicitDevHandlers are the handler names registered only in explicit dev mode.
var explicitDevHandlers = []string{
	"devtools.SessionHandler",
	"devtools.ExportTableCSVHandler",
	"devtools.ImportTableCSVHandler",
	"pipeline.IntrospectionHandler",
	"devtools.LogClientError",
	"devtools.CheckJsonInTextColumnsHandler",
	"lang.UpdateLangKeyHandler",
	"lang.AiTranslateSingleHandler",
}

// schemaShortcutHandlers get PublicProfile only when ENVIRONMENT_TYPE=dev.
var schemaShortcutHandlers = []string{
	"dtt_crud_workflows.CreateTableHandler",
	"dtt_crud_workflows.SetCommentsHandler",
	"dtt_crud_workflows.CreateIndexesHandler",
	"lang.GenerateTranslationsHandler",
}

var explicitDevAdminHandlers = []string{
	"devtools.SessionHandler",
	"devtools.ExportTableCSVHandler",
	"devtools.ImportTableCSVHandler",
	"pipeline.IntrospectionHandler",
	"devtools.CheckJsonInTextColumnsHandler",
	"lang.UpdateLangKeyHandler",
	"lang.AiTranslateSingleHandler",
}

var explicitDevPublicHandlers = []string{
	"devtools.LogClientError",
}

// Test 9: No-op when ENVIRONMENT_TYPE=production — no dev-only profiles, no schema shortcuts.
func TestApplyDevOverridesNoOpInProduction(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "production")

	// Save originals for schema shortcut handlers.
	originals := make(map[string]pipeline.RouteProfile, len(schemaShortcutHandlers))
	for _, name := range schemaShortcutHandlers {
		originals[name] = pipeline.GetProfile(name)
	}

	pipeline.ApplyDevOverrides()

	// Schema shortcut profiles should be unchanged.
	for _, name := range schemaShortcutHandlers {
		after := pipeline.GetProfile(name)
		orig := originals[name]
		if after.AdminOnly != orig.AdminOnly {
			t.Errorf("%s: AdminOnly changed after no-op ApplyDevOverrides", name)
		}
		if after.Skips("auth") != orig.Skips("auth") {
			t.Errorf("%s: Skips(auth) changed after no-op ApplyDevOverrides", name)
		}
	}

	// Dev-only handlers must NOT have profiles in production.
	for _, name := range explicitDevHandlers {
		if _, exists := pipeline.RouteProfiles[name]; exists {
			t.Errorf("%s: dev-only profile should not exist in production", name)
		}
	}
}

// Test 10: No-op when ENVIRONMENT_TYPE is unset — explicit dev mode is required.
func TestApplyDevOverridesNoOpWhenEnvUnset(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "")

	originals := make(map[string]pipeline.RouteProfile, len(schemaShortcutHandlers))
	for _, name := range schemaShortcutHandlers {
		originals[name] = pipeline.GetProfile(name)
	}

	pipeline.ApplyDevOverrides()

	for _, name := range schemaShortcutHandlers {
		after := pipeline.GetProfile(name)
		orig := originals[name]
		if after.AdminOnly != orig.AdminOnly {
			t.Errorf("%s: AdminOnly changed after no-op ApplyDevOverrides", name)
		}
		if after.Skips("auth") != orig.Skips("auth") {
			t.Errorf("%s: Skips(auth) changed after no-op ApplyDevOverrides", name)
		}
	}

	for _, name := range explicitDevHandlers {
		if _, exists := pipeline.RouteProfiles[name]; exists {
			t.Errorf("%s: dev-only profile should not exist when ENVIRONMENT_TYPE is unset", name)
		}
	}
}

// Test 11: When ENVIRONMENT_TYPE=dev, dev-only profiles are registered and schema shortcuts get PublicProfile.
func TestApplyDevOverridesInDev(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")

	// Save originals so we can restore after test.
	allAffected := append(append([]string{}, schemaShortcutHandlers...), explicitDevHandlers...)
	originals := make(map[string]pipeline.RouteProfile, len(allAffected))
	existed := make(map[string]bool, len(allAffected))
	for _, name := range allAffected {
		if p, ok := pipeline.RouteProfiles[name]; ok {
			originals[name] = p
			existed[name] = true
		}
	}
	t.Cleanup(func() {
		for _, name := range allAffected {
			if existed[name] {
				pipeline.RouteProfiles[name] = originals[name]
			} else {
				delete(pipeline.RouteProfiles, name)
			}
		}
	})

	pipeline.ApplyDevOverrides()

	// Schema shortcut handlers should be PublicProfile.
	for _, name := range schemaShortcutHandlers {
		profile := pipeline.GetProfile(name)
		if !profile.Skips("auth") {
			t.Errorf("%s: expected PublicProfile (skips auth) after ApplyDevOverrides in dev, got %+v", name, profile)
		}
		if !profile.Skips("access_control") {
			t.Errorf("%s: expected PublicProfile (skips access_control) after ApplyDevOverrides in dev, got %+v", name, profile)
		}
	}

	// Dev-only handlers should have profiles registered.
	for _, name := range explicitDevHandlers {
		if _, exists := pipeline.RouteProfiles[name]; !exists {
			t.Errorf("%s: dev-only profile should exist in dev mode", name)
		}
	}

	for _, name := range explicitDevAdminHandlers {
		profile := pipeline.GetProfile(name)
		if !profile.AdminOnly {
			t.Errorf("%s: expected AdminProfile (AdminOnly=true) in dev, got %+v", name, profile)
		}
	}

	for _, name := range explicitDevPublicHandlers {
		profile := pipeline.GetProfile(name)
		if !profile.Skips("auth") {
			t.Errorf("%s: expected PublicProfile (skips auth) in dev, got %+v", name, profile)
		}
	}
}
