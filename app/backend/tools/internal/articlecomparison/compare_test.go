// compare_test.go
// Exercises semantic diffs and exact approvals using small content-free fixtures.
// Connects every owner flag to an independent saved-settings change.
// Checks privacy, deterministic ordering and malformed-input refusal offline.
package articlecomparison

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	report "easelect/backend/reusable_components/article_presentation_report"
)

func fixturePair(t *testing.T) (Report, Report) {
	t.Helper()
	fields := []report.ArticleBaselineField{{UID: ptr(int64(101)), Name: "field_A", Role: "header"}, {UID: ptr(int64(102)), Name: "field_B", Role: "details"}}
	p := Projection{Source: report.ArticleBaselineSource{Kind: "metadata"}, Fields: fields}
	ifav := report.ArticleBaselineIFAV{SourceDependent: true, ConfiguredProjection: p, OpeningSources: []report.ArticleBaselineOpening{}}
	r := Report{Phase: "before", FormatVersion: 2, ContractVersion: 1, Limitations: []string{}, Groups: []report.ArticleBaselineGroup{{ID: 8, Name: "Editors"}}, Users: []report.ArticleBaselineUser{}, Datasets: []Dataset{{UID: 10, Name: "Articles", Schema: "public", StoredBlocks: json.RawMessage(`{}`), Blocks: map[string]report.ArticleBaselineBlocks{}, Targets: []Target{{Kind: "metadata", Article: p, IFAV: ifav, Page: p}, {Kind: "site", Article: p, IFAV: ifav, Page: p}}, Readers: []report.ArticleBaselineReader{}, Audience: report.ArticleBaselineAudience{Route: "/ui/view/article_view", GuestUserID: 1, GroupIDs: []int64{}, TablelessGroupIDs: []int64{}, AccessControlGroupIDs: []int64{}, DatasetScopedGroupIDs: []int64{}, Grants: []report.ArticleBaselineGrant{}}}}}
	b := clone(r)
	a := clone(r)
	a.Phase = "after"
	return b, a
}
func clone(r Report) Report {
	raw, _ := json.Marshal(r)
	var result Report
	_ = json.Unmarshal(raw, &result)
	return result
}
func ptr[T any](v T) *T { return &v }
func mustCompare(t *testing.T, b, a Report) Approval {
	t.Helper()
	r, err := Compare(b, a)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestNoDifferenceAndCanonicalOrder(t *testing.T) {
	b, a := fixturePair(t)
	a.Datasets[0].Targets[0], a.Datasets[0].Targets[1] = a.Datasets[0].Targets[1], a.Datasets[0].Targets[0]
	r := mustCompare(t, b, a)
	if len(r.Differences) != 0 || r.Unchanged != 6 {
		t.Fatal(r)
	}
	again := mustCompare(t, b, a)
	if !reflect.DeepEqual(r, again) {
		t.Fatal("unstable digest")
	}
}
func TestProjectionDifferences(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*Dataset)
		check  func(Difference) bool
	}{
		{"order", func(d *Dataset) { p := &d.Targets[1].Article; p.Fields[0], p.Fields[1] = p.Fields[1], p.Fields[0] }, func(d Difference) bool { return d.Order && !d.Widths && d.Added == 0 }},
		{"width", func(d *Dataset) { d.Targets[1].Article.Fields[0].Width = 90 }, func(d Difference) bool { return d.Widths && !d.Order }},
		{"null versus zero width", func(d *Dataset) { d.Targets[1].Article.Fields[0].StoredWidth = ptr(0) }, func(d Difference) bool { return d.Widths }},
		{"add remove", func(d *Dataset) {
			d.Targets[1].Article.Fields = d.Targets[1].Article.Fields[1:]
			d.Targets[1].Article.Fields = append(d.Targets[1].Article.Fields, report.ArticleBaselineField{UID: ptr(int64(103)), Name: "field_C"})
		}, func(d Difference) bool { return d.Added == 1 && d.Removed == 1 }},
		{"role", func(d *Dataset) { d.Targets[1].Article.Fields[0].Role = "description" }, func(d Difference) bool { return d.Other }},
		{"row flags", func(d *Dataset) { d.Targets[1].Article.Fields[0].HideUnlessOwn = true }, func(d Difference) bool { return d.Other }},
		{"page", func(d *Dataset) { d.Targets[1].Page.Fields = d.Targets[1].Page.Fields[:1] }, func(d Difference) bool { return d.Presentation == "image_first_page_view" && d.Removed == 1 }},
		{"blocks", func(d *Dataset) { d.StoredBlocks = json.RawMessage(`{"classic":{"details":false}}`) }, func(d Difference) bool { return d.Blocks }},
		{"audience", func(d *Dataset) { d.Audience.GuestAllowed = true }, func(d Difference) bool { return d.Audience }},
		{"scope grant", func(d *Dataset) {
			d.Audience.Grants = append(d.Audience.Grants, report.ArticleBaselineGrant{FunctionID: 9, GroupID: 8, Schema: ptr("public"), DatasetUID: ptr(int64(10)), Disabled: ptr(false)})
		}, func(d Difference) bool { return d.Audience }},
		{"opener policy", func(d *Dataset) { d.OpenerPolicy = json.RawMessage(`{"card-body":"article_view"}`) }, func(d Difference) bool { return d.Other }},
		{"IFAV opener fields", func(d *Dataset) {
			d.Targets[1].IFAV.OpeningSources = []report.ArticleBaselineOpening{{Path: "supplied_row", ViewKey: "card", Source: report.ArticleBaselineSource{Kind: "site"}, Fields: []report.ArticleBaselineField{}}}
		}, func(d Difference) bool { return d.Other }},
	} {
		t.Run(test.name, func(t *testing.T) {
			b, a := fixturePair(t)
			test.mutate(&a.Datasets[0])
			r := mustCompare(t, b, a)
			if len(r.Differences) == 0 {
				t.Fatal("difference lost")
			}
			for _, d := range r.Differences {
				if !test.check(d) {
					t.Fatalf("wrong flags: %+v", d)
				}
			}
		})
	}
}
func TestBookkeepingExclusionsAndRawCanonicalization(t *testing.T) {
	b, a := fixturePair(t)
	b.Datasets[0].StoredBlocks = json.RawMessage(`{"classic":{},"image_first":{}}`)
	a.Datasets[0].StoredBlocks = json.RawMessage(`{ "image_first": {}, "classic": {} }`)
	a.Datasets[0].Targets[1].Article.Source.AssignmentID = ptr(int64(999))
	a.Datasets[0].Targets[1].Article.Source.FieldSetID = ptr(int64(888))
	a.Scope = "different report explanation"
	a.Limitations = []string{"different wording"}
	if r := mustCompare(t, b, a); len(r.Differences) != 0 {
		t.Fatal("bookkeeping reported as presentation", r)
	}
}
func addReaders(r *Report) {
	d := &r.Datasets[0]
	p, i, page := d.Targets[1].Article, d.Targets[1].IFAV, d.Targets[1].Page
	for _, id := range []int64{900001, 900002} {
		r.Users = append(r.Users, report.ArticleBaselineUser{ID: id, GroupIDs: []int64{8}})
		d.Readers = append(d.Readers, report.ArticleBaselineReader{UserID: id, Article: p, IFAV: i, Page: page})
	}
}
func TestPersonalAggregationPrivacyAndReaderEvidence(t *testing.T) {
	b, a := fixturePair(t)
	addReaders(&b)
	addReaders(&a)
	// Copy through JSON so changing one reader cannot mutate a sibling's fields.
	b = clone(b)
	a = clone(a)
	for i := range a.Datasets[0].Readers {
		a.Datasets[0].Readers[i].Article.Fields = a.Datasets[0].Readers[i].Article.Fields[:1]
	}
	r := mustCompare(t, b, a)
	if len(r.Differences) != 2 {
		t.Fatal(r)
	}
	rows := OwnerRows(r.Differences)
	if len(rows) != 1 || rows[0].Targets != 2 || rows[0].Before != 4 || rows[0].After != 2 || rows[0].Removed != 2 {
		t.Fatal(rows)
	}
	var md, csv bytes.Buffer
	if err := WriteMarkdown(&md, rows, r.Unchanged, r.SHA256); err != nil {
		t.Fatal(err)
	}
	if err := WriteCSV(&csv, rows, r.Unchanged, r.SHA256); err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"900001", "900002", "field_A", "field_B", "user_id", "target_id"} {
		if strings.Contains(md.String(), forbidden) || strings.Contains(csv.String(), forbidden) {
			t.Fatal("private evidence leaked", forbidden)
		}
	}
	a = clone(b)
	a.Phase = "after"
	a.Datasets[0].Readers[0].ArticleRouteAllowed = true
	for _, d := range mustCompare(t, b, a).Differences {
		if d.TargetKind != "personal" || !d.Audience {
			t.Fatal("reader rights unaccounted", d)
		}
	}
}
func TestApprovalCheckEqualUnlistedMissingAndSameFlags(t *testing.T) {
	b, a := fixturePair(t)
	a.Datasets[0].Targets[1].Article.Fields[0].Width = 20
	approved := mustCompare(t, b, a)
	equal, err := Check(approved, approved)
	if err != nil || !equal.Equal {
		t.Fatal(equal, err)
	}
	raw, _ := json.Marshal(approved)
	if _, err := ReadApproval(bytes.NewReader(raw)); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name              string
		change            func(*Report)
		unlisted, missing int
	}{
		{"unlisted", func(a *Report) { a.Datasets[0].Targets[1].Page.Fields[0].Width = 30 }, 1, 0},
		{"missing", func(a *Report) { a.Datasets[0].Targets[1].Article.Fields[0].Width = 0 }, 0, 1},
		{"same flags different width", func(a *Report) { a.Datasets[0].Targets[1].Article.Fields[0].Width = 21 }, 1, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			current := clone(a)
			test.change(&current)
			result, err := Check(mustCompare(t, b, current), approved)
			if err != nil || result.Equal || len(result.Unlisted) != test.unlisted || len(result.Missing) != test.missing {
				t.Fatal(result, err)
			}
		})
	}
	approved.SHA256 = strings.Repeat("0", 64)
	if _, err := Check(mustCompare(t, b, a), approved); err == nil {
		t.Fatal("tampered digest accepted")
	}
}
func TestMalformedInput(t *testing.T) {
	b, _ := fixturePair(t)
	raw, _ := json.Marshal(b)
	for _, input := range []string{"{}", "null", string(raw) + "{}", strings.Replace(string(raw), `"format_version":2`, `"format_version":99`, 1), strings.Replace(string(raw), `"phase":"before"`, `"phase":"before","phase":"before"`, 1), strings.Replace(string(raw), `"scope":""`, `"unknown":""`, 1), strings.Replace(string(raw), `"datasets":[`, `"datasets":null,"ignored":[`, 1)} {
		if _, err := ReadReport(strings.NewReader(input), "before"); err == nil {
			t.Fatal("malformed evidence accepted")
		}
	}
	if _, err := ReadReport(bytes.NewReader(raw), "before"); err != nil {
		t.Fatal("valid evidence rejected", err)
	}
	b.Datasets[0].Targets[0].Article.Fields = append(b.Datasets[0].Targets[0].Article.Fields, b.Datasets[0].Targets[0].Article.Fields[0])
	if err := Validate(b, "before"); err == nil {
		t.Fatal("duplicate field accepted")
	}
}

