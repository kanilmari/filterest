// article_baseline_postgres_test.go
// Proves the K388 before-list against limited readers and disposable databases.
// Connects actual SQL precedence, widths, blocks, guests and both IFAV source paths.
// Checks deterministic output and database isolation without touching installation data.
package dtt_1_row_read

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
	"testing"
)

func TestArticleBaselinePostgres(t *testing.T) {
	reader, other := articleBaselinePostgres(t)
	report, err := ReadArticlePresentationBaseline(context.Background(), reader)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Datasets) != 3 || len(report.Users) != 5 || len(report.Groups) != 5 {
		t.Fatalf("incomplete snapshot: %+v", report)
	}
	article := report.Datasets[0]
	target := func(kind string, id int64) ArticleBaselineTarget {
		t.Helper()
		for _, target := range article.Targets {
			if target.Kind == kind && (target.ID == nil && id == 0 || target.ID != nil && *target.ID == id) {
				return target
			}
		}
		t.Fatalf("missing %s %d", kind, id)
		return ArticleBaselineTarget{}
	}
	ids := func(fields []ArticleBaselineField) []int64 {
		t.Helper()
		ids := []int64{}
		for _, f := range fields {
			if f.UID == nil {
				t.Fatal("missing field UID")
			}
			ids = append(ids, *f.UID)
		}
		return ids
	}
	site := target("site", 0)
	if !reflect.DeepEqual(ids(site.Article.Fields), []int64{102, 103}) {
		t.Fatal(site.Article)
	}
	if site.Article.Fields[0].StoredWidth != nil || site.Article.Fields[1].StoredWidth == nil || *site.Article.Fields[1].StoredWidth != 0 {
		t.Fatal("NULL and explicit zero widths conflated")
	}
	if *target("group", 11).Article.Source.FieldSetID != 101 || *target("personal", 2).Article.Source.FieldSetID != 104 {
		t.Fatal("target resolution")
	}
	for _, test := range []struct{ user, set int64 }{{1, 100}, {2, 104}, {3, 102}, {4, 103}, {5, 100}} {
		got := article.Readers[test.user-1]
		if got.Article.Source.FieldSetID == nil || *got.Article.Source.FieldSetID != test.set {
			t.Fatalf("reader %d source %+v", test.user, got.Article.Source)
		}
	}
	if !article.Blocks["classic"].Present || article.Blocks["classic"].InitialOpen["details"] || !article.Blocks["classic"].InitialOpen["images"] || article.Blocks["image_first"].InitialOpen["details"] {
		t.Fatal("explicit and absent blocks")
	}
	if !site.IFAV.SourceDependent || !site.IFAV.DifferentFromArticle || !reflect.DeepEqual(ids(site.IFAV.ConfiguredProjection.Fields), []int64{105}) {
		t.Fatal("IFAV discrepancy hidden")
	}
	var card, restore []int64
	for _, source := range site.IFAV.OpeningSources {
		if source.Path == "supplied_row" && source.ViewKey == "card" {
			card = ids(source.Fields)
		}
		if source.Path == "history_restore" {
			restore = ids(source.Fields)
		}
	}
	if !reflect.DeepEqual(card, []int64{104, 102}) || !reflect.DeepEqual(restore, []int64{103, 102}) {
		t.Fatalf("IFAV sources card=%v restore=%v", card, restore)
	}
	audience := article.Audience
	if !reflect.DeepEqual(audience.GroupIDs, []int64{2, 10}) || !reflect.DeepEqual(audience.TablelessGroupIDs, []int64{2}) || !reflect.DeepEqual(audience.AccessControlGroupIDs, []int64{2, 11}) || !reflect.DeepEqual(audience.DatasetScopedGroupIDs, []int64{10}) {
		t.Fatalf("audience=%+v", audience)
	}
	if !audience.GuestAllowed || !article.Readers[0].ArticleRouteAllowed || article.Readers[0].ArticleRouteTablelessAllowed {
		t.Fatal("guest bootstrap must use named guests, not account memberships")
	}
	if !article.Readers[1].ArticleRouteAllowed || article.Readers[1].ArticleRouteTablelessAllowed || !article.Readers[1].ArticleRouteAccessControlAllowed {
		t.Fatal("authenticated scoped grants and NULL-disabled route distinction")
	}
	metadata := report.Datasets[1]
	if !reflect.DeepEqual(ids(metadata.Targets[1].Article.Fields), []int64{203, 204, 201, 202}) || metadata.Blocks["classic"].Present || !metadata.Blocks["classic"].InitialOpen["details"] {
		t.Fatal("metadata fallback", metadata.Targets[1].Article)
	}
	for _, source := range metadata.Targets[1].IFAV.OpeningSources {
		if source.Path == "supplied_row" && source.ViewKey == "card" && !reflect.DeepEqual(ids(source.Fields), []int64{203, 201, 202}) {
			t.Fatal("metadata card source must retain hide-on-small-card filtering", source.Fields)
		}
	}
	gap := report.Datasets[2]
	if len(gap.Targets[1].Article.Fields) != 2 || gap.Targets[1].Article.Fields[0].UID != nil || gap.BlockReadError == nil {
		t.Fatal("information schema or invalid block evidence hidden")
	}
	var first, second bytes.Buffer
	if err := WriteArticlePresentationBaseline(&first, report); err != nil {
		t.Fatal(err)
	}
	again, err := ReadArticlePresentationBaseline(context.Background(), reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := WriteArticlePresentationBaseline(&second, again); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first.Bytes(), second.Bytes()) {
		t.Fatal("report is nondeterministic")
	}
	changed, err := ReadArticlePresentationBaseline(context.Background(), other)
	if err != nil {
		t.Fatal(err)
	}
	if changed.Datasets[0].Readers[1].Article.Fields[0].Width != 444 || report.Datasets[0].Readers[1].Article.Fields[0].Width != 0 {
		t.Fatal("cached state crossed databases")
	}
	// A role with only SELECT can produce the report. PostgreSQL itself also
	// refuses a write inside the same transaction mode used by the exporter.
	tx, err := other.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE system_users SET id=id`); err == nil {
		t.Fatal("PostgreSQL read-only transaction accepted a write")
	}
	var decoded map[string]any
	if err := json.Unmarshal(first.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	if _, present := decoded["datasets"]; !present {
		t.Fatal("missing datasets")
	}
}
