// lang_key_ui_evidence.go
// Qualifies the finite B4 catalogues reviewed as public interface copy.
// Connects declarations and the scan fingerprint to one explicit allowlist.
// Object names, schema aliases and naming families never acquire UI authority.
package system_table_tools

import (
	"slices"
	"strings"

	"easelect/backend/core_components/lang_key_naming"
)

const uiLiteralScanner = "ui_literal_v1"

// Changing this list requires review: both owners contain fixed UI messages,
// not dataset/column/folder names. Match the entire declaration so additions
// cannot acquire authority without updating the reviewed fingerprint inputs.
var uiLiteralCatalogues = []lang_key_naming.Declaration{
	{Owner: "app/frontend/reusable_components/media_library_picker/media_library_picker.js", Build: "`media_library_${key}`", Keys: []string{
		"media_library_choose", "media_library_close", "media_library_clear", "media_library_next", "media_library_loading", "media_library_scope", "media_library_unavailable", "media_library_empty", "media_library_selected",
	}},
	{Owner: "app/frontend/core_components/admin_tools/dataset_alias_management_copy.js", Build: "`dataset_alias_editor_${key}`", Keys: []string{
		"dataset_namespace_conflict", "dataset_namespace_invalid", "dataset_namespace_retry", "dataset_namespace_real_name_conflict", "dataset_namespace_automatic_conflict", "dataset_namespace_alias_conflict", "dataset_alias_saved", "dataset_alias_cleared",
	}},
}

func reviewedUILiteralCatalogue(d lang_key_naming.Declaration) bool {
	if d.Schema != "" || d.Prefix != "" || d.Suffix != "" || len(d.Values) != 0 || len(d.Keys) == 0 {
		return false
	}
	for _, reviewed := range uiLiteralCatalogues {
		if strings.TrimPrefix(d.Owner, "./") == reviewed.Owner && d.Build == reviewed.Build && slices.Equal(d.Keys, reviewed.Keys) {
			return true
		}
	}
	return false
}
