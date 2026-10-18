// lang_key_catalogue_scan_test.go
// Runs the startup scan's own recognition over the modules that declare their
// language keys in a catalogue instead of beside the translation call.
// Bridges langKeyPatterns with the real frontend files those keys live in.
// Keeps used keys backed by code evidence while orphan maintenance is report-only.
// Retirement and any later archiving still follow the per-site lifecycle gates.
package system_table_tools

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// langKeysFoundInSource applies the same patterns the code scan applies to a
// JavaScript file, so a passing test means the scan itself would find the key.
func langKeysFoundInSource(content string) map[string]bool {
	found := make(map[string]bool)
	for _, pattern := range langKeyPatterns {
		for _, match := range pattern.FindAllStringSubmatch(content, -1) {
			if len(match) > 1 {
				found[match[1]] = true
			}
		}
	}
	return found
}

func TestScanFindsLangKeysDeclaredInACatalogue(t *testing.T) {
	// Each module keeps its copy in one catalogue near the top of the file and
	// passes a variable to the translation call. Before these shapes were
	// recognised, every key below was invisible to the scan.
	modules := []struct {
		relativePath string
		wantKeys     []string
	}{
		{
			relativePath: "frontend/core_components/filterbar/filter_list/row_group_facet_card_builder.js",
			wantKeys: []string{
				"row_group_match_legend", "row_group_match_help_label", "row_group_match_headings_hint",
				"row_group_match_any", "row_group_match_all", "row_group_match_any_effect", "row_group_match_all_effect",
				"row_group_match_any_hint", "row_group_match_all_hint", "row_group_single_value_hint",
				"row_group_categories", "row_group_no_results_hint", "row_group_selection_limit",
				"row_group_no_name_matches", "row_group_selected_count",
				"show_more", "show_less", "clear_selections", "filters", "close", "search",
			},
		},
		{
			relativePath: "frontend/core_components/table_views/table_view/table_header_sort.js",
			wantKeys:     []string{"sort_newest", "sort_oldest"},
		},
		{
			relativePath: "frontend/core_components/ai_features/table_chat/table_chat_attachments.js",
			wantKeys: []string{
				"chat_attach_image", "chat_attach_remove", "chat_attach_too_many",
				"chat_attach_rejected", "chat_attach_failed", "chat_attach_uploading",
			},
		},
		{
			relativePath: "frontend/core_components/ai_features/table_chat/table_chat_pending_changes.js",
			wantKeys: []string{
				"site_assistant_pending_heading", "site_assistant_pending_intro",
				"site_assistant_pending_approve_all", "site_assistant_pending_approve_one",
				"site_assistant_pending_running", "site_assistant_pending_done",
				"site_assistant_pending_failed", "site_assistant_pending_error",
				"site_assistant_pending_dataset", "site_assistant_pending_details",
			},
		},
		{
			// The dataset form (both modes and every setting control) keeps all
			// of its copy in this one fallback catalogue; the controls pass
			// the key to its text helper.
			relativePath: "frontend/core_components/general_tables/dataset_form/dataset_form_translation_fallbacks.js",
			wantKeys: []string{
				"dataset_symbol_label", "dataset_symbol_none", "dataset_symbol_loading",
				"dataset_symbol_unavailable", "dataset_symbol_save_failed",
				"table_folder_hint", "dataset_folder_for_new_dataset", "dataset_folder_option_current_project",
				"dataset_new_folder_open", "dataset_new_folder_parent", "dataset_new_folder_name_required",
				"dataset_created_in_folder", "dataset_created_outside_navigation",
				"dataset_created_settings_need_attention", "manage_table_settings_need_attention",
			},
		},
		{
			relativePath: "frontend/core_components/admin_tools/dataset_header_config_translation_fallbacks.js",
			wantKeys: []string{
				"dataset_header_config_intro", "dataset_header_config_text_keys_hint",
				"dataset_header_config_cover_title", "dataset_header_config_background_hint",
				"dataset_header_config_no_image", "dataset_header_config_not_loaded",
				"dataset_select_target", "unsaved_changes",
			},
		},
		{
			relativePath: "frontend/core_components/general_tables/dataset_form/dataset_column_type_catalog.js",
			wantKeys: []string{
				"dataset_column_type_serial", "dataset_column_type_integer",
				"dataset_column_type_varchar", "dataset_column_type_auto_timestamp",
				"dataset_column_type_precision", "dataset_column_type_scale",
			},
		},
	}

	applicationRoot := filepath.Join("..", "..", "..")
	for _, module := range modules {
		t.Run(filepath.Base(module.relativePath), func(t *testing.T) {
			path := filepath.Join(applicationRoot, filepath.FromSlash(module.relativePath))
			content, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read %s: %v — if the module moved, update this list rather than dropping it", module.relativePath, err)
			}
			found := langKeysFoundInSource(string(content))
			for _, key := range module.wantKeys {
				if !found[key] {
					t.Errorf("the startup scan does not see %q in %s, so code-use evidence is missing", key, module.relativePath)
				}
			}
		})
	}
}

