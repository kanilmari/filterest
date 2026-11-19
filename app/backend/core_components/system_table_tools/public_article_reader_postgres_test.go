// public_article_reader_postgres_test.go
// Proves the visitor reader behind public article pages and the sitemap against real grants, row rules and column rights.
// Connects a disposable bootstrap database, the Home article fixture and the canonical results pipeline.
// Repeats the WL140 attack: a signed-in administrator's request context must not widen what a public page prints.
package system_table_tools

import (
	"context"
	"database/sql"
	"sort"
	"strings"
	"testing"
	"time"

	e_sessions "easelect/backend/core_components/sessions"
)

func publicArticleFixtureDataset(uid int) PublicArticleDataset {
	return PublicArticleDataset{TableUID: uid, Name: articleButtonsFixtureDataset, PreferredName: articleButtonsFixtureDataset}
}

// administratorContext is the context of a request an administrator made, with
// that administrator's session already loaded into it, as rootHandler leaves it.
func administratorContext(t *testing.T) context.Context {
	t.Helper()
	request := frontPageSessionRequest(t, 74, "admin", "GET", "/"+articleButtonsFixtureDataset+"/"+articleButtonsFixtureRow)
	if _, err := e_sessions.Load(request); err != nil {
		t.Fatal(err)
	}
	return request.Context()
}

func TestPublicArticleReaderPostgresReadsTitleAndWordsAsTheVisitor(t *testing.T) {
	_, uid := articleButtonsPostgresFixture(t)
	ctx := administratorContext(t)
	dataset := publicArticleFixtureDataset(uid)

	article, status := ReadPublicArticle(ctx, dataset, articleButtonsFixtureRow, "fi")
	if status != PublicArticleFound || article.ID != articleButtonsFixtureRow || article.Title != "Ota yhteyttä" || article.TitleLanguage != "fi" {
		t.Fatalf("Finnish read: status %v article %+v", status, article)
	}
	if article.Slugs["fi"] != "ota-yhteytta" || article.Slugs["en"] != "contact" {
		t.Fatalf("address words = %v", article.Slugs)
	}
	languages := append([]string(nil), article.TitleLanguages...)
	sort.Strings(languages)
	if strings.Join(languages, ",") != "ch,en,fi,yue" {
		t.Fatalf("title languages = %v", article.TitleLanguages)
	}
	english, _ := ReadPublicArticle(ctx, dataset, articleButtonsFixtureRow, "en")
	if english.Title != "Contact" || english.TitleLanguage != "en" {
		t.Fatalf("English read: %+v", english)
	}

	// A list reads the same presentation, so it builds the same words.
	articles, more, err := ListPublicArticles(ctx, dataset, 0, 0, "fi")
	if err != nil || more || len(articles) != 1 || articles[0].Slugs["fi"] != article.Slugs["fi"] || articles[0].Title != article.Title {
		t.Fatalf("list: %v more=%v err=%v", articles, more, err)
	}

	for _, id := range []string{"1", "87654322", "87654321-x", "abc", ""} {
		if _, status := ReadPublicArticle(ctx, dataset, id, "fi"); status != PublicArticleNotFound {
			t.Errorf("row %q: status %v, want not found", id, status)
		}
	}
}

func TestPublicArticleReaderPostgresNeverWidensForASignedInCaller(t *testing.T) {
	db, uid := articleButtonsPostgresFixture(t)
	ctx := administratorContext(t)
	dataset := publicArticleFixtureDataset(uid)
	denials := []struct{ name, apply, restore string }{
		{"article and page grants",
			`DELETE FROM system_group_table_func_rights WHERE function_id=500001;
			CREATE TABLE wl175_enabled_page_functions AS SELECT id FROM system_functions
				WHERE url_route_endpoint='/ui/view/image_first_page_view' AND NOT disabled;
			UPDATE system_functions SET disabled=true WHERE id IN(SELECT id FROM wl175_enabled_page_functions)`,
			`INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) SELECT id,500001,NULL FROM system_user_groups WHERE id IN(1,2,3);
			UPDATE system_functions SET disabled=false WHERE id IN(SELECT id FROM wl175_enabled_page_functions);
			DROP TABLE wl175_enabled_page_functions`},
		{"dataset read grant",
			`DELETE FROM system_group_table_func_rights WHERE function_id=500000 AND target_table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='wl128_article')`,
			`INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) SELECT groups.id,500000,registry.table_uid FROM system_user_groups groups CROSS JOIN system_db_tables registry WHERE groups.id IN(1,2,3) AND registry.table_name='wl128_article'`},
		{"hidden dataset",
			`UPDATE system_db_tables SET ui_hidden=true WHERE table_name='wl128_article'`,
			`UPDATE system_db_tables SET ui_hidden=false WHERE table_name='wl128_article'`},
		{"row policy",
			`UPDATE wl128_article SET published=false`,
			`UPDATE wl128_article SET published=true`},
		{"column select",
			`REVOKE SELECT ON wl128_article FROM front_page_runtime; GRANT SELECT(id,published,user_id) ON wl128_article TO front_page_runtime`,
			`GRANT SELECT ON wl128_article TO front_page_runtime`},
	}
	for _, denial := range denials {
		t.Run(denial.name, func(t *testing.T) {
			// Recovery mode lets an administrator past missing grants in the
			// application; it never reaches the visitor read.
			t.Setenv("ENVIRONMENT_TYPE", "dev")
			t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "1")
			frontPageExec(t, db, denial.apply)
			articleButtonsInvalidateFixtureCaches()
			restored := false
			defer func() {
				if !restored {
					_, _ = db.Exec(denial.restore)
					articleButtonsInvalidateFixtureCaches()
				}
			}()

			article, status := ReadPublicArticle(ctx, dataset, articleButtonsFixtureRow, "en")
			if denial.name == "column select" {
				// The row is readable, its title column is not: the page gets no title.
				if status != PublicArticleFound || article.Title != "" || len(article.Slugs) != 0 {
					t.Fatalf("status %v article %+v", status, article)
				}
			} else if status != PublicArticleNotFound || article.Title != "" {
				t.Fatalf("status %v article %+v, want not found", status, article)
			}
			articles, _, err := ListPublicArticles(ctx, dataset, 0, 0, "en")
			if err != nil {
				t.Fatal(err)
			}
			for _, listed := range articles {
				if listed.Title == "Contact" {
					t.Fatalf("list carried a title the visitor may not read: %+v", listed)
				}
			}
			if denial.name != "column select" && len(articles) != 0 {
				t.Fatalf("list carried refused rows: %+v", articles)
			}

			frontPageExec(t, db, denial.restore)
			articleButtonsInvalidateFixtureCaches()
			restored = true
			if _, status := ReadPublicArticle(ctx, dataset, articleButtonsFixtureRow, "en"); status != PublicArticleFound {
				t.Fatalf("restored fixture: status %v", status)
			}
		})
	}
}