func TestGroupNamesAndTargetInventoryParticipate(t *testing.T) {
	b, a := fixturePair(t)
	group := clone(b).Datasets[0].Targets[1]
	group.Kind = "group"
	group.ID = ptr(int64(8))
	b.Datasets[0].Targets = append(b.Datasets[0].Targets, group)
	a = clone(b)
	a.Phase = "after"
	a.Groups[0].Name = "Renamed editors"
	r := mustCompare(t, b, a)
	if len(r.Differences) != 3 {
		t.Fatal("group name ignored", r)
	}
	for _, d := range r.Differences {
		if d.TargetKind != "group" || d.Group != "Renamed editors" || !d.Other {
			t.Fatal(d)
		}
	}
	a = clone(b)
	a.Phase = "after"
	a.Datasets[0].Targets = a.Datasets[0].Targets[:2]
	if r := mustCompare(t, b, a); len(r.Differences) != 3 {
		t.Fatal("missing target ignored", r)
	}
}

func TestApprovalRejectsAnotherBaseline(t *testing.T) {
	b, a := fixturePair(t)
	approved := mustCompare(t, b, a)
	other := clone(b)
	other.Datasets[0].Targets[0].Article.Fields[0].Width = 12
	if _, err := Check(mustCompare(t, other, a), approved); err == nil {
		t.Fatal("approval accepted another baseline")
	}
}

func TestOwnerConfigurationEscaping(t *testing.T) {
	row := OwnerRow{Dataset: "=formula|<tag>\n", Kind: "group", Group: "+group", Presentation: "article_view"}
	var md, csv bytes.Buffer
	if err := WriteMarkdown(&md, []OwnerRow{row}, 0, strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	if err := WriteCSV(&csv, []OwnerRow{row}, 0, strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(md.String(), "<tag>") || !strings.Contains(md.String(), "&#124;") || !strings.Contains(csv.String(), "'=formula") || !strings.Contains(csv.String(), "'+group") {
		t.Fatal("unsafe configuration name formatting")
	}
}
