// front_page_article_buttons_test.go
// Exercises visitor omission, title localization and administrator input boundaries.
// Connects real Home/session handling to controlled canonical results and metadata.
// Proves denied targets leave no placeholders and boxes-off still resolves buttons.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"
	config "easelect/backend/core_components/system_config_checks"
)

func stubFrontPageArticleButtons(t *testing.T) {
	t.Helper()
	stubFrontPageRead(t, nil)
	target, grant, readGrant, path, translations := frontPageArticleTargetReader, frontPageArticleViewAllowed, frontPageArticleReadGranted, frontPageArticlePathReader, frontPageArticleTranslationsReader
	t.Cleanup(func() {
		frontPageArticleTargetReader, frontPageArticleViewAllowed, frontPageArticleReadGranted, frontPageArticlePathReader, frontPageArticleTranslationsReader = target, grant, readGrant, path, translations
	})
	frontPageArticleTargetReader = func(*http.Request, int) (string, error) { return "private_dataset", nil }
	frontPageArticleViewAllowed = func(int, string) bool { return true }
	frontPageArticleReadGranted = func(int, string) bool { return true }
	frontPageArticlePathReader = func(_ *http.Request, _ int, dataset, id string) (string, bool) {
		return "/contact/" + id + "?view=article_view", true
	}
	frontPageArticleTranslationsReader = func(language string) (map[string]string, error) {
		return map[string]string{"contact_key": map[string]string{"fi": "Ota yhteyttä", "en": "Contact"}[language]}, nil
	}
	frontPageArticleButtonsReader = func(context.Context, *sql.DB) (config.FrontPageArticleButtons, string, error) {
		return config.FrontPageArticleButtons{SchemaVersion: 1, Placement: "top_row", Items: []config.FrontPageArticleItem{{TableUID: 102, RowID: "87654321", Enabled: true}}}, "private-revision", nil
	}
	frontPageSettingsReader = func(context.Context, *sql.DB) (backend.FrontPageSettings, error) {
		return backend.FrontPageSettings{SeparateFrontPage: true}, nil
	}
}

func TestFrontPageArticleButtonsVisitorIdentityPrivacyAndBoxesOff(t *testing.T) {
	for _, viewer := range []struct {
		id   int
		role string
	}{{74, "admin"}, {42, "basic"}, {1, "guest"}} {
		t.Run(viewer.role, func(t *testing.T) {
			stubFrontPageArticleButtons(t)
			request := frontPageSessionRequest(t, viewer.id, viewer.role, "GET", "/api/front-page?lang=fi&dataset=attacker&id=1")
			ctx := dbutils.SetLazyTx(request.Context(), dbutils.NewLazyTx(nil))
			request = request.WithContext(ctx)
			frontPageBlocksResolver = func(dbutils.Querier, int) ([]frontPageBlock, string, error) {
				t.Fatal("resolved boxes while off")
				return nil, "", nil
			}
			calls := 0
			frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
				calls++
				id, err := e_sessions.GetUserIDFromSession(r)
				query := r.URL.Query()
				if err != nil || id != viewer.id || r.Context() != ctx || query.Get("view_key") != "article_view" || query.Get("dataset") != "private_dataset" || query.Get("id") != "87654321" || query.Get("lang") != "fi" || query.Get("row_count") != "0" || len(query) != 5 {
					t.Fatal("delegate lost actor or accepted caller controls", query, id, err)
				}
				fmt.Fprint(w, `{"columns":["headline"],"types":{"headline":{"card_element":"header","is_multilingual":true}},"data":[{"id":87654321,"headline":{"fi":"Ota yhteyttä","en":"Contact"}}]}`)
			}
			response := httptest.NewRecorder()
			GetFrontPageHandler(response, request)
			var payload map[string]json.RawMessage
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || response.Code != 200 || calls != 1 {
				t.Fatal(response.Code, response.Body.String(), calls, err)
			}
			if string(payload["article_buttons"]) != `[{"href":"/contact/87654321?view=article_view","label":"Ota yhteyttä"}]` || string(payload["blocks"]) != `[]` || string(payload["article_buttons_placement"]) != `"top_row"` {
				t.Fatal(response.Body.String())
			}
			for _, secret := range []string{"table_uid", "row_id", "items", "private_dataset", "private-revision", "102", "unavailable_items"} {
				if strings.Contains(response.Body.String(), secret) {
					t.Fatal("configuration leaked", secret, response.Body.String())
				}
			}
			if response.Header().Get("Cache-Control") != "private, no-store" || response.Header().Get("Vary") != "Cookie" {
				t.Fatal(response.Header())
			}
		})
	}
}

