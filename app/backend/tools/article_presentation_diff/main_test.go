// main_test.go
// Proves file-only CLI outputs and exact check exit statuses end to end.
// Connects small report fixtures to owner artifacts and approved evidence.
// Malformed input and private evidence never enter human diagnostics.
package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	report "easelect/backend/reusable_components/article_presentation_report"
)

func TestDiffCommandApprovalExitCodes(t *testing.T) {
	dir := t.TempDir()
	beforePath, afterPath, prefix := filepath.Join(dir, "before.json"), filepath.Join(dir, "after.json"), filepath.Join(dir, "approved")
	fields := []report.ArticleBaselineField{{UID: commandPtr(int64(1)), Name: "never-print-this-field"}}
	p := report.ArticleBaselineProjection{Source: report.ArticleBaselineSource{Kind: "metadata"}, Fields: fields}
	ifav := report.ArticleBaselineIFAV{SourceDependent: true, ConfiguredProjection: p, OpeningSources: []report.ArticleBaselineOpening{}}
	before := report.ArticleBaselineReport{Phase: "before", FormatVersion: 2, ContractVersion: 1, Limitations: []string{}, Groups: []report.ArticleBaselineGroup{}, Users: []report.ArticleBaselineUser{}, Datasets: []report.ArticleBaselineDataset{{UID: 10, Name: "Articles", Schema: "public", StoredBlocks: json.RawMessage(`{}`), Blocks: map[string]report.ArticleBaselineBlocks{}, Targets: []report.ArticleBaselineTarget{{Kind: "metadata", Article: p, IFAV: ifav, Page: p}, {Kind: "site", Article: p, IFAV: ifav, Page: p}}, Readers: []report.ArticleBaselineReader{}, Audience: report.ArticleBaselineAudience{Route: "/ui/view/article_view", GroupIDs: []int64{}, TablelessGroupIDs: []int64{}, AccessControlGroupIDs: []int64{}, DatasetScopedGroupIDs: []int64{}, Grants: []report.ArticleBaselineGrant{}}}}}
	write := func(path string, v any) {
		t.Helper()
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(beforePath, before)
	raw, _ := json.Marshal(before)
	var after report.ArticleBaselineReport
	_ = json.Unmarshal(raw, &after)
	after.Phase = "after"
	after.Datasets[0].Targets[1].Article.Fields[0].Width = 20
	write(afterPath, after)
	invoke := func(want int, args ...string) {
		t.Helper()
		var out, diag bytes.Buffer
		if got := run(args, &out, &diag); got != want {
			t.Fatalf("exit %d want %d: %s", got, want, diag.String())
		}
		if strings.Contains(out.String()+diag.String(), "never-print-this-field") {
			t.Fatal("field leaked")
		}
	}
	base := []string{"--before", beforePath, "--after", afterPath}
	invoke(0, append(base, "--out", prefix)...)
	for _, suffix := range []string{".md", ".csv", ".json"} {
		info, err := os.Stat(prefix + suffix)
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal("protected artifact not written", suffix, err)
		}
	}
	check := append(base, "--check", prefix+".json")
	invoke(0, check...)
	after.Datasets[0].Targets[1].Article.Fields[0].Width = 21
	write(afterPath, after)
	invoke(1, check...)
	after.Datasets[0].Targets[1].Article.Fields[0].Width = 0
	write(afterPath, after)
	invoke(1, check...)
	after.Datasets[0].Targets[1].Article.Fields[0].Width = 20
	after.Datasets[0].Targets[1].Page.Fields[0].Width = 40
	write(afterPath, after)
	invoke(1, check...)
	if err := os.WriteFile(afterPath, []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	invoke(2, check...)
	invoke(2, "--dsn=private-input")
}
func commandPtr[T any](v T) *T { return &v }
