// dataset_card_presentation_test.go
// Verifies compatibility projections and atomic card saves on the new authority.
// Connects nullable legacy request fields with canonical overrides and both revisions.
// Uses only disposable PostgreSQL and refuses stale or unversioned editors.
package system_table_tools

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
)

func TestDatasetPresentationRejectsInvalidPayloadBeforeTransaction(t *testing.T) {
	for _, body := range []string{
		`{"scope":"dataset_presentation","table_name":"wl143_content","card_style_variant":"floating"}`,
		`{"scope":"dataset_presentation","table_name":"wl143_content","card_detail_columns":2.5}`,
		`{"scope":"dataset_presentation","table_name":"wl143_content","columns":[],"card_style_variant":null}`,
	} {
		w := httptest.NewRecorder()
		UpdateCardVisibilityHandler(w, httptest.NewRequest("POST", "/api/card-visibility/update", strings.NewReader(body)))
		if w.Code != 400 || !strings.Contains(w.Body.String(), "dataset_appearance_invalid") {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}

func TestDatasetPresentationAtomicPersistencePostgres(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	current, err := store.ReadAppearance(db, uid, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, values := range []map[string]any{
		{"card_style_variant": "modern", "card_detail_columns": 2},
		{"card_style_variant": "standard"},
		{"card_style_variant": nil, "card_detail_columns": nil},
	} {
		request := map[string]any{"scope": "dataset_presentation", "table_name": "wl143_content", "version": current.Version, "shared_version": current.SharedVersion}
		for key, value := range values {
			request[key] = value
		}
		raw, _ := json.Marshal(request)
		lazy := dbutils.NewLazyTx(db)
		r := httptest.NewRequest("POST", "/api/card-visibility/update", strings.NewReader(string(raw)))
		r = r.WithContext(dbutils.SetLazyTx(r.Context(), lazy))
		w := httptest.NewRecorder()
		UpdateCardVisibilityHandler(w, r)
		if w.Code != 200 {
			lazy.Rollback()
			t.Fatal(w.Code, w.Body.String())
		}
		if err := lazy.Commit(); err != nil {
			t.Fatal(err)
		}
		var result DatasetCardPresentation
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.DatasetAppearance.Version == current.Version {
			t.Fatal("revision did not advance")
		}
		layout, read, err := loadCardVisibilityTableSettings(db, "wl143_content")
		if err != nil || layout == "" || read.DatasetAppearance.Version != result.DatasetAppearance.Version {
			t.Fatal(read, err)
		}
		current = result.DatasetAppearance
		// Replaying the exact loaded draft is refused, including explicit equality.
		lazy = dbutils.NewLazyTx(db)
		r = r.WithContext(dbutils.SetLazyTx(r.Context(), lazy))
		r.Body = ioBody(string(raw))
		w = httptest.NewRecorder()
		UpdateCardVisibilityHandler(w, r)
		lazy.Rollback()
		if w.Code != 409 {
			t.Fatal("stale compatibility save", w.Code, w.Body.String())
		}
	}
}

func ioBody(raw string) *readCloseString { return &readCloseString{strings.NewReader(raw)} }

type readCloseString struct{ *strings.Reader }

func (*readCloseString) Close() error { return nil }
