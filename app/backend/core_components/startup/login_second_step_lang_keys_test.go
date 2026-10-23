// login_second_step_lang_keys_test.go
// Verifies second-step startup copy and its insert-or-fill-empty policy without PostgreSQL.
// Connects the login catalogue and the startup SQL mock driver to reviewed FI/EN fallback copy.
// Exists so code-screen labels cannot drift or replace a site's non-empty translations.
package startup

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestSecondStepStartupLangKeyUpsertPreservesNonEmpty(t *testing.T) {
	db := newAppDBCompatibilityTestDB(t)
	defer db.Close()
	for range loginSecondStepLangKeySeeds {
		pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})
	}
	EnsureLoginSecondStepLangKeys(db)
	calls := snapshotAppDBCompatibilityCalls()
	if len(calls) != len(loginSecondStepLangKeySeeds) {
		t.Fatalf("expected %d upserts, got %d", len(loginSecondStepLangKeySeeds), len(calls))
	}
	for _, call := range calls {
		if !strings.Contains(call, "ON CONFLICT (lang_key)") {
			t.Fatalf("missing conflict handling: %s", call)
		}
		for _, language := range []string{"fi", "en", "ch"} {
			guard := "CASE WHEN system_lang_keys." + language + " IS NULL OR system_lang_keys." + language + " = '' THEN EXCLUDED." + language + " ELSE system_lang_keys." + language + " END"
			if !strings.Contains(call, guard) {
				t.Fatalf("missing fill-empty-only guard for %s: %s", language, call)
			}
		}
	}
}

func TestSecondStepCopyMatchesFrontendFallbacks(t *testing.T) {
	source, err := os.ReadFile("../../../frontend/core_components/auth/second_step_translation_fallbacks.js")
	if err != nil {
		t.Fatal(err)
	}
	start := strings.Index(string(source), "= {") + 2
	var fallback map[string]map[string]string
	if err := json.Unmarshal([]byte(strings.TrimSuffix(strings.TrimSpace(string(source[start:])), ";")), &fallback); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, seed := range loginSecondStepLangKeySeeds {
		if seen[seed.langKey] {
			t.Fatalf("duplicate key: %s", seed.langKey)
		}
		seen[seed.langKey] = true
		if seed.fi == "" || seed.en == "" || seed.ch == "" {
			t.Fatalf("empty seed: %s", seed.langKey)
		}
		if fallback[seed.langKey]["fi"] != seed.fi || fallback[seed.langKey]["en"] != seed.en {
			t.Fatalf("copy differs from fallback: %s", seed.langKey)
		}
		if regexp.MustCompile(`\b[Oo][Tt][Pp]\b`).MatchString(seed.fi + " " + seed.en) {
			t.Fatalf("implementation name in visible copy: %s", seed.langKey)
		}
	}
	if len(seen) != len(fallback) {
		t.Fatal("fallback and seed key sets differ")
	}
}
