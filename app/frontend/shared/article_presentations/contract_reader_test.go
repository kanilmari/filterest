// contract_reader_test.go
// Validates shared keys, role defaults and defensive copies of the contract.
// Connects browser-owned JSON with Go readers without generating another authority.
// Makes the reserved route's inactive state explicit.
package article_presentations

import "testing"

func TestContractVocabulary(t *testing.T) {
	c := Read()
	if c.Version != 1 || len(c.Presentations) != 3 || len(c.Aliases) != 3 || len(c.OpenerDefaults) != 15 {
		t.Fatal("unexpected contract vocabulary")
	}
	for _, alias := range []string{"article", "big_card", "row_article"} {
		if c.Aliases[alias] != "article_view" {
			t.Fatalf("alias drift: %s", alias)
		}
	}
	for role, key := range c.OpenerDefaults {
		expected := "article_view"
		if role == "card-image" || role == "article-image" || role == "gallery-thumbnail" {
			expected = "image_first_view"
		}
		if key != expected {
			t.Fatalf("role default drift: %s", role)
		}
	}
	for key, p := range c.Presentations {
		if p.PermissionRoute != "/ui/view/"+key {
			t.Fatalf("route drift: %s", key)
		}
		if p.Reserved != (key == "image_first_page_view") {
			t.Fatal("reservation drift")
		}
		if p.Reserved && (p.CurrentPermissionRoute != nil || p.LegacySectionKey != nil) {
			t.Fatal("reserved view activated")
		}
		if !p.Reserved && (p.CurrentPermissionRoute == nil || *p.CurrentPermissionRoute != "/ui/view/article_view") {
			t.Fatal("compatibility gate drift")
		}
		for _, block := range p.Blocks {
			found := false
			for _, registered := range c.Blocks {
				found = found || block == registered
			}
			if !found {
				t.Fatalf("unregistered block: %s", block)
			}
		}
	}
	c.Blocks[0] = "mutated"
	delete(c.Presentations, "article_view")
	if Read().Blocks[0] != "details" || len(Read().Presentations) != 3 {
		t.Fatal("shared mutable state")
	}
}
