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

func TestInitialLabelDefaultsForExplicitNewRoles(t *testing.T) {
	for _, role := range []string{"details", "details10", "details_link10"} {
		value, set := InitialShowKey(role)
		if !set || !value {
			t.Errorf("additional-information labels should be visible: %q", role)
		}
	}
	for _, role := range []string{"header", "description1", "keywords", "details, header+lang_key"} {
		value, set := InitialShowKey(role)
		if !set || value {
			t.Errorf("primary labels should be hidden: %q", role)
		}
	}
	for _, role := range []string{"", "image", "username", "creation_spec", "hidden"} {
		_, set := InitialShowKey(role)
		if set {
			t.Errorf("other roles must preserve existing default: %q", role)
		}
	}
}
