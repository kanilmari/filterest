// seo_site_preview_test.go
// Verifies site-owned preview images, localized Home fallbacks and escaped HTML.
// Connects real shell renderers to the existing isolated database and favicon resolver.
// Protects the query budget and dataset/row privacy while replacing legacy branding.
package router

import (
	"context"
	"database/sql"
	"html"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/core_components/lang"
)

func setupSitePreviewIdentity(t *testing.T, siteName, faviconFile string) {
	t.Helper()
	t.Setenv("BASE_URL", "")
	originalName, originalFavicon, originalFrontend := configuredSiteNameReader, configuredFaviconReader, localFrontendDir
	configuredSiteNameReader = func(context.Context, *sql.DB) string { return siteName }
	configuredFaviconReader = func(context.Context, *sql.DB) string { return faviconFile }
	localFrontendDir = filepath.Join("..", "..", "..", "frontend")
	t.Cleanup(func() {
		configuredSiteNameReader, configuredFaviconReader, localFrontendDir = originalName, originalFavicon, originalFrontend
	})
}

func TestSitePreviewImageUsesTheResolved128PixelHeadIcon(t *testing.T) {
	for _, tc := range []struct{ name, site, configured, expected string }{
		{"configured", "Another site", "site-fintravel-ft-v1-16.png", "site-fintravel-ft-v1-128.png"},
		{"site initials", "Easelect Serlog", "", "site-initial-es-v1-128.png"},
		{"default", "旅遊", "", "site-initial-f-v1-128.png"},
		{"invalid configured file", "旅遊", "../favicon4S.png", "site-initial-f-v1-128.png"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupSitePreviewIdentity(t, tc.site, tc.configured)
			r := httptest.NewRequest(http.MethodGet, "http://localhost:8100/?lang=en", nil)
			r.Header.Set("X-Forwarded-Host", "travel.example:443")
			r.Header.Set("X-Forwarded-Proto", "https")
			meta := resolvePageMetaForDataset(r, nil)
			path := "/frontend/icons/site_favicons/" + tc.expected
			if meta.OGImage != "https://travel.example"+path || meta.Favicon128Path != path || meta.OGImageSize != 128 {
				t.Fatalf("preview/head icon mismatch: %+v", meta)
			}
		})
	}
}

func TestSitePreviewImageMissingVariantRetainsTheHeadResolverFallback(t *testing.T) {
	setupSitePreviewIdentity(t, "旅遊", "custom-v1-16.png")
	localFrontendDir = t.TempDir()
	assetDir := filepath.Join(localFrontendDir, "icons", "site_favicons")
	if err := os.MkdirAll(assetDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetDir, "custom-v1-16.png"), []byte("fixture"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "https://travel.example/", nil)
	meta := resolvePageMetaForDataset(r, nil)
	if meta.OGImage != "https://travel.example"+meta.FaviconPath || meta.Favicon128Path != meta.FaviconPath || meta.OGImageSize != 0 {
		t.Fatalf("missing variant must retain the head icon without invented dimensions: %+v", meta)
	}
}

func TestSitePreviewDescriptionFallbacks(t *testing.T) {
	for _, tc := range []struct {
		name, slogan, description, expected string
	}{
		{"Finnish slogan", "  Matkoja lähelle ja kauas  ", "Ignored description", "Matkoja lähelle ja kauas"},
		{"English slogan", "Travel near and far", "Ignored description", "Travel near and far"},
		{"multi-line slogan", "Iskulause\ntoinen rivi", "Ignored description", "Iskulause toinen rivi"},
		{"description", " \n\t ", "  Lähellä\n\n& kaukana  ", "Lähellä & kaukana"},
		{"neither", "", "", "Travel site"},
		{"blank copy", " \n ", " \t ", "Travel site"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := sitePreviewDescription("Travel site", lang.ShellBootTexts{HomeSlogan: tc.slogan, HomeDescription: tc.description}, "default")
			if got != tc.expected {
				t.Fatalf("description = %q, want %q", got, tc.expected)
			}
		})
	}
}

func TestSitePreviewDescriptionShortensAtUnicodeWordBoundaries(t *testing.T) {
	for _, tc := range []struct{ name, input, expected string }{
		{"exact limit", strings.Repeat("ä", 200), strings.Repeat("ä", 200)},
		{"long word", strings.Repeat("ä", 201), strings.Repeat("ä", 199) + "…"},
		{"word boundary", strings.Repeat("matka ", 40), strings.TrimSpace(strings.Repeat("matka ", 33)) + "…"},
		{"multibyte words", strings.Repeat("lähellä 😀 ", 25), strings.TrimSpace(strings.Repeat("lähellä 😀 ", 20)) + "…"},
		{"unicode spaces", strings.Repeat("旅遊\u2003", 80), strings.TrimSpace(strings.Repeat("旅遊 ", 66)) + "…"},
		{"word ends at limit", strings.Repeat("a", 199) + " next", strings.Repeat("a", 199) + "…"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := shortenPreviewDescription(tc.input)
			if got != tc.expected || !utf8.ValidString(got) || utf8.RuneCountInString(got) > 200 {
				t.Fatalf("shortening = %q (%d characters), want %q", got, utf8.RuneCountInString(got), tc.expected)
			}
		})
	}
}