func TestFrontPageArticleButtonsOmissionBoundaries(t *testing.T) {
	for _, denial := range []string{"route", "dataset grant", "dataset", "deleted dataset", "row policy", "unselected header", "no title", "wrong row", "delegate error", "disabled", "invalid setting", "cancelled"} {
		t.Run(denial, func(t *testing.T) {
			stubFrontPageArticleButtons(t)
			frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
				body := `{"columns":["headline"],"types":{"headline":{"card_element":"header"}},"data":[{"id":87654321,"headline":"Secret title"}]}`
				switch denial {
				case "row policy":
					body = `{"columns":["headline"],"types":{},"data":[]}`
				case "unselected header":
					body = `{"columns":["id"],"types":{"headline":{"card_element":"header"}},"data":[{"id":87654321,"headline":"Secret title"}]}`
				case "no title":
					body = `{"columns":["headline"],"types":{"headline":{"card_element":"header"}},"data":[{"id":87654321,"headline":" "}]}`
				case "wrong row":
					body = strings.ReplaceAll(body, "87654321", "999")
				case "delegate error":
					http.Error(w, "Secret title private_dataset", 403)
					return
				}
				fmt.Fprint(w, body)
			}
			switch denial {
			case "route":
				frontPageArticleViewAllowed = func(int, string) bool { return false }
			case "dataset grant":
				frontPageArticleReadGranted = func(int, string) bool { return false }
			case "dataset":
				frontPageCanRead = func(int, string) bool { return false }
			case "deleted dataset":
				frontPageArticleTargetReader = func(*http.Request, int) (string, error) { return "", sql.ErrNoRows }
			case "disabled", "invalid setting":
				frontPageArticleButtonsReader = func(context.Context, *sql.DB) (config.FrontPageArticleButtons, string, error) {
					if denial == "invalid setting" {
						return config.EmptyFrontPageArticleButtons(), "private-version", errors.New("private_dataset malformed")
					}
					return config.FrontPageArticleButtons{SchemaVersion: 1, Placement: "below_text", Items: []config.FrontPageArticleItem{{102, "87654321", false, ""}}}, "v", nil
				}
			}
			request := frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page?lang=en")
			if denial == "cancelled" {
				ctx, cancel := context.WithCancel(request.Context())
				cancel()
				request = request.WithContext(ctx)
			}
			response := httptest.NewRecorder()
			GetFrontPageHandler(response, request)
			if response.Code != 200 || !strings.Contains(response.Body.String(), `"article_buttons":[]`) {
				t.Fatal(response.Code, response.Body.String())
			}
			for _, secret := range []string{"private_dataset", "Secret title", "87654321", "table_uid", "row_id", "items", "private-version"} {
				if strings.Contains(response.Body.String(), secret) {
					t.Fatal("denied target leaked", secret, response.Body.String())
				}
			}
		})
	}
}

func TestFrontPageArticleTitleOrderProjectionAndLanguage(t *testing.T) {
	stubFrontPageArticleButtons(t)
	var result frontPageArticleResult
	json.Unmarshal([]byte(`{"columns":["later","first","hidden"],"types":{"later":{"card_element":"header","is_multilingual":true},"first":{"card_element":"header+lang_key"},"hidden":{"card_element":"header"}},"data":[{"id":7,"later":{"fi":"Ensimmäinen","en":"First"},"first":"contact_key","hidden":"Private"}]}`), &result)
	for language, want := range map[string]string{"fi": "Ensimmäinen", "en": "First", "en-US": "First"} {
		if got := frontPageArticleTitle(httptest.NewRequest("GET", "/?lang="+language, nil), 42, result); got != want {
			t.Fatal(language, got, want)
		}
	}
	result.Columns = []string{"first", "later"}
	for language, want := range map[string]string{"fi": "Ota yhteyttä", "en": "Contact"} {
		if got := frontPageArticleTitle(httptest.NewRequest("GET", "/?lang="+language, nil), 42, result); got != want {
			t.Fatal(language, got, want)
		}
	}
	result.Columns = []string{"first"}
	result.Data[0]["first"] = json.RawMessage(`"missing_key"`)
	if got := frontPageArticleTitle(httptest.NewRequest("GET", "/?lang=en", nil), 42, result); got != "" {
		t.Fatal("key used as title", got)
	}
	for _, role := range []string{"header+lang-key", "image, header+lang_key", "header"} {
		header, key := articleHeaderRole(role)
		if !header || key != strings.Contains(role, "lang") {
			t.Fatal(role, header, key)
		}
	}
	for _, test := range []struct {
		raw  string
		flag *bool
		want string
	}{
		{`"Plain"`, nil, "Plain"}, {`null`, nil, ""}, {`{"fi":"Suomi","en":"English"}`, nil, "Suomi"},
		{`"{\"fi\":\"Suomi\",\"en\":\"English\"}"`, nil, "Suomi"}, {`{"yue":"廣東話","ch":"中文"}`, nil, "廣東話"},
	} {
		if got := articleDisplayValue(json.RawMessage(test.raw), test.flag, "fi"); got != test.want {
			t.Fatal(test.raw, got, test.want)
		}
	}
}

