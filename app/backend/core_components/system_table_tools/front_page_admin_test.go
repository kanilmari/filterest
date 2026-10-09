// front_page_admin_test.go
// Exercises strict administrator request forms and conflict responses without a database.
// Atomic replacement, reset and concurrency are separately proved on disposable PostgreSQL.
// Holds the Home hero and optional boxes to the same strict write boundary.
package system_table_tools

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFrontPageAdminRequestForms(t *testing.T) {
	valid := []string{
		`{"settings":{"separate_front_page":true,"front_page_button_shows_site_name":false,"front_page_show_blocks":false}}`,
		`{"hero":{"title":{"fi":"Otsikko","en":"Title"},"slogan":{"fi":"","en":""},"description":{"fi":"Kuvaus","en":"Description"}}}`,
		`{"settings":{"separate_front_page":true,"front_page_button_shows_site_name":false}}`,
		`{"version":"none","blocks":[]}`,
		`{"user_id":42,"version":"none","blocks":[{"dataset":"content","result_limit":5,"sort_order":1,"enabled":true}]}`,
		`{"user_id":42,"version":"none","reset":true}`,
		`{"user_id":42,"version":"none","copy_from_common":true}`,
	}
	for _, body := range valid {
		if _, err := decodeFrontPageAdminRequest(strings.NewReader(body)); err != nil {
			t.Fatal(body, err)
		}
	}
	invalid := []string{`{"hero":{}}`, `{"hero":{"title":{"lang_key":"unrelated"},"slogan":{}}}`, `{"hero":{"title":{},"slogan":{}},"version":"none"}`, `{"hero":{"title":{},"slogan":{}},"user_id":42}`, `{"hero":{"title":{"ch":"no"},"slogan":{}}}`, `{"settings":{"separate_front_page":true,"front_page_button_shows_site_name":false,"front_page_show_blocks":"false"}}`, `{}`, `null`, `{"version":"none","blocks":[],"reset":true}`, `{"version":"none","reset":false}`, `{"version":"none","copy_from_common":true}`,
		`{"user_id":1,"version":"none","blocks":[]}`, `{"user_id":0,"version":"none","blocks":[]}`, `{"blocks":[]}`,
		`{"settings":{}}`, `{"settings":{},"user_id":42}`, `{"settings":{"unknown":true}}`, `{"settings":{"separate_front_page":"true"}}`,
		`{"version":"none","blocks":[]} {}`, `{"version":"none","blocks":null}`, `{"version":"none","blocks":[],"sql":"DROP"}`,
		`{"version":"none","blocks":[{"dataset":"content","result_limit":0,"sort_order":1}]}`,
		`{"version":"none","blocks":[{"dataset":"content","result_limit":21,"sort_order":1}]}`,
		`{"version":"none","blocks":[{"dataset":"content","result_limit":5,"sort_order":101}]}`,
		`{"version":"none","blocks":[{"dataset":"content","result_limit":5,"sort_order":1},{"dataset":"content","result_limit":5,"sort_order":2}]}`,
		`{"version":"none","blocks":[{"dataset":"content","result_limit":5,"sort_order":1},{"dataset":"other","result_limit":5,"sort_order":1}]}`,
	}
	for _, body := range invalid {
		if _, err := decodeFrontPageAdminRequest(strings.NewReader(body)); err == nil {
			t.Fatal("accepted", body)
		}
	}
}

func TestFrontPageAdminMethodValidationAndConflict(t *testing.T) {
	old := frontPageAdminSaver
	t.Cleanup(func() { frontPageAdminSaver = old })
	called := 0
	frontPageAdminSaver = func(context.Context, frontPageAdminRequest) (string, error) {
		called++
		return "", errFrontPageConflict
	}
	for _, tc := range []struct {
		method, body string
		status       int
	}{{"DELETE", "", 405}, {"POST", `{"user_id":1,"version":"none","blocks":[]}`, 400}, {"POST", `{"version":"none","blocks":[]}`, 409}} {
		response := httptest.NewRecorder()
		AdminFrontPageHandler(response, httptest.NewRequest(tc.method, "/api/admin/front-page", strings.NewReader(tc.body)))
		if response.Code != tc.status {
			t.Fatal(response.Code, response.Body.String())
		}
	}
	if called != 1 {
		t.Fatal("validation called saver", called)
	}
}

func TestFrontPageHeroDescriptionValidation(t *testing.T) {
	hero := frontPageHero{Title: &frontPageHeroText{}, Slogan: &frontPageHeroText{}, Description: &frontPageHeroText{}}
	if err := validateFrontPageHero(hero); err != nil {
		t.Fatal("empty copy refused", err)
	}
	for _, text := range []*frontPageHeroText{hero.Title, hero.Slogan, hero.Description} {
		text.Fi = strings.Repeat("ä", 2001)
		if err := validateFrontPageHero(hero); err == nil {
			t.Fatal("oversized copy accepted")
		}
		text.Fi = "\x00"
		if err := validateFrontPageHero(hero); err == nil {
			t.Fatal("NUL copy accepted")
		}
		text.Fi = ""
	}
	hero.Description.LangKey = "site_front_page_slogan"
	if err := validateFrontPageHero(hero); err == nil {
		t.Fatal("wrong description key accepted")
	}
}
