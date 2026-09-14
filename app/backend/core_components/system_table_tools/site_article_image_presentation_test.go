// site_article_image_presentation_test.go
// Verifies article caption choices, old clients, and persisted readback.
// Uses the disposable PostgreSQL fixture to exercise the actual upsert row lock.
// Keeps site-wide captions independent of existing card and theme settings.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
)

func articleCaptionSettingsBody(t *testing.T, value string) string {
	t.Helper()
	body, err := json.Marshal(defaultSitePresentationSettings())
	if err != nil {
		t.Fatal(err)
	}
	if value == "omitted" {
		return strings.Replace(string(body), `"article_image_caption_position":"below",`, "", 1)
	}
	return strings.Replace(string(body), `"article_image_caption_position":"below"`, `"article_image_caption_position":`+value, 1)
}

func TestArticleImageCaptionChoicesAndLegacyOmission(t *testing.T) {
	for _, value := range []string{"below", "overlay"} {
		t.Run(value, func(t *testing.T) {
			settings, err := decodeSitePresentationSettings(strings.NewReader(articleCaptionSettingsBody(t, `"`+value+`"`)))
			if err != nil {
				t.Fatal(err)
			}
			if settings.DatasetCoverTheme.Shared.ArticleImageCaptionPosition != value || settings.preserveStoredArticleImageCaptionPosition {
				t.Fatalf("explicit caption changed: %#v", settings)
			}
		})
	}
	legacy, err := decodeSitePresentationSettings(strings.NewReader(articleCaptionSettingsBody(t, "omitted")))
	if err != nil {
		t.Fatal(err)
	}
	if legacy.DatasetCoverTheme.Shared.ArticleImageCaptionPosition != "below" || !legacy.preserveStoredArticleImageCaptionPosition {
		t.Fatal("old clients need the below default and atomic stored-value preservation")
	}
	for _, value := range []string{`null`, `1`, `true`, `{}`, `[]`, `""`, `"unknown"`} {
		t.Run(value, func(t *testing.T) {
			if _, err := decodeSitePresentationSettings(strings.NewReader(articleCaptionSettingsBody(t, value))); err == nil {
				t.Fatalf("accepted invalid caption %s", value)
			}
		})
	}
}

func TestOldStoredArticleCaptionKeepsExistingThemeAndCards(t *testing.T) {
	settings := defaultSitePresentationSettings()
	oldJSON := `{"shared":{"card_style_variant":"standard","card_detail_columns":4,"brand_color":"#cc3366"},"dark":{"image_blur":7}}`
	if err := json.Unmarshal([]byte(oldJSON), &settings.DatasetCoverTheme); err != nil {
		t.Fatal(err)
	}
	if err := validateDatasetCoverTheme(settings.DatasetCoverTheme); err != nil {
		t.Fatal(err)
	}
	shared := settings.DatasetCoverTheme.Shared
	if shared.ArticleImageCaptionPosition != "below" || shared.CardStyleVariant != "standard" || shared.CardDetailColumns != 4 || shared.BrandColor != "#cc3366" || settings.DatasetCoverTheme.Dark.ImageBlur != 7 {
		t.Fatal("legacy merge lost an existing preference or the new default")
	}
}

func TestArticleCaptionPersistencePreservesLegacyWritesUnderLockPostgres(t *testing.T) {
	db := sitePresentationDisposableDB(t)
	previousDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previousDB })
	legacy, err := decodeSitePresentationSettings(strings.NewReader(articleCaptionSettingsBody(t, "omitted")))
	if err != nil {
		t.Fatal(err)
	}
	persist := func(tx *dbutils.LazyTx, settings SitePresentationSettingsResponse) (SitePresentationSettingsResponse, error) {
		request := httptest.NewRequest(http.MethodPost, "/api/admin/site-presentation-settings", nil)
		return persistSitePresentationSettings(request.WithContext(dbutils.SetLazyTx(request.Context(), tx)), settings)
	}
	save := func(settings SitePresentationSettingsResponse) SitePresentationSettingsResponse {
		t.Helper()
		tx := dbutils.NewLazyTx(db)
		defer tx.Rollback()
		saved, err := persist(tx, settings)
		if err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		return saved
	}
	if got := save(legacy).DatasetCoverTheme.Shared.ArticleImageCaptionPosition; got != "below" {
		t.Fatalf("first legacy save = %q, want below", got)
	}
	explicit := defaultSitePresentationSettings()
	explicit.DatasetCoverTheme.Shared.ArticleImageCaptionPosition = "overlay"
	tx1 := dbutils.NewLazyTx(db)
	defer tx1.Rollback()
	if _, err := persist(tx1, explicit); err != nil {
		t.Fatal(err)
	}
	tx2 := dbutils.NewLazyTx(db)
	defer tx2.Rollback()
	sqlTx2, err := tx2.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sqlTx2.Exec("SET LOCAL lock_timeout = '5s'"); err != nil {
		t.Fatal(err)
	}
	var pid int
	if err := sqlTx2.QueryRow("SELECT pg_backend_pid()").Scan(&pid); err != nil {
		t.Fatal(err)
	}
	legacy.DatasetCoverTheme.Shared.CardDetailColumns = 4
	type result struct {
		settings SitePresentationSettingsResponse
		err      error
	}
	finished := make(chan result, 1)
	go func() { saved, err := persist(tx2, legacy); finished <- result{saved, err} }()
	deadline := time.Now().Add(3 * time.Second)
	for {
		var wait sql.NullString
		if err := db.QueryRow("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", pid).Scan(&wait); err != nil {
			t.Fatal(err)
		}
		if wait.String == "Lock" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("legacy caption writer did not reach the row lock")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatal(err)
	}
	saved := <-finished
	if saved.err != nil {
		t.Fatal(saved.err)
	}
	if saved.settings.DatasetCoverTheme.Shared.ArticleImageCaptionPosition != "overlay" {
		t.Fatal("legacy write did not return the concurrently saved caption")
	}
	if err := tx2.Commit(); err != nil {
		t.Fatal(err)
	}
	readback, err := readSitePresentationSettingsFromDB()
	if err != nil {
		t.Fatal(err)
	}
	if readback.DatasetCoverTheme.Shared.ArticleImageCaptionPosition != "overlay" || readback.DatasetCoverTheme.Shared.CardDetailColumns != 4 {
		t.Fatal("legacy write lost the caption or unrelated submitted card setting")
	}
	explicit.DatasetCoverTheme.Shared.ArticleImageCaptionPosition = "below"
	if save(explicit).DatasetCoverTheme.Shared.ArticleImageCaptionPosition != "below" {
		t.Fatal("explicit below did not replace overlay")
	}
	// An old stored JSON object also resolves to below on the real write path.
	if _, err := db.Exec(`UPDATE public.system_config SET json_value = json_value #- '{shared,article_image_caption_position}' WHERE key=$1`, datasetCoverThemeConfigKey); err != nil {
		t.Fatal(err)
	}
	if save(legacy).DatasetCoverTheme.Shared.ArticleImageCaptionPosition != "below" {
		t.Fatal("missing stored caption did not resolve to below")
	}
}