func TestFrontPageArticleButtonsAdministratorRequestsAndUnavailable(t *testing.T) {
	stubFrontPageArticleButtons(t)
	valid := `{"article_buttons":{"schema_version":1,"placement":"below_text","items":[]},"version":"none"}`
	if _, err := decodeFrontPageArticleButtonsRequest(strings.NewReader(valid)); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{valid + `{}`, strings.Replace(valid, `,"version":"none"`, "", 1), strings.Replace(valid, `"version":"none"`, `"version":null`, 1), strings.Replace(valid, `"items":[]`, `"items":null`, 1), strings.Replace(valid, `"version":"none"`, `"version":"none","user_id":42`, 1)} {
		if _, err := decodeFrontPageArticleButtonsRequest(strings.NewReader(body)); err == nil {
			t.Fatal("accepted", body)
		}
	}
	frontPageArticleTargetReader = func(*http.Request, int) (string, error) { return "", sql.ErrNoRows }
	response := httptest.NewRecorder()
	AdminFrontPageArticleButtonsHandler(response, frontPageSessionRequest(t, 74, "admin", "GET", "/api/admin/front-page/article-buttons"))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"reason":"dataset_missing_or_unavailable"`) {
		t.Fatal(response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	AdminFrontPageArticleButtonsHandler(response, httptest.NewRequest("GET", "/api/admin/front-page/article-buttons", nil))
	if response.Code != 401 {
		t.Fatal(response.Code)
	}
	item := config.FrontPageArticleButtons{SchemaVersion: 1, Placement: "below_text", Items: []config.FrontPageArticleItem{{102, "7", false, ""}}}
	raw, _ := json.Marshal(item)
	if err := validateFrontPageArticleTargets(httptest.NewRequest("POST", "/", nil), 74, raw); !errors.Is(err, errFrontPageInput) {
		t.Fatal("disabled invalid target accepted", err)
	}
}

func TestFrontPageArticleButtonsAdministratorSaveAndConflict(t *testing.T) {
	stubFrontPageArticleButtons(t)
	state := &articleButtonsTestState{}
	db := articleButtonsUnitDB(t, state)
	frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
		id, err := e_sessions.GetUserIDFromSession(r)
		if err != nil || id != 74 || r.URL.Query().Get("view_key") != "article_view" {
			t.Fatal("save changed administrator", id, err)
		}
		fmt.Fprint(w, `{"columns":["id"],"types":{},"data":[{"id":87654321}]}`)
	}
	body := `{"article_buttons":{"schema_version":1,"placement":"below_text","items":[{"table_uid":102,"row_id":"87654321","enabled":false}]},"version":"none"}`
	post := func() *httptest.ResponseRecorder {
		lazy := dbutils.NewLazyTx(db)
		defer lazy.Rollback()
		request := frontPageSessionRequest(t, 74, "admin", "POST", "/api/admin/front-page/article-buttons")
		request.Body = io.NopCloser(strings.NewReader(body))
		request = request.WithContext(dbutils.SetLazyTx(request.Context(), lazy))
		response := httptest.NewRecorder()
		AdminFrontPageArticleButtonsHandler(response, request)
		if response.Code == 200 {
			if err := lazy.Commit(); err != nil {
				t.Fatal(err)
			}
		}
		return response
	}
	if response := post(); response.Code != 200 || state.writes != 1 {
		t.Fatal(response.Code, response.Body.String(), state.writes)
	}
	if response := post(); response.Code != 409 || state.writes != 1 {
		t.Fatal("stale API save wrote", response.Code, response.Body.String(), state.writes)
	}
	frontPageArticleTargetReader = func(*http.Request, int) (string, error) { return "", sql.ErrNoRows }
	if response := post(); response.Code != 400 || state.writes != 1 || !strings.Contains(response.Body.String(), "dataset_missing_or_unavailable") {
		t.Fatal("invalid disabled target saved", response.Code, response.Body.String())
	}
}

func TestFrontPageArticleTitleHidesNonArticleValues(t *testing.T) {
	stubFrontPageArticleButtons(t)
	for _, metadata := range []string{`{"card_element":"header","hide_everywhere":true}`, `{"card_element":"header","client_delivery_mode":"omit"}`, `{"card_element":"header","hide_on_bg_crd_if_not_own":true}`, `{"card_element":"description"}`} {
		result := frontPageArticleResult{Columns: []string{"headline"}, Types: map[string]json.RawMessage{"headline": json.RawMessage(metadata)}, Data: []map[string]json.RawMessage{{"headline": json.RawMessage(`"Secret"`)}}}
		if got := frontPageArticleTitle(httptest.NewRequest("GET", "/?lang=en", nil), 42, result); got != "" {
			t.Fatal(metadata, got)
		}
	}
}

func TestFrontPageArticleLabelSharedLanguageContract(t *testing.T) {
	raw, err := os.ReadFile("../../../testing/shared_contracts/home_article_label_examples.json")
	if err != nil {
		t.Fatal(err)
	}
	var examples []struct {
		RawValue json.RawMessage        `json:"raw_value"`
		Metadata frontPageArticleColumn `json:"metadata"`
		Language string                 `json:"language"`
		Expected string                 `json:"expected"`
	}
	if err := json.Unmarshal(raw, &examples); err != nil {
		t.Fatal(err)
	}
	for _, example := range examples {
		if got := articleDisplayValue(example.RawValue, example.Metadata.IsMultilingual, example.Language); got != example.Expected {
			t.Fatal(example.Language, string(example.RawValue), got, example.Expected)
		}
	}
}
