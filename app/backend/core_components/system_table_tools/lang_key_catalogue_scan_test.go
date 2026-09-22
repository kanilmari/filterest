// lang_key_catalogue_scan_test.go
// Runs the startup scan's own recognition over the modules that declare their
// language keys in a catalogue instead of beside the translation call.
// Bridges langKeyPatterns with the real frontend files those keys live in.
// Exists because a key the scan cannot see is marked an orphan while it is in
// use, so the interface silently loses copy that was authored and translated.
package system_table_tools

import (
	"os"
	"path/filepath"
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
					t.Errorf("the startup scan does not see %q in %s, so the key would be marked an orphan while it is in use", key, module.relativePath)
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
