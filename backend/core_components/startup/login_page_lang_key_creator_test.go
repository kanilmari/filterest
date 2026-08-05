// login_page_lang_key_creator_test.go
// Verifies the login-page startup lang-key seeding path.
// Bridges EnsureLoginPageLangKeys and the startup SQL mock driver shared in this package.
// Exists to keep the login intro/tour translation seeds covered without requiring
// a live PostgreSQL instance.
package startup

import (
	"strings"
	"testing"
)

func TestEnsureLoginPageLangKeysUpsertsLoginIntroKey(t *testing.T) {
	db := newAppDBCompatibilityTestDB(t)
	defer db.Close()

	for range loginPageLangKeySeeds {
		pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})
	}
	pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})
	pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})

	EnsureLoginPageLangKeys(db)

	calls := snapshotAppDBCompatibilityCalls()
	if len(calls) != len(loginPageLangKeySeeds)+2 {
		t.Fatalf("expected %d startup lang-key calls, got %d (%v)", len(loginPageLangKeySeeds)+2, len(calls), calls)
	}

	upsertCalls := 0
	legacyReplaceFound := false
	for _, call := range calls {
		if !strings.Contains(call, "INSERT INTO system_lang_keys") {
			if strings.Contains(call, "UPDATE system_lang_keys") &&
				strings.Contains(call, "WHEN fi LIKE $2 || '%' THEN $3") &&
				strings.Contains(call, "WHEN en LIKE $4 || '%' THEN $5") &&
				strings.Contains(call, "WHEN ch LIKE $6 || '%' THEN $7") &&
				strings.Contains(call, "WHERE lang_key = $1") {
				legacyReplaceFound = true
				continue
			}
			t.Fatalf("expected login lang-key upsert or legacy replacement query, got %q", call)
		}
		if !strings.Contains(call, "ON CONFLICT (lang_key)") {
			t.Fatalf("expected lang_key conflict handling, got %q", call)
		}
		upsertCalls++
	}
	if upsertCalls != len(loginPageLangKeySeeds) {
		t.Fatalf("expected %d startup upsert calls, got %d (%v)", len(loginPageLangKeySeeds), upsertCalls, calls)
	}
	if !legacyReplaceFound {
		t.Fatalf("expected legacy login tour copy replacement query, got %v", calls)
	}
}

func TestLoginPageSiteTourCopyUsesFilterestPublicBrand(t *testing.T) {
	var siteStory *startupLangKeySeed
	for index := range loginPageLangKeySeeds {
		if loginPageLangKeySeeds[index].langKey == "login_page_platform_story_site_html" {
			siteStory = &loginPageLangKeySeeds[index]
			break
		}
	}
	if siteStory == nil {
		t.Fatal("login_page_platform_story_site_html seed was not found")
	}

	combined := strings.ToLower(siteStory.fi + siteStory.en + siteStory.ch)
	for _, blocked := range []string{"easelect", "screenshot", "screenshots", "kuvankaappaus"} {
		if strings.Contains(combined, blocked) {
			t.Fatalf("site tour copy contains %q: %s", blocked, combined)
		}
	}
	if !strings.Contains(siteStory.en, "public service catalog") ||
		!strings.Contains(siteStory.en, "internal service, ticket, or documentation workspace") ||
		!strings.Contains(siteStory.en, "public news or event site") ||
		!strings.Contains(siteStory.en, "specialist reference database") ||
		!strings.Contains(siteStory.en, "technical knowledge base") {
		t.Fatalf("site tour copy is missing expected Filterest use-case examples: %s", siteStory.en)
	}
}
