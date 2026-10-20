// article_presentations_test.go
// Validates complete ordered article writes and exact target/scope boundaries.
// Connects HTTP cell decoding and transaction inputs without a database dependency.
package system_table_tools

import (
	"encoding/json"
	"reflect"
	"testing"
)

func articleUnitSnapshot(scope string) articleSnapshot {
	s := articleSnapshot{Dataset: "e2e_articles", DatasetUID: 10, Family: "article", Fields: []articleField{{1, "title", true}}, Revisions: map[string]string{"fields": "f", "blocks": "b"}, Blocks: map[string]map[string]bool{}}
	principal := articlePrincipal{Scope: scope}
	if scope == "group" {
		principal.GroupID = 8
	}
	if scope == "personal" {
		principal.UserID = 42
	}
	target := articleTarget{articlePrincipal: principal, Members: []articleMember{{UID: 1, Values: map[string]articleCell{}}}}
	for _, key := range articlePresentationKeys {
		target.Members[0].Values[key] = articleCell{}
		target.Assignments = append(target.Assignments, articleLink{key, 20, "Article", 0})
		s.Blocks[key] = map[string]bool{}
		for _, block := range articleSupportedSections(key) {
			s.Blocks[key][block] = true
		}
	}
	s.Targets = []articleTarget{target}
	s.Revisions[principal.key()] = "t"
	return s
}
func copyArticleSnapshot(s articleSnapshot) articleSnapshot {
	raw, _ := json.Marshal(s)
	var result articleSnapshot
	_ = json.Unmarshal(raw, &result)
	return result
}
func TestArticlePresentationsValidateCompleteScopes(t *testing.T) {
	for _, scope := range []string{"site", "group", "personal"} {
		t.Run(scope, func(t *testing.T) {
			baseline := articleUnitSnapshot(scope)
			input := copyArticleSnapshot(baseline)
			if scope != "site" {
				input.Blocks = nil
			}
			if err := validArticlePrincipals(input.Targets); err != nil {
				t.Fatal(err)
			}
			if err := validateArticleWrite(input, baseline); err != nil {
				t.Fatal("zero visible fields must be allowed", err)
			}
		})
	}
}

func TestArticlePresentationsValidateTargetBundleMembership(t *testing.T) {
	// Materialized bundles retain their own legacy field selections: the
	// catalogue has [1,2,3,6], but these groups hold [2,1] and [1].
	baseline := articleUnitSnapshot("group")
	baseline.Blocks = nil
	baseline.Fields = []articleField{{1, "title", true}, {2, "body", true}, {3, "image", true}, {6, "restricted", false}}
	body := copyArticleSnapshot(baseline).Targets[0].Members[0]
	body.UID = 2
	width := 280
	body.Values["article_view"] = articleCell{Visible: true, Width: &width}
	baseline.Targets[0].Members = append([]articleMember{body}, baseline.Targets[0].Members...)
	other := copyArticleSnapshot(baseline).Targets[0]
	other.GroupID = 9
	other.Members = other.Members[1:]
	for i := range other.Assignments {
		other.Assignments[i].FieldSetID = 21
		other.Assignments[i].Priority = 7
	}
	baseline.Targets = append(baseline.Targets, other)

	for _, kind := range []string{"complete", "reordered", "missing", "other-bundle-member", "foreign", "duplicate", "extra", "restricted-member", "restricted-visible", "new-member", "missing-new-member"} {
		t.Run(kind, func(t *testing.T) {
			current := copyArticleSnapshot(baseline)
			if kind == "restricted-member" || kind == "restricted-visible" || kind == "new-member" || kind == "missing-new-member" {
				member := copyArticleSnapshot(baseline).Targets[0].Members[1]
				member.UID = 6
				if kind == "new-member" || kind == "missing-new-member" {
					member.UID = 7
					current.Fields = append(current.Fields, articleField{7, "added_after_bundle", true})
				}
				// Field creation adds a member; restriction clears visibility,
				// retaining the member's order and widths.
				current.Targets[0].Members = append(current.Targets[0].Members, member)
			}
			input := copyArticleSnapshot(current)
			accepted := false
			switch kind {
			case "complete", "restricted-member", "new-member":
				accepted = true
			case "reordered":
				input.Targets[0].Members[0], input.Targets[0].Members[1] = input.Targets[0].Members[1], input.Targets[0].Members[0]
				accepted = true
			case "missing":
				input.Targets[1].Members = nil
			case "other-bundle-member":
				input.Targets[1].Members[0].UID = 2
			case "foreign":
				input.Targets[0].Members[0].UID = 99
			case "duplicate":
				input.Targets[0].Members[0].UID = 1
			case "extra":
				member := copyArticleSnapshot(baseline).Targets[0].Members[1]
				member.UID = 6
				input.Targets[0].Members = append(input.Targets[0].Members, member)
			case "restricted-visible":
				input.Targets[0].Members[2].Values["article_view"] = articleCell{Visible: true}
			case "missing-new-member":
				input.Targets[0].Members = input.Targets[0].Members[:2]
			}
			before := copyArticleSnapshot(input)
			if err := validateArticleWrite(input, current); (err == nil) != accepted {
				t.Fatalf("accepted=%v, want %v: %v", err == nil, accepted, err)
			}
			if !reflect.DeepEqual(input, before) {
				t.Fatal("validation changed member orders, widths or assignment priorities")
			}
		})
	}
}

