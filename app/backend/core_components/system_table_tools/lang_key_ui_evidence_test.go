// lang_key_ui_evidence_test.go
// Tests public literal qualification and stat-only fingerprint invalidation.
// Uses the production walker, registry merge and reviewed declarations.
// Protects private schema names even beside a real UI helper call.
package system_table_tools

import (
	"database/sql/driver"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/lang_key_naming"
)

func uiSources(t *testing.T, path, raw string, keys ...string) []sourceEntry {
	t.Helper()
	_, tokens := lexLangKeyCode(raw, filepath.Ext(path))
	candidates := appendLangKeyCodeCandidates(nil, tokens, path, raw, map[string]bool{})
	declared, err := declaredLangKeyCandidates(path, raw, tokens)
	if err != nil {
		t.Fatal(err)
	}
	registry := map[string]int64{}
	for i, key := range keys {
		registry[key] = int64(i + 1)
	}
	return resolveLangKeyCodeSources(append(candidates, declared...), registry)
}

func TestUILiteralOnlyReviewedFullHelperArguments(t *testing.T) {
	raw := `getTranslationForKey('status'); getTranslationForKey('prefix_' + name);
 getTranslationForKey(variable); getTranslationForKey('not_literal'.trim());
 // getTranslationForKey('comment_only');
 const values = {property_only: ['array']};
 other.getTranslationForKey('member_only');
 t('about'); t('part_' + name);`
	path := "app/frontend/core_components/filterbar/top_row_buttons/sort_default_scope_modal_builder.js"
	marked := 0
	for _, source := range uiSources(t, path, raw, "status", "prefix_private", "comment_only", "property_only", "member_only", "about", "part_private") {
		if source.literalUI {
			marked++
		}
		if source.literalUI != (source.sourceType == "" && (source.langKey == "status" || source.langKey == "about")) {
			t.Fatalf("incorrect authority: %+v", source)
		}
	}
	if marked != 2 {
		t.Fatalf("expected both full helper literals, got %d", marked)
	}
	// A generic hit pre-dating the literal in the same file must merge upward.
	candidates := []sourceEntry{{langKey: "status", filePath: path}, {langKey: "status", filePath: path, literalUI: true}, {langKey: "status", filePath: path}}
	got := resolveLangKeyCodeSources(candidates, map[string]int64{"status": 1})
	if len(got) != 1 || !got[0].literalUI {
		t.Fatal(got)
	}
}

func TestUILiteralDeclarationsExcludeFamiliesSchemaAndAliases(t *testing.T) {
	for _, raw := range []string{
		`package example
// lang-key-declaration: {"build":"return alias + \" (ln)\"","schema":"linked_name"}
func label(alias string) string { return alias + " (ln)" }`,
		`package example
// lang-key-declaration: {"build":"return prefix +","prefix":"private_","values":["name"]}
func label() string { prefix := "private_"; return prefix + "name" }`,
		`package example
// lang-key-declaration: {"build":"return derived(name)","keys":["private_alias"]}
func label(name string) string { return derived(name) }`,
	} {
		raw += "\nfunc ui() { getTranslationForKey(\"status\") }"
		_, tokens := lexLangKeyCode(raw, ".go")
		declared, err := declaredLangKeyCandidates("app/backend/owner.go", raw, tokens)
		if err != nil || len(declared) == 0 {
			t.Fatal("negative fixture did not emit B4 evidence", declared, err)
		}
		for _, source := range declared {
			if source.literalUI {
				t.Fatal("declaration obtained UI authority", source)
			}
		}
		literal := false
		for _, source := range uiSources(t, "app/backend/owner.go", raw, "private_name", "private_alias", "status") {
			if source.literalUI && source.langKey != "status" {
				t.Fatalf("declaration inherited literal authority: %+v", source)
			}
			literal = literal || source.literalUI
		}
		if !literal {
			t.Fatal("real literal missing from negative fixture")
		}
	}
	for _, d := range uiLiteralCatalogues {
		if !reviewedUILiteralCatalogue(d) {
			t.Fatal(d)
		}
		changed := d
		changed.Keys = append(append([]string{}, d.Keys...), "private_name")
		if reviewedUILiteralCatalogue(changed) {
			t.Fatal("unreviewed addition trusted")
		}
		changed = d
		changed.Owner = "private/" + d.Owner
		if reviewedUILiteralCatalogue(changed) {
			t.Fatal("another root trusted")
		}
	}
	if reviewedUILiteralCatalogue(lang_key_naming.Declaration{Keys: []string{"private_alias"}}) {
		t.Fatal("undeclared owner trusted")
	}
}