func TestPublicArticleDatasetsPostgresAreTheVisitorsMenuWithoutPictureStores(t *testing.T) {
	db, uid := articleButtonsPostgresFixture(t)
	names := func() []string {
		t.Helper()
		datasets, err := PublicArticleDatasets(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		var listed []string
		for _, dataset := range datasets {
			listed = append(listed, dataset.Name)
			if dataset.Name == articleButtonsFixtureDataset && (dataset.TableUID != uid || dataset.PreferredName == "") {
				t.Fatalf("fixture dataset identity = %+v", dataset)
			}
		}
		return listed
	}
	has := func(listed []string, name string) bool {
		for _, candidate := range listed {
			if candidate == name {
				return true
			}
		}
		return false
	}
	// The bootstrap's current project root holds the curated datasets; the fixture
	// dataset joins them at the top level, where the visitor's menu shows it.
	frontPageExec(t, db, `UPDATE system_db_tables SET folder_id=(SELECT folder_id FROM system_db_tables WHERE table_name='palvelukatalogi')
		WHERE table_name='wl128_article'`)
	if listed := names(); !has(listed, articleButtonsFixtureDataset) || has(listed, "system_users") || has(listed, "system_config") {
		t.Fatalf("published datasets = %v", listed)
	}

	// A picture store placed in the menu by mistake is still not an article dataset.
	frontPageExec(t, db, `CREATE TABLE wl128_article_assets(id bigint PRIMARY KEY, article_id bigint);
		INSERT INTO system_db_tables(table_name,schema_name,folder_id)
			SELECT 'wl128_article_assets','public',folder_id FROM system_db_tables WHERE table_name='palvelukatalogi';
		INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
			SELECT 3,500000,table_uid FROM system_db_tables WHERE table_name='wl128_article_assets';
		INSERT INTO system_foreign_key_relations_1_m(source_table_uid,target_table_uid,source_column_name,target_column_name,target_insert_specs)
			SELECT asset.table_uid,article.table_uid,'article_id','id','{"file_upload":{"filename_column":"file"}}'::jsonb
			FROM system_db_tables asset, system_db_tables article
			WHERE asset.table_name='wl128_article_assets' AND article.table_name='wl128_article';`)
	if listed := names(); has(listed, "wl128_article_assets") || !has(listed, articleButtonsFixtureDataset) {
		t.Fatalf("picture store published: %v", listed)
	}

	for _, denial := range []struct{ apply, restore string }{
		{`UPDATE system_db_tables SET ui_hidden=true WHERE table_name='wl128_article'`, `UPDATE system_db_tables SET ui_hidden=false WHERE table_name='wl128_article'`},
		{`DELETE FROM system_group_table_func_rights WHERE function_id=500000 AND user_group_id=3 AND target_table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='wl128_article')`,
			`INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) SELECT 3,500000,table_uid FROM system_db_tables WHERE table_name='wl128_article'`},
		// Inside a subfolder of the project the dataset is no longer in the main menu.
		{`UPDATE system_db_tables SET folder_id=2 WHERE table_name='wl128_article'`,
			`UPDATE system_db_tables SET folder_id=(SELECT folder_id FROM system_db_tables WHERE table_name='palvelukatalogi') WHERE table_name='wl128_article'`},
	} {
		frontPageExec(t, db, denial.apply)
		if listed := names(); has(listed, articleButtonsFixtureDataset) {
			t.Fatalf("after %q the dataset is still published: %v", denial.apply, listed)
		}
		frontPageExec(t, db, denial.restore)
	}
}

func TestPublicArticleReaderPostgresBlockedQueryEndsWithinItsBudget(t *testing.T) {
	db, uid := articleButtonsPostgresFixture(t)
	locker, err := db.BeginTx(context.Background(), &sql.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer locker.Rollback()
	if _, err := locker.Exec(`LOCK TABLE wl128_article IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	_, status := ReadPublicArticle(context.Background(), publicArticleFixtureDataset(uid), articleButtonsFixtureRow, "en")
	elapsed := time.Since(started)
	if status != PublicArticleUnavailable {
		t.Fatalf("blocked read: status %v, want unavailable", status)
	}
	if elapsed > PublicArticleReadBudget+2*time.Second {
		t.Fatalf("blocked read took %v, budget %v", elapsed, PublicArticleReadBudget)
	}
}