func TestCatalogueShapesDoNotSwallowOrdinaryIdentifiers(t *testing.T) {
	// A false match only keeps a dead key alive, but noise makes the orphan
	// report useless, so the shapes stay narrow.
	notKeys := []string{
		`const headers = { apiKey: "abc123" };`,
		`input.accept = ["image/png", "image/jpeg"].join(",");`,
		`const options = { sortKey: "name", storageKey: "draft" };`,
		`const sizes = ["small", "large"];`,
	}
	for _, source := range notKeys {
		if found := langKeysFoundInSource(source); len(found) > 0 {
			t.Errorf("source %q should declare no language key, found %v", source, found)
		}
	}
}

func TestCatalogueShapesFindEachDeclarationForm(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    string
	}{
		{
			name:    "catalogue entry with fallback copy",
			content: `const COPY_KEYS = Object.freeze({ attach: ["chat_attach_image", "Attach an image"] });`,
			want:    "chat_attach_image",
		},
		{
			name:    "key-named property",
			content: `{ value: "TEXT", labelKey: "dataset_column_type_text" }`,
			want:    "dataset_column_type_text",
		},
		{
			name:    "fallback translations keyed by the language key",
			content: `return { image_ready: { fi: "Kuva on valmis", en: "Image is ready" } };`,
			want:    "image_ready",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if !langKeysFoundInSource(testCase.content)[testCase.want] {
				t.Fatalf("source scanning should find %q", testCase.want)
			}
		})
	}
}

// resolvedCodeInFile exercises the same lexer, legacy patterns and B3 registry
// gate as population. A literal-only result must never masquerade as code.
func resolvedCodeInFile(path, content string, registry map[string]int64) []sourceEntry {
	clean, tokens := lexLangKeyCode(content, filepath.Ext(path))
	found := langKeysFoundInSource(clean)
	var candidates []sourceEntry
	for key := range found {
		candidates = append(candidates, sourceEntry{langKey: key, filePath: path})
	}
	return resolveLangKeyCodeSources(appendLangKeyCodeCandidates(candidates, tokens, path, content, found), registry)
}

