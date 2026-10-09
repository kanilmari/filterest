// front_page_presentation_test.go
// Proves strict Home layout requests, omission compatibility and independent persistence.
// Connects the shared policy, admin decoder and existing disposable PostgreSQL fixture.
// Exercises stale saves and omitted layout preservation without an installation database.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	presentation "easelect/frontend/shared/front_page_presentation"
)

func TestHomePresentationAdminRequestAndOmission(t *testing.T) {
	value, _ := json.Marshal(presentation.Rules().Default)
	layout := string(value)
	for _, body := range []string{`{"presentation":` + layout + `,"version":"none"}`, `{"hero":{"title":{},"slogan":{},"description":{}}}`, `{"settings":{"separate_front_page":true,"front_page_button_shows_site_name":false}}`} {
		request, err := decodeFrontPageAdminRequest(strings.NewReader(body))
		if err != nil {
			t.Fatal(body, err)
		}
		if !strings.Contains(body, `"presentation"`) && request.Presentation != nil {
			t.Fatal("omitted layout became a write")
		}
	}
	for _, body := range []string{`{"presentation":` + layout + `}`, `{"presentation":null,"version":"none"}`,
		`{"presentation":{},"version":"none"}`, `{"presentation":` + layout + `,"version":"none","user_id":42}`,
		`{"presentation":` + layout + `,"version":"none","blocks":[]}`, `{"presentation":` + layout + `,"version":"none","hero":{"title":{},"slogan":{},"description":{}}}`} {
		if _, err := decodeFrontPageAdminRequest(strings.NewReader(body)); err == nil {
			t.Fatal("accepted", body)
		}
	}
}
func TestHomePresentationPostgresPersistenceConflictAndOmitted(t *testing.T) {
	db := frontPageDisposableDB(t)
	value, revision, err := backend.ReadFrontPagePresentation(context.Background(), db)
	if err != nil || value == nil || *value != presentation.Rules().Default || revision != "none" {
		t.Fatal("missing layout", value, revision, err)
	}
	layout := presentation.Rules().Default
	raw, _ := json.Marshal(layout)
	revision, err = frontPageTestSave(db, frontPageAdminRequest{Presentation: raw, Version: "none"})
	if err != nil || revision == "none" || revision == "" {
		t.Fatal(revision, err)
	}
	value, gotRevision, err := backend.ReadFrontPagePresentation(context.Background(), db)
	if err != nil || value == nil || *value != layout || gotRevision != revision {
		t.Fatal(value, gotRevision, err)
	}
	on, off := true, false
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Settings: &frontPageAdminSettings{SeparateFrontPage: &on, FrontPageButtonShowsSiteName: &off}}); err != nil {
		t.Fatal(err)
	}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Hero: &frontPageHero{Title: &frontPageHeroText{}, Slogan: &frontPageHeroText{}, Description: &frontPageHeroText{}}}); err != nil {
		t.Fatal(err)
	}
	_, same, err := backend.ReadFrontPagePresentation(context.Background(), db)
	if err != nil || same != revision {
		t.Fatal("omitted layout changed", same, err)
	}
	layout.Anchor = "bottom-right"
	raw, _ = json.Marshal(layout)
	newer, err := frontPageTestSave(db, frontPageAdminRequest{Presentation: raw, Version: revision})
	if err != nil || newer == revision {
		t.Fatal(newer, err)
	}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Presentation: raw, Version: revision}); !errors.Is(err, errFrontPageConflict) {
		t.Fatal("stale save accepted", err)
	}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Presentation: json.RawMessage(`{"margin_px":400}`), Version: newer}); !errors.Is(err, errFrontPageInput) {
		t.Fatal("invalid save accepted", err)
	}
	value, gotRevision, err = backend.ReadFrontPagePresentation(context.Background(), db)
	if err != nil || *value != layout || gotRevision != newer {
		t.Fatal("failed write changed state", value, gotRevision, err)
	}
}

// A row another writer left without a timestamp still reads, and saving over it stamps the row.
func TestHomePresentationPostgresUnstampedRow(t *testing.T) {
	db := frontPageDisposableDB(t)
	layout := presentation.Rules().Default
	raw, _ := json.Marshal(layout)
	if _, err := db.Exec(`INSERT INTO public.system_config(key,json_value,value_type,creation_spec,updated)
        VALUES('front_page_presentation',$1::jsonb,5,'Home title and description layout.',NULL)`, string(raw)); err != nil {
		t.Fatal(err)
	}
	value, revision, err := backend.ReadFrontPagePresentation(context.Background(), db)
	if err != nil || value == nil || *value != layout || revision == "none" {
		t.Fatal(value, revision, err)
	}
	layout.Anchor = "center-center"
	raw, _ = json.Marshal(layout)
	newer, err := frontPageTestSave(db, frontPageAdminRequest{Presentation: raw, Version: revision})
	if err != nil || newer == revision {
		t.Fatal(newer, err)
	}
	var stamped bool
	if err := db.QueryRow(`SELECT updated IS NOT NULL FROM public.system_config WHERE key='front_page_presentation'`).Scan(&stamped); err != nil || !stamped {
		t.Fatal("save left the row unstamped", err)
	}
}

