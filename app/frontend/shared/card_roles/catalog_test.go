package card_roles

import (
	"strings"
	"testing"
)

func TestCatalogRetainsSupportedRoleGrammar(t *testing.T) {
	for _, value := range []string{"", "details", "header", "image", "description", "\tdescription",
		"description1", "description2", "details1000", "details1100", "details_link10",
		"hidden2", "keywords", "username", "creation_spec", "header+lang_key",
		"description1+lang-key", "image, header+lang_key"} {
		if !IsValid(value) {
			t.Errorf("supported role rejected: %q", value)
		}
	}
	for _, value := range []string{"title", "details_bad", "header2", "image2", "description-1",
		"header+script", "header+lang_key+extra", ",header", "header,", "details; DROP TABLE x"} {
		if IsValid(value) {
			t.Errorf("invalid role accepted: %q", value)
		}
	}
}

func TestCatalogDecoderAcceptsOnlyJSONDataExport(t *testing.T) {
	if _, err := decodeCatalog(catalogJSON); err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"export default {}; evil();",
		"export default Object.freeze({});",
		"export default {}; export const injected = true;",
		"export default { roles: [] };",
		"export default [];",
		"export default " + strings.TrimSpace(string(catalogJSON)),
		"// no export",
	} {
		if _, err := decodeCatalog([]byte(source)); err == nil {
			t.Errorf("non-catalog JavaScript accepted: %q", source)
		}
	}
}

func TestCatalogKeepsLabelPolicyInDatabaseResolver(t *testing.T) {
	if strings.Contains(string(catalogJSON), "initial_show_key") {
		t.Fatal("role catalog must not duplicate or materialize database label defaults")
	}
}