func TestReviewedLangKeyHelperOwners(t *testing.T) {
	// Each full-key helper has a real owner and a checked argument contract.
	// createPanelText currently receives catalogue variables at every call;
	// its literal argument form is checked below using its actual declaration.
	cases := []struct {
		path, helper, declaration, key string
		argument                       int
	}{
		{"frontend/core_components/filterbar/top_row_buttons/sort_default_scope_modal_builder.js", "t", "const t = (key, fallback)", "sort_default_scope_title", 0},
		{"frontend/core_components/filterbar/top_row_buttons/dataset_sort_default_controller.js", "t", "const t = (key, fallback)", "sort_set_default", 0},
		{"frontend/core_components/filterbar/filter_list/column_view_preset_builder.js", "t", "const t = (key, fallback)", "filterbar_select_visible_fields", 0},
		{"frontend/core_components/admin_tools/row_group_assignment_editor.js", "text", "function text(key, fallback = key)", "row_group_window_invalid_response", 0},
		{"frontend/core_components/admin_tools/row_group_assignment_editor.js", "element", "function element(tag, key, fallback)", "row_group_window_edit_names", 1},
		{"frontend/core_components/admin_tools/row_group_assignment_editor.js", "field", "function field(parent, key, input)", "row_group_window_slug", 1},
		{"frontend/core_components/admin_tools/dataset_default_view_row.js", "text", "const text = key => getTranslationForKey(key)", "dataset_default_view_for", 0},
		{"frontend/core_components/admin_tools/site_label_value_layout_control.js", "text", "const text = key =>", "label_value_layout", 0},
		{"frontend/core_components/user_tools/profile_security_printer.js", "text", "const text = key => getTranslationForKey(key)", "login_name_change_help", 0},
		{"frontend/core_components/user_tools/profile_security_printer.js", "label", "function label(element, key)", "change_login_name", 1},
		{"frontend/core_components/table_views/article_view/article_language_editor.js", "copy", "const copy = (key, fallback)", "article_edit_languages", 0},
		{"frontend/core_components/table_views/price_chart_view/price_chart_view_printer.js", "copy", "function copy(key)", "view_chart", 0},
		{"frontend/core_components/admin_tools/front_page_settings_view.js", "report", "function report(key)", "front_page_save_conflict", 0},
		{"frontend/core_components/filterbar/filter_list/row_group_facet_card_builder.js", "createPanelText", "function createPanelText(tag, key, className)", "row_group_categories", 1},
		{"backend/core_components/auth/profile_update.go", "profileFailure", "func profileFailure(w http.ResponseWriter, status int, key string)", "session_error", 2},
		{"backend/core_components/workline_observatory/publication_handlers.go", "respondPublicationRefusal", "func respondPublicationRefusal(w http.ResponseWriter, status int, key string)", "publication_revision_required", 2},
		{"backend/core_components/email/account_email.go", "copy", "copy := func(key string)", "login_name_change_notice_subject", 0},
	}
	for _, c := range cases {
		t.Run(c.path+"/"+c.helper, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join("../../..", c.path))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(data), c.declaration) {
				t.Fatalf("review helper contract after owner changed: %s", c.declaration)
			}
			path := "app/" + c.path
			helpers := keyHelperArguments(path, string(data))
			if position, ok := helpers[c.helper]; !ok || position != c.argument {
				t.Fatal(helpers)
			}
			// Test exact argument position with nested preceding arguments, so a tag,
			// response writer or status cannot become the key by accident.
			arguments := []string{`nested(value, other)`, `nested(value, other)`, `nested(value, other)`}
			arguments[c.argument] = strconv.Quote(c.key)
			source := c.helper + "(" + strings.Join(arguments, ",") + ")"
			entries := resolvedCodeInFile(path, source, map[string]int64{c.key: 1})
			if !hasDefiniteCode(entries) {
				t.Fatalf("helper argument not code evidence: %v", entries)
			}
			actual := resolvedCodeInFile(path, string(data), map[string]int64{c.key: 1})
			if len(actual) == 0 {
				t.Fatalf("real owner lost key %q", c.key)
			}
		})
	}
	// Every accepted exported frontPage* contract is verified in its owner;
	// real callers are in the Home settings view, including nested DOM calls.
	controls, err := os.ReadFile("../../../frontend/core_components/admin_tools/front_page_settings_controls.js")
	if err != nil {
		t.Fatal(err)
	}
	view, err := os.ReadFile("../../../frontend/core_components/admin_tools/front_page_settings_view.js")
	if err != nil {
		t.Fatal(err)
	}
	for helper, argument := range frontPageKeyHelpers {
		if !strings.Contains(string(controls), "function "+helper+"(") || !strings.Contains(string(view), helper+"(") {
			t.Fatal(helper)
		}
		args := []string{`nested(tag, options)`, `nested(tag, options)`}
		args[argument] = `"front_page_settings"`
		source := `import { ` + helper + ` } from './front_page_settings_controls.js'; ` + helper + `(` + strings.Join(args, ",") + `)`
		entries := resolvedCodeInFile("app/frontend/core_components/admin_tools/front_page_settings_view.js", source, map[string]int64{"front_page_settings": 1})
		if !hasDefiniteCode(entries) {
			t.Fatal(helper, entries)
		}
	}
}

func TestB3NarrowPatternsInRealFiles(t *testing.T) {
	for _, c := range []struct{ path, key string }{
		{"frontend/core_components/admin_tools/row_group_assignment_editor.js", "row_group_window_name_fi"},      // template prefix
		{"frontend/core_components/admin_tools/site_label_value_layout_control.js", "label_value_layout_inline"}, // concatenation
		{"frontend/core_components/table_views/price_chart_view/chart_copy.js", "view_chart"},                    // property-keyed array
		{"backend/core_components/system_table_tools/front_page_hero.go", "site_front_page_title"},               // const ...Key
	} {
		t.Run(c.path, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join("../../..", c.path))
			if err != nil {
				t.Fatal(err)
			}
			entries := resolvedCodeInFile("app/"+c.path, string(data), map[string]int64{c.key: 1})
			if !hasDefiniteCode(entries) {
				t.Fatalf("missing definite evidence: %v", entries)
			}
		})
	}
}