// The generic settings editor creates rows without the palette's lock; a first save that loses that race conflicts.
func TestHomePresentationPostgresFirstSaveNeverOverwritesAConcurrentCreator(t *testing.T) {
	db := frontPageDisposableDB(t)
	competing := presentation.Rules().Default
	competing.Anchor = "bottom-left"
	competingRaw, _ := json.Marshal(competing)
	t.Cleanup(func() { beforeFrontPagePresentationWrite = func() {} })
	beforeFrontPagePresentationWrite = func() {
		if _, err := db.Exec(`INSERT INTO public.system_config(key,json_value,value_type,creation_spec)
            VALUES('front_page_presentation',$1::jsonb,5,'Created through the generic editor.')`, string(competingRaw)); err != nil {
			t.Error(err)
		}
	}
	raw, _ := json.Marshal(presentation.Rules().Default)
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Presentation: raw, Version: "none"}); !errors.Is(err, errFrontPageConflict) {
		t.Fatal("first save did not report the concurrently created row", err)
	}
	beforeFrontPagePresentationWrite = func() {}
	value, _, err := backend.ReadFrontPagePresentation(context.Background(), db)
	if err != nil || value == nil || *value != competing {
		t.Fatal("the concurrently created row changed", value, err)
	}
}

func TestHomePresentationPostgresConcurrentFirstSaves(t *testing.T) {
	db := frontPageDisposableDB(t)
	raw, _ := json.Marshal(presentation.Rules().Default)
	start, results := make(chan struct{}), make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			_, err := frontPageTestSave(db, frontPageAdminRequest{Presentation: raw, Version: "none"})
			results <- err
		}()
	}
	close(start)
	left, right := <-results, <-results
	if !((left == nil && errors.Is(right, errFrontPageConflict)) || (right == nil && errors.Is(left, errFrontPageConflict))) {
		t.Fatal(left, right)
	}
}

func TestFrontPageReadPresentationAndInvalidSaved(t *testing.T) {
	stubFrontPageRead(t, nil)
	layout := presentation.Rules().Default
	frontPagePresentationReader = func(context.Context, *sql.DB) (*presentation.Value, string, error) {
		return &layout, "layout-version", nil
	}
	response := httptest.NewRecorder()
	GetFrontPageHandler(response, frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page"))
	var data struct {
		Presentation presentation.Value `json:"presentation"`
		Version      string             `json:"presentation_version"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &data); err != nil || response.Code != 200 || data.Presentation != layout || data.Version != "layout-version" {
		t.Fatal(response.Code, response.Body.String(), err)
	}
	frontPagePresentationReader = func(context.Context, *sql.DB) (*presentation.Value, string, error) {
		return nil, "", errors.New("invalid saved layout")
	}
	response = httptest.NewRecorder()
	GetFrontPageHandler(response, frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page"))
	if response.Code != 500 {
		t.Fatal(response.Code, response.Body.String())
	}
}

func TestHomePresentationPostgresConversionPreservesRevisionAndWritesVersionTwo(t *testing.T) {
	db := frontPageDisposableDB(t)
	for _, layout := range []string{"normal", "artistic"} {
		raw := `{"schema_version":1,"anchor":"bottom-left","margin_px":71,"paragraph_layout":"` + layout + `","max_width_px":700}`
		if _, err := db.Exec(`INSERT INTO public.system_config(key,json_value,value_type,updated)
            VALUES('front_page_presentation',$1::jsonb,5,NULL) ON CONFLICT(key) DO UPDATE SET json_value=EXCLUDED.json_value,updated=NULL`, raw); err != nil {
			t.Fatal(err)
		}
		value, revision, err := backend.ReadFrontPagePresentation(context.Background(), db)
		if err != nil || value.SchemaVersion != 2 || value.HorizontalMarginPx != 71 || value.VerticalMarginPx != 71 ||
			value.Alignment != presentation.Rules().Legacy.Alignments[layout] {
			t.Fatal(value, revision, err)
		}
		var storedRaw []byte
		if err := db.QueryRow(`SELECT json_value FROM public.system_config WHERE key='front_page_presentation'`).Scan(&storedRaw); err != nil {
			t.Fatal(err)
		}
		if revision != backend.FrontPagePresentationRevision(storedRaw, "") {
			t.Fatal("conversion changed revision")
		}
		converted, _ := json.Marshal(value)
		newer, err := frontPageTestSave(db, frontPageAdminRequest{Presentation: converted, Version: revision})
		if err != nil || newer == revision {
			t.Fatal(newer, err)
		}
		var storedVersion int
		if err := db.QueryRow(`SELECT (json_value->>'schema_version')::int FROM public.system_config WHERE key='front_page_presentation'`).Scan(&storedVersion); err != nil || storedVersion != 2 {
			t.Fatal(storedVersion, err)
		}
		if _, err := frontPageTestSave(db, frontPageAdminRequest{Presentation: json.RawMessage(raw), Version: newer}); !errors.Is(err, errFrontPageInput) {
			t.Fatal("version-one write accepted", err)
		}
	}
}