func TestArticlePresentationsRefuseIncompleteOrForbiddenWrites(t *testing.T) {
	for _, kind := range []string{"missing-field", "duplicate", "forbidden", "missing-view", "width", "links", "priority", "blocks", "dataset"} {
		t.Run(kind, func(t *testing.T) {
			baseline := articleUnitSnapshot("site")
			input := copyArticleSnapshot(baseline)
			switch kind {
			case "missing-field":
				input.Targets[0].Members = nil
			case "duplicate":
				input.Targets[0].Members = append(input.Targets[0].Members, input.Targets[0].Members[0])
			case "forbidden":
				baseline.Fields[0].Editable = false
				input.Targets[0].Members[0].Values["article_view"] = articleCell{Visible: true}
			case "missing-view":
				delete(input.Targets[0].Members[0].Values, "image_first_page_view")
			case "width":
				width := -1
				input.Targets[0].Members[0].Values["article_view"] = articleCell{Width: &width}
			case "links":
				input.Targets[0].Assignments[1].FieldSetID++
			case "priority":
				input.Targets[0].Assignments[0].Priority = 5
			case "blocks":
				input.Blocks["image_first_view"]["images"] = true
			case "dataset":
				input.DatasetUID++
			}
			if validateArticleWrite(input, baseline) == nil {
				t.Fatal("accepted", kind)
			}
		})
	}
	baseline := articleUnitSnapshot("group")
	if validateArticleWrite(baseline, baseline) == nil {
		t.Fatal("group must not carry blocks")
	}
}
func TestArticlePresentationsStrictBooleanAndWidth(t *testing.T) {
	for _, raw := range []string{`{"visible":null,"width_px":null}`, `{"visible":true}`, `{"visible":"mixed","width_px":null}`, `{"visible":true,"width_px":null,"all":true}`} {
		var cell articleCell
		if json.Unmarshal([]byte(raw), &cell) == nil {
			t.Fatal("accepted", raw)
		}
	}
	var cell articleCell
	if err := json.Unmarshal([]byte(`{"visible":false,"width_px":0}`), &cell); err != nil || cell.Width == nil || *cell.Width != 0 {
		t.Fatal(cell, err)
	}
}
func TestArticlePresentationsRefuseAmbiguousTargets(t *testing.T) {
	for _, targets := range [][]articleTarget{nil, {{articlePrincipal: articlePrincipal{Scope: "site", GroupID: 8}}}, {{articlePrincipal: articlePrincipal{Scope: "personal", UserID: 1}}}, {{articlePrincipal: articlePrincipal{Scope: "group", GroupID: 8}}, {articlePrincipal: articlePrincipal{Scope: "site"}}}} {
		if validArticlePrincipals(targets) == nil {
			t.Fatal("accepted", targets)
		}
	}
}

func TestArticlePresentationsAssignmentMetadataIsExplicit(t *testing.T) {
	for _, raw := range []string{
		`{"view_key":"article_view","field_set_id":20,"name":"Reviewed"}`,
		`{"view_key":"article_view","field_set_id":20,"name":"Reviewed","priority":null}`,
		`{"view_key":"article_view","field_set_id":20,"name":"Reviewed","priority":2,"all":true}`,
	} {
		var link articleLink
		if json.Unmarshal([]byte(raw), &link) == nil {
			t.Fatal("accepted incomplete assignment", raw)
		}
	}
}

func TestArticlePresentationsBlocksRequireRealBooleans(t *testing.T) {
	for _, raw := range []string{`null`, `{"article_view":{"details":null}}`, `{"article_view":{"details":"mixed"}}`, `{"image_first_view":{"images":true}}`} {
		var blocks articleBlocks
		if json.Unmarshal([]byte(raw), &blocks) == nil {
			t.Fatal("accepted invalid opening blocks", raw)
		}
	}
	var blocks articleBlocks
	if err := json.Unmarshal([]byte(`{"article_view":{"details":false}}`), &blocks); err != nil || blocks["article_view"]["details"] {
		t.Fatal(blocks, err)
	}
}