func TestUILiteralFingerprintIncludesAllRootsFilesAndPolicy(t *testing.T) {
	scanTrustFixture(t)
	root := currentLangKeyRuntimePaths().InstallationRoot
	fingerprint := func() string {
		t.Helper()
		_, fp, err := langKeyCodeInventory()
		if err != nil {
			t.Fatal(err)
		}
		return fp
	}
	previous := fingerprint()
	change := func() {
		t.Helper()
		next := fingerprint()
		if previous == next {
			t.Fatal("fingerprint unchanged")
		}
		previous = next
	}
	if fingerprint() != previous {
		t.Fatal("unstable fingerprint")
	}
	owner := "fingerprint_test_owner"
	langKeyHelperOwners[owner] = map[string]int{"helper": 0}
	t.Cleanup(func() { delete(langKeyHelperOwners, owner) })
	change()
	saved := uiLiteralCatalogues
	t.Cleanup(func() { uiLiteralCatalogues = saved })
	uiLiteralCatalogues = append(append([]lang_key_naming.Declaration{}, saved...), lang_key_naming.Declaration{Owner: "reviewed.js", Build: "copy(key)", Keys: []string{"new_copy"}})
	change()
	uiLiteralCatalogues[0].Owner = "different-reviewed-owner.js"
	change()
	additional := filepath.Join(root, "private")
	createLangKeySourceRoot(t, additional, false)
	replaceAdditionalLangKeySourceRootsForTest(t, []string{additional})
	change()
	for _, base := range []string{currentLangKeyRuntimePaths().ApplicationRoot, additional} {
		for _, dir := range []string{"frontend", "backend", "components"} {
			if err := os.MkdirAll(filepath.Join(base, dir), 0700); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(base, dir, "view.js")
			if err := os.WriteFile(file, []byte(`getTranslationForKey('status')`), 0600); err != nil {
				t.Fatal(err)
			}
			change()
			at := time.Now().Add(time.Hour)
			if err := os.Chtimes(file, at, at); err != nil {
				t.Fatal(err)
			}
			change()
			if err := os.Rename(file, filepath.Join(base, dir, "renamed.js")); err != nil {
				t.Fatal(err)
			}
			change()
		}
	}
	// Tests never become evidence or fingerprint inputs.
	for _, dir := range []string{"test", "tests", "__tests__", "testing", "e2e"} {
		file := filepath.Join(currentLangKeyRuntimePaths().ApplicationRoot, "frontend", dir, "ignored.js")
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(`getTranslationForKey('private_name')`), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if fingerprint() != previous {
		t.Fatal("test directory entered inventory")
	}
}

func TestUILiteralSchemaAliasCannotOverwriteSameFileLiteral(t *testing.T) {
	scanTrustFixture(t)
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"column_name", "table_name"}, rows: [][]driver.Value{{"owner_id", "tasks"}}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"table_name"}})
	queueB4LinkedMetadata("owner_id", true, false)
	const owner = "app/backend/build_joins_1m.go"
	_, err := scanSchemaLangKeySources(map[string]int64{"owner_name (ln)": 1}, []sourceEntry{
		{schemaAlias: true, schemaBuilder: `return alias + " (ln)"`, filePath: owner},
		{langKey: "owner_name (ln)", filePath: owner, literalUI: true},
	}, map[int64]bool{1: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, call := range snapshotOrphanCalls() {
		if strings.Contains(call, "INSERT INTO system_lang_key_sources") {
			t.Fatal("schema alias overwrote literal", call)
		}
	}
}

func TestUILiteralReviewedCataloguesUseActualFiniteDeclarations(t *testing.T) {
	for _, reviewed := range uiLiteralCatalogues {
		path := filepath.Join("..", "..", "..", filepath.FromSlash(strings.TrimPrefix(reviewed.Owner, "app/")))
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		found := map[string]bool{}
		for _, source := range uiSources(t, reviewed.Owner, string(raw), reviewed.Keys...) {
			if source.literalUI {
				found[source.langKey] = true
			}
		}
		for _, key := range reviewed.Keys {
			if !found[key] {
				t.Fatalf("reviewed finite copy missing: %s in %s", key, reviewed.Owner)
			}
		}
	}
}
