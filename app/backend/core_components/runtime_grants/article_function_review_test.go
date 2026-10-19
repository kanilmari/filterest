// article_function_review_test.go
// Verifies article SQL reviews against the migrations and actual PostgreSQL catalogues.
// Connects nested helper fingerprints, trigger attachments and portable restoration.
// Rejects altered helpers and attachments without granting runtime table privileges.
package runtime_grants

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestArticleFunctionReviewMatchesMigrations(t *testing.T) {
	var policy map[string]struct {
		Article bool `json:"article_function"`
		Helpers []struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
			Digest    string `json:"body_md5"`
		} `json:"article_helpers"`
	}
	if err := json.Unmarshal(reviewedDefinersJSON, &policy); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, identity := range policy {
		if !identity.Article {
			continue
		}
		count++
		if len(identity.Helpers) != 20 {
			t.Fatal("incomplete article helper closure")
		}
		for _, helper := range identity.Helpers {
			_, body, _ := newestDefinerMigrationFunction(t, definerFunctionIdentity{Schema: "public", Name: helper.Name, ArgumentTypes: helper.Arguments})
			if got := fmt.Sprintf("%x", md5.Sum([]byte(body))); got != helper.Digest {
				t.Fatal("article helper changed without review", helper.Name, got)
			}
		}
	}
	if count != 6 {
		t.Fatal("article definer review incomplete", count)
	}
}

func TestArticleFunctionReviewRejectsHelperAndAttachmentChangesPostgres(t *testing.T) {
	db, _ := grantDisposableDB(t)
	root := filepath.Join("..", "..", "..")
	fixture, err := os.ReadFile(filepath.Join(root, "testing", "fixtures", "article_bundle_legacy.sql"))
	if err != nil {
		t.Fatal(err)
	}
	fixtureExec(t, db, string(fixture))
	for _, name := range []string{"20261015000010_add_article_bundle_storage.sql", "20261015000011_add_article_bundle_mutations.sql", "20261015000012_materialize_article_bundles.sql"} {
		content, err := os.ReadFile(filepath.Join(root, "server_tools", "migrations", name))
		if err != nil {
			t.Fatal(err)
		}
		fixtureExec(t, db, string(content))
	}
	check := func(want int) {
		t.Helper()
		var count int
		if err := db.QueryRow(`WITH reviewed_definer_bodies AS(SELECT key AS body_md5,value AS identity FROM jsonb_each($1::jsonb)) SELECT count(*) FROM (`+reviewedDefinerFunctionsSQL+`) accepted`, string(reviewedDefinerBodiesJSON())).Scan(&count); err != nil || count != want {
			t.Fatalf("article SQL review count=%d want=%d error=%v", count, want, err)
		}
	}
	check(6)
	definition, body, _ := newestDefinerMigrationFunction(t, definerFunctionIdentity{Schema: "public", Name: "app_article_opener_defaults"})
	fixtureExec(t, db, strings.Replace(definition, body, body+" ", 1))
	check(0)
	fixtureExec(t, db, definition)
	check(6)
	fixtureExec(t, db, `ALTER TABLE system_column_details DISABLE TRIGGER article_field_created`)
	check(5)
	fixtureExec(t, db, `ALTER TABLE system_column_details ENABLE TRIGGER article_field_created`)
	check(6)
}