func TestB3HelpersAndLiteralsRejectFalseMatches(t *testing.T) {
	registry := map[string]int64{"sort_set_default": 1, "label_value_layout_inline": 2}
	for _, c := range []struct {
		name, path, source string
		wantLiteral        bool
	}{
		{"unrelated t", "app/frontend/ordinary.js", `function t(value) {return value}; t("sort_set_default")`, true},
		{"member t", "app/frontend/core_components/filterbar/top_row_buttons/dataset_sort_default_controller.js", `other.t("sort_set_default")`, true},
		// D3a includes quoted existing names in comments as literal evidence;
		// the exact-one-literal assertion below still excludes definite code.
		{"line comment", "app/frontend/core_components/filterbar/top_row_buttons/dataset_sort_default_controller.js", `// t("sort_set_default")`, true},
		{"block comment", "app/frontend/core_components/filterbar/top_row_buttons/dataset_sort_default_controller.js", `/* t("sort_set_default") */`, true},
		{"HTML comment", "app/frontend/view.html", `<!-- data-lang-key="sort_set_default" -->`, true},
		{"commented Go constant", "app/backend/ordinary.go", `// const exampleKey = "sort_set_default"`, true},
		// 208:a extends D3a's raw-text safety net to prefix expansion too.
		{"commented prefix", "app/frontend/ordinary.js", `// const key = "label_value_layout_" + mode;`, true},
		{"not a key", "app/frontend/core_components/filterbar/top_row_buttons/dataset_sort_default_controller.js", `t("not_an_existing_key")`, false},
		{"built in Go copy", "app/backend/ordinary.go", `copy(dst,"sort_set_default")`, true},
		{"prefix absent", "app/frontend/ordinary.js", "const key = `not_a_real_prefix_${value}`;", false},
		{"template is not literal", "app/frontend/ordinary.js", "const key = `sort_set_default${value}`;", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			entries := resolvedCodeInFile(c.path, c.source, registry)
			if c.wantLiteral {
				if len(entries) != 1 || entries[0].sourceType != "code_literal" {
					t.Fatal(entries)
				}
			} else if len(entries) != 0 {
				t.Fatal(entries)
			}
		})
	}
	// Every quoted form equals an existing whole name; neither a substring nor
	// a similarly named property may manufacture a registry entry.
	for _, source := range []string{`const key = "sort_set_default";`, `const key = 'sort_set_default';`, "const key = `sort_set_default`;", `const key = ok ? "sort_set_default" : "unknown_key";`, `const key = "sort_set_\u0064efault";`, `const expression = /['"]/g; const key = "sort_set_default";`, "const key = `${t(\"sort_set_default\")}`;"} {
		entries := resolvedCodeInFile("app/frontend/ordinary.js", source, registry)
		if len(entries) != 1 || entries[0].langKey != "sort_set_default" || entries[0].sourceType != "code_literal" {
			t.Fatal(source, entries)
		}
	}
}

func TestB3TestOnlyLiteralIsNotScanned(t *testing.T) {
	scanTrustFixture(t)
	paths := currentLangKeyRuntimePaths()
	for _, name := range []string{"frontend/only.test.js", "frontend/only.test.ts", "frontend/only.spec.js", "frontend/only.spec.ts", "backend/only_test.go", "frontend/testing/only.js", "frontend/e2e/only.js", "components/probe/testing/only.go", "components/probe/e2e/only.html"} {
		path := filepath.Join(paths.ApplicationRoot, name)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(`const key = "test_only_literal";`), 0600); err != nil {
			t.Fatal(err)
		}
	}
	live := filepath.Join(paths.ApplicationRoot, "frontend", "live.js")
	if err := os.WriteFile(live, []byte(`const key = "sort_set_default";`), 0600); err != nil {
		t.Fatal(err)
	}
	candidates, err := scanCodebaseForLangKeySources()
	if err != nil {
		t.Fatal(err)
	}
	entries := resolveLangKeyCodeSources(candidates, map[string]int64{"test_only_literal": 1, "sort_set_default": 2})
	if len(entries) != 1 || entries[0].langKey != "sort_set_default" || entries[0].sourceType != "code_literal" {
		t.Fatal(entries)
	}
}

func hasDefiniteCode(entries []sourceEntry) bool {
	for _, entry := range entries {
		if entry.sourceType == "" {
			return true
		}
	}
	return false
}

func TestB3LiteralInRealProducerAndGroupedGoConstants(t *testing.T) {
	path := "frontend/core_components/admin_tools/front_page_article_buttons_copy.js"
	data, err := os.ReadFile(filepath.Join("../../..", path))
	if err != nil {
		t.Fatal(err)
	}
	entries := resolvedCodeInFile("app/"+path, string(data), map[string]int64{"front_page_save_conflict": 1})
	if len(entries) != 1 || entries[0].sourceType != "code_literal" {
		t.Fatal(entries)
	}
	for _, source := range []string{`const exampleKey = "site_front_page_title"`, `const exampleKey string = "site_front_page_title"`, "const (\nexampleKey = `site_front_page_title`\n)", "const (\nsize = len(\"hello\")\nexampleKey string = \"site_front_page_title\"\n)"} {
		entries := resolvedCodeInFile("app/backend/example.go", source, map[string]int64{"site_front_page_title": 1})
		if !hasDefiniteCode(entries) {
			t.Fatal(source, entries)
		}
	}
	entries = resolvedCodeInFile("app/backend/example.go", `var exampleKey = "site_front_page_title"`, map[string]int64{"site_front_page_title": 1})
	if hasDefiniteCode(entries) {
		t.Fatal("ordinary variable treated as const", entries)
	}
}