func TestSitePreviewRenderersUseTranslatedHomeCopyAndEscapeAttributes(t *testing.T) {
	siteName := `Travel "A" & B <C>`
	setupSitePreviewIdentity(t, siteName, "site-fintravel-ft-v1-16.png")
	t.Setenv("FILTEREST_FRONTEND_ASSET_MODE", "source")
	translations := map[string]map[string]string{
		"fi": {"site_front_page_slogan": `Lähelle "ja" kauas & yhdessä <matkalle>`},
		"en": {"site_front_page_slogan": `Near "and" far & together <travel>`},
	}
	var queries []string
	setupRootHandlerMockDBWithConfig(t, rootHandlerMockConfig{translations: translations, metadataQueries: &queries})
	setupRootHandlerSessionStore(t)
	faviconReads := 0
	configuredFaviconReader = func(context.Context, *sql.DB) string {
		faviconReads++
		return "site-fintravel-ft-v1-16.png"
	}
	for _, code := range []string{"fi", "en"} {
		for _, tc := range []struct {
			name, path string
			handler    http.HandlerFunc
		}{
			{"Home", "/", rootHandler},
			{"admin", "/admin/settings", adminHandler},
			{"sign-in shell", "/?login-entry=1", func(w http.ResponseWriter, r *http.Request) { tablesHandler(w, r, true, nil) }},
		} {
			t.Run(tc.name+"/"+code, func(t *testing.T) {
				queries, faviconReads = nil, 0
				r := httptest.NewRequest(http.MethodGet, "https://travel.example"+tc.path, nil)
				r.Header.Set("Accept-Language", code)
				response := httptest.NewRecorder()
				tc.handler(response, r)
				body := response.Body.String()
				if response.Code != http.StatusOK {
					t.Fatalf("renderer = %d", response.Code)
				}
				for _, expected := range []string{
					`<meta name="description" content="` + html.EscapeString(translations[code]["site_front_page_slogan"]) + `">`,
					`<meta property="og:description" content="` + html.EscapeString(translations[code]["site_front_page_slogan"]) + `">`,
					`<meta property="og:image:alt" content="` + html.EscapeString(siteName) + `">`,
					`<meta property="og:image" content="https://travel.example/frontend/icons/site_favicons/site-fintravel-ft-v1-128.png">`,
					`<meta property="og:image:width" content="128">`,
					`<meta property="og:image:height" content="128">`,
					`<link rel="icon" type="image/png" sizes="128x128" href="/frontend/icons/site_favicons/site-fintravel-ft-v1-128.png"`,
					`data-home-dark-href="/frontend/icons/site_favicons/site-fintravel-ft-v1-128-dark-v1.png"`,
				} {
					if !strings.Contains(body, expected) {
						t.Errorf("missing escaped metadata: %s", expected)
					}
				}
				translationReads := 0
				for _, query := range queries {
					if strings.Contains(query, "SELECT lang_key,") || strings.Contains(query, "WITH RECURSIVE locale_chain") {
						translationReads++
					}
					if strings.Contains(query, "WHERE lang_key =") {
						t.Fatalf("preview added a per-key query: %s", query)
					}
				}
				if translationReads != 2 || faviconReads != 1 {
					t.Fatalf("shell query budget changed: translations=%d (want 2), favicon=%d (want 1)", translationReads, faviconReads)
				}
			})
		}
	}
}

func TestSitePreviewGenericMetadataLocaleMatchesNegotiatedLanguage(t *testing.T) {
	setupSitePreviewIdentity(t, "Travel site", "site-fintravel-ft-v1-16.png")
	t.Setenv("FILTEREST_FRONTEND_ASSET_MODE", "source")
	languages := []struct{ code, locale, slogan string }{
		{"fi", "fi_FI", "Matkoja lähelle ja kauas"},
		{"en", "en_US", "Travel near and far"},
		{"ch", "zh_CN", "探索附近与远方"},
		{"yue", "yue_HK", "探索附近同遠方"},
		{"zh-CN", "zh_CN", "探索附近与远方"},
		{"zh-TW", "zh_TW", "探索附近與遠方"},
		{"zh-HK", "zh_HK", "探索附近及遠方"},
	}
	translations := make(map[string]map[string]string)
	var enabledLanguages []string
	for _, language := range languages {
		enabledLanguages = append(enabledLanguages, language.code)
		translations[language.code] = map[string]string{"site_front_page_slogan": language.slogan}
	}
	setupRootHandlerMockDBWithConfig(t, rootHandlerMockConfig{
		enabledLanguages: enabledLanguages, translations: translations,
	})
	setupRootHandlerSessionStore(t)
	for _, language := range languages {
		for _, source := range []string{"query", "header"} {
			for _, renderer := range []struct {
				name, path string
				handler    http.HandlerFunc
			}{
				{"Home", "/", rootHandler},
				{"admin", "/admin/settings", adminHandler},
				{"sign-in shell", "/?login-entry=1", func(w http.ResponseWriter, r *http.Request) { tablesHandler(w, r, true, nil) }},
			} {
				t.Run(language.code+"/"+source+"/"+renderer.name, func(t *testing.T) {
					request := httptest.NewRequest(http.MethodGet, "https://travel.example"+renderer.path, nil)
					if source == "query" {
						query := request.URL.Query()
						query.Set("lang", language.code)
						request.URL.RawQuery = query.Encode()
					} else {
						request.Header.Set("Accept-Language", language.code)
					}
					response := httptest.NewRecorder()
					renderer.handler(response, request)
					if response.Code != http.StatusOK {
						t.Fatalf("renderer = %d", response.Code)
					}
					for _, expected := range []string{
						`<html lang="` + language.code + `"`,
						`<meta property="og:locale" content="` + language.locale + `">`,
						`<meta name="description" content="` + language.slogan + `">`,
						`<meta property="og:description" content="` + language.slogan + `">`,
					} {
						if !strings.Contains(response.Body.String(), expected) {
							t.Errorf("missing negotiated metadata: %s", expected)
						}
					}
				})
			}
		}
	}
}

func TestSitePreviewMetadataUsesDescriptionAndNameWhenHomeCopyIsEmpty(t *testing.T) {
	setupSitePreviewIdentity(t, "Travel site", "")
	for _, tc := range []struct{ name, description, expected string }{
		{"short description", "Finnish & English trips", "Finnish & English trips"},
		{"long description", strings.Repeat("matka ", 40), strings.TrimSpace(strings.Repeat("matka ", 33)) + "…"},
		{"site name", "", "Travel site"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupRootHandlerMockDBWithConfig(t, rootHandlerMockConfig{translations: map[string]map[string]string{
				"en": {"site_front_page_description": tc.description},
			}})
			meta := resolvePageMetaForDataset(httptest.NewRequest(http.MethodGet, "https://travel.example/?lang=en", nil), nil)
			if meta.MetaDescription != tc.expected || meta.OGDescription != tc.expected {
				t.Fatalf("descriptions = %q / %q, want %q", meta.MetaDescription, meta.OGDescription, tc.expected)
			}
		})
	}
}

func TestSitePreviewKeepsDatasetDescriptionOrderLanguageAndRowPrivacy(t *testing.T) {
	setupSitePreviewIdentity(t, "Travel site", "")
	for _, tc := range []struct{ name, slogan, description, expected string }{
		{"dataset slogan", "Dataset slogan", "Dataset description", "Dataset slogan"},
		{"dataset description", "", "Dataset description", "Dataset description"},
		{"dataset title", "", "", "Dataset title"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var queries []string
			setupRootHandlerMockDBWithConfig(t, rootHandlerMockConfig{
				datasetDescription: tc.description, rowTitle: "Private row title", metadataQueries: &queries,
				translations: map[string]map[string]string{
					"fi": {"app_service_catalog": "Dataset title", "search_slogan_app_service_catalog": tc.slogan},
					"en": {"site_front_page_slogan": "Home copy must not replace dataset copy"},
				},
			})
			r := httptest.NewRequest(http.MethodGet, "https://travel.example/service_catalog/123-private-title", nil)
			r.Header.Set("Accept-Language", "fi;q=0.1,en;q=1")
			dataset := dataset_routes.DatasetNamePool{DatasetName: "app_service_catalog", PreferredName: "service_catalog", SchemaName: "public", TableUID: 7}
			meta := resolvePageMetaForDataset(r, &dataset)
			if meta.MetaDescription != tc.expected || meta.OGDescription != tc.expected || meta.LangCode != "fi" || meta.PageTitle != "Dataset title — Travel site" {
				t.Fatalf("dataset metadata changed: %+v", meta)
			}
			for _, query := range queries {
				if strings.Contains(query, "FROM system_column_details") || strings.Contains(query, "WHERE id = $1 LIMIT 1") {
					t.Fatalf("metadata read a row (WL140): %s", query)
				}
			}
		})
	}
}
