// public_article_projection_test.go
// Pins how one authorized Article response becomes a public page's title, description, picture and address words.
// Covers field roles, hidden and owner-only fields, multilingual values and the plain-text conversion.
package system_table_tools

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func projectionResult(columns []string, types map[string]string, row map[string]string) frontPageArticleResult {
	result := frontPageArticleResult{Columns: columns, Types: map[string]json.RawMessage{}, Data: []map[string]json.RawMessage{{}}}
	for column, description := range types {
		result.Types[column] = json.RawMessage(description)
	}
	for column, value := range row {
		result.Data[0][column] = json.RawMessage(value)
	}
	return result
}

func TestProjectPublicArticleReadsRolesInTheirArticleOrder(t *testing.T) {
	result := projectionResult(
		[]string{"id", "title", "teaser", "body", "cached_image", "updated"},
		map[string]string{
			"id":           `{"card_element":"details"}`,
			"title":        `{"card_element":"header","is_multilingual":true}`,
			"teaser":       `{"card_element":"description9","is_multilingual":true}`,
			"body":         `{"card_element":"description2","is_multilingual":true}`,
			"cached_image": `{"card_element":"image"}`,
			"updated":      `{"card_element":"details10"}`,
		},
		map[string]string{
			"id":           `"287"`,
			"title":        `"{\"en\":\"Helsinki to Vienna\",\"fi\":\"Helsingistä Wieniin\"}"`,
			"teaser":       `"{\"en\":\"Short teaser\"}"`,
			"body":         `{"en":"<p>First paragraph &amp; more.</p><p>Second <b>bold</b> one.</p><script>alert(1)</script>","fi":"<p>Suomeksi.</p>"}`,
			"cached_image": `"10007_159_177.jpg"`,
			"updated":      `"2026-10-08T12:30:00Z"`,
		},
	)
	article := projectPublicArticle(result, "en", []string{"en", "fi"}, noTranslations)
	if article.ID != "287" || article.Title != "Helsinki to Vienna" || article.TitleLanguage != "en" {
		t.Fatalf("title: %+v", article)
	}
	if !reflect.DeepEqual(article.Slugs, map[string]string{"en": "helsinki-to-vienna", "fi": "helsingista-wieniin"}) {
		t.Fatalf("slugs = %v", article.Slugs)
	}
	if !reflect.DeepEqual(article.Paragraphs, []string{"First paragraph & more.", "Second bold one."}) {
		t.Fatalf("paragraphs = %q (description2 comes before description9; script content is dropped)", article.Paragraphs)
	}
	if article.ImagePath != "/storage/10007/159/original/10007_159_177.jpg" {
		t.Fatalf("image = %q", article.ImagePath)
	}
	if article.Updated.IsZero() || article.Updated.Year() != 2026 {
		t.Fatalf("updated = %v", article.Updated)
	}
	finnish := projectPublicArticle(result, "fi", []string{"en", "fi"}, noTranslations)
	if finnish.Title != "Helsingistä Wieniin" || finnish.TitleLanguage != "fi" || finnish.Description != "Suomeksi." {
		t.Fatalf("Finnish: %+v", finnish)
	}
	// A language the row lacks falls back the way the application does, and says so.
	swedish := projectPublicArticle(result, "sv", []string{"en", "fi"}, noTranslations)
	if swedish.Title != "Helsinki to Vienna" || swedish.TitleLanguage != "en" {
		t.Fatalf("fallback: %+v", swedish)
	}
}

func TestProjectPublicArticleLeavesOutWhatAVisitorMayNotSee(t *testing.T) {
	for name, description := range map[string]string{
		"hidden everywhere": `{"card_element":"header","hide_everywhere":true}`,
		"owner only":        `{"card_element":"header","hide_on_bg_crd_if_not_own":true}`,
		"server only":       `{"card_element":"header","client_delivery_mode":"server_only"}`,
		"not authorized":    `{"card_element":"header","authorized":false}`,
		"hidden role":       `{"card_element":"header,hidden"}`,
		"is hidden":         `{"card_element":"header","is_hidden":true}`,
	} {
		result := projectionResult([]string{"id", "secret"},
			map[string]string{"id": `{}`, "secret": description},
			map[string]string{"id": `1`, "secret": `"The private title"`})
		article := projectPublicArticle(result, "en", []string{"en"}, noTranslations)
		if article.Title != "" || len(article.Slugs) != 0 {
			t.Errorf("%s: printed %+v", name, article)
		}
	}
}

func TestProjectPublicArticleToleratesUnexpectedMetadataTypes(t *testing.T) {
	result := projectionResult([]string{"id", "title"},
		map[string]string{"id": `{}`, "title": `{"card_element":"header","co_number":"5","authorized":"yes","data_type":7}`},
		map[string]string{"id": `"9"`, "title": `"Plain title"`})
	if article := projectPublicArticle(result, "en", nil, noTranslations); article.Title != "Plain title" {
		t.Fatalf("an odd metadata value dropped the title: %+v", article)
	}
}

func TestProjectPublicArticleInfersAPlainTitleColumnLikeTheApplication(t *testing.T) {
	result := projectionResult([]string{"id", "description", "title"},
		map[string]string{
			"id":          `{"card_element":"details","data_type":"integer","co_number":1}`,
			"description": `{"card_element":"details","data_type":"text","co_number":2}`,
			"title":       `{"card_element":"details","data_type":"text","is_multilingual":true,"co_number":3}`,
		},
		map[string]string{"id": `1`, "description": `"Not a title"`, "title": `"{\"en\":\"Save up to 20 percent\",\"fi\":\"Säästä jopa 20 prosenttia\"}"`})
	article := projectPublicArticle(result, "fi", []string{"en", "fi"}, noTranslations)
	if article.Title != "Säästä jopa 20 prosenttia" || article.Slugs["en"] != "save-up-to-20-percent" {
		t.Fatalf("inferred title: %+v", article)
	}

	long := projectionResult([]string{"id", "name"},
		map[string]string{"id": `{}`, "name": `{"card_element":"details","data_type":"text"}`},
		map[string]string{"id": `1`, "name": `"` + strings.Repeat("x", 161) + `"`})
	if article := projectPublicArticle(long, "en", nil, noTranslations); article.Title != "" {
		t.Fatalf("a 161-character value became a title: %q", article.Title)
	}
	relation := projectionResult([]string{"id", "name"},
		map[string]string{"id": `{}`, "name": `{"card_element":"details","data_type":"text","foreign_table":"people"}`},
		map[string]string{"id": `1`, "name": `"42"`})
	if article := projectPublicArticle(relation, "en", nil, noTranslations); article.Title != "" {
		t.Fatalf("a relation id became a title: %q", article.Title)
	}
}

func TestArticleImagePathFollowsTheApplicationsResolver(t *testing.T) {
	for value, want := range map[string]string{
		"117_12_3.jpg":                "/storage/117/12/original/117_12_3.jpg",
		"117_12_3.jpg?v=2":            "/storage/117/12/original/117_12_3.jpg?v=2",
		"/storage/media/7/1000/x.jpg": "/storage/media/7/1000/x.jpg",
		"https://example.com/a.png":   "https://example.com/a.png",
		"logo.svg":                    "/storage/logo.svg",
		"":                            "",
		"{\"file\":1}":                "",
	} {
		if got := articleImagePath(value); got != want {
			t.Errorf("articleImagePath(%q) = %q, want %q", value, got, want)
		}
	}
}

func TestArticleParagraphsSplitPlainTextOnBlankLines(t *testing.T) {
	got := articleParagraphs("First line\ncontinues here.\n\nSecond paragraph.\r\n\r\nThird &lt;not a tag&gt;")
	want := []string{"First line continues here.", "Second paragraph.", "Third <not a tag>"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("paragraphs = %q, want %q", got, want)
	}
}

func noTranslations(language, key string) string { return "" }

func TestProjectPublicArticleTranslatesALanguageKeyHeader(t *testing.T) {
	result := projectionResult([]string{"id", "label"},
		map[string]string{"id": `{}`, "label": `{"card_element":"header+lang_key","is_multilingual":false}`},
		map[string]string{"id": `5`, "label": `"contact_page_title"`})
	translate := func(language, key string) string {
		if key != "contact_page_title" {
			return ""
		}
		return map[string]string{"fi": "Ota yhteyttä", "en": "Contact"}[language]
	}
	article := projectPublicArticle(result, "fi", []string{"en", "fi"}, translate)
	if article.Title != "Ota yhteyttä" || article.Slugs["en"] != "contact" || article.Slugs["fi"] != "ota-yhteytta" ||
		strings.Join(article.TitleLanguages, ",") != "en,fi" || article.TitleLanguage != "fi" {
		t.Fatalf("language-key title: %+v", article)
	}
}

// A heading stored with markup, as fintravel.fi's "<h1>...</h1>" blog title, reads
// as its words in page heads and lists, and its address words are those words,
// never "h1…h1" from the markup. How markup reads is pinned by the examples in
// app/testing/shared_contracts/heading_text_examples.json.
func TestProjectPublicArticleReadsAMarkedUpHeadingAsText(t *testing.T) {
	result := projectionResult(
		[]string{"id", "title"},
		map[string]string{"id": `{"card_element":"details"}`, "title": `{"card_element":"header"}`},
		map[string]string{"id": `"3"`, "title": `"<h1>An unexpected payment request? Check &amp; pay</h1>"`},
	)
	article := projectPublicArticle(result, "en", []string{"en"}, noTranslations)
	if article.Title != "An unexpected payment request? Check & pay" {
		t.Fatalf("title = %q", article.Title)
	}
	if article.Slugs["en"] != "an-unexpected-payment-request-check-pay" {
		t.Fatalf("address words = %q, want the words of the title the reader sees", article.Slugs["en"])
	}
}

// The app passes over a heading whose markup has no words to show, or reads as
// a hidden false or null, and names the record by the next title. The address
// words are that title's words too; an older address is redirected to them.
func TestProjectPublicArticleSkipsAHeadingWithNoWordsAndAddressesTheShownTitle(t *testing.T) {
	types := map[string]string{
		"id":     `{"card_element":"details"}`,
		"kicker": `{"card_element":"header","hide_false_null_on_big_crd":true}`,
		"title":  `{"card_element":"header"}`,
		"name":   `{"card_element":"details","data_type":"text"}`,
	}
	for _, c := range []struct{ kicker, title, wantTitle, wantWords string }{
		{"<h2> </h2>", "<h1>Hotel <em>news</em></h1>", "Hotel news", "hotel-news"},
		{"<style>ignored</style>", "Plain title", "Plain title", "plain-title"},
		{"<b>False</b>", "Plain title", "Plain title", "plain-title"},
		{"<h2> </h2>", "<br>", "Inferred name", "inferred-name"},
		{"Vector<T>", "Plain title", "Vector<T>", "vectort"},
	} {
		kicker, _ := json.Marshal(c.kicker)
		title, _ := json.Marshal(c.title)
		result := projectionResult([]string{"id", "kicker", "title", "name"}, types,
			map[string]string{"id": `"4"`, "kicker": string(kicker), "title": string(title), "name": `"Inferred name"`})
		article := projectPublicArticle(result, "en", []string{"en"}, noTranslations)
		if article.Title != c.wantTitle || article.Slugs["en"] != c.wantWords {
			t.Errorf("headers %q, %q: title = %q, address words = %q; want %q, %q",
				c.kicker, c.title, article.Title, article.Slugs["en"], c.wantTitle, c.wantWords)
		}
	}
}

// Each language's address words stand on their own: a title with no words in
// the page's language must not take away the other languages' words, which the
// sitemap and the language links print.
func TestProjectPublicArticleKeepsOtherLanguagesWordsWhenThisLanguageHasNone(t *testing.T) {
	types := map[string]string{"id": `{"card_element":"details"}`, "title": `{"card_element":"header","data_type":"text"}`}
	stored, _ := json.Marshal(`{"en":"<h1> </h1>","fi":"<h1>Hotelliuutiset</h1>"}`)
	result := projectionResult([]string{"id", "title"}, types, map[string]string{"id": `"3"`, "title": string(stored)})
	article := projectPublicArticle(result, "en", []string{"en", "fi"}, noTranslations)
	if article.Slugs["fi"] != "hotelliuutiset" || article.Slugs["en"] != "" {
		t.Fatalf("address words = %v, want fi hotelliuutiset and no English words", article.Slugs)
	}
}

// A stored text can begin with a byte-order mark, as the first cell of an
// imported file does. The app's trim takes the mark away before it looks for a
// language map or for markup, so the server must not print the raw map as the
// title, nor read "<b" plus the mark as the start of a tag. The titles and
// address words are what the app's resolveRecordTitle and buildSlug return.
func TestProjectPublicArticleReadsATitleBehindAByteOrderMark(t *testing.T) {
	types := map[string]string{"id": `{"card_element":"details"}`, "title": `{"card_element":"header","data_type":"text"}`}
	for _, c := range []struct{ stored, language, wantTitle, wantWords string }{
		{"\ufeff{\"en\":\"Helsinki\",\"fi\":\"Helsingfors\"}", "en", "Helsinki", "helsinki"},
		{"\ufeff{\"en\":\"Helsinki\",\"fi\":\"Helsingfors\"}", "fi", "Helsingfors", "helsingfors"},
		{"{\"en\":\"Helsinki\",\"fi\":\"Helsingfors\"}\ufeff", "en", "Helsinki", "helsinki"},
		{"\ufeff<h1>Title</h1>", "en", "Title", "title"},
		{"Price <b\ufeff", "en", "Price <b", "price-b"},
	} {
		stored, _ := json.Marshal(c.stored)
		result := projectionResult([]string{"id", "title"}, types, map[string]string{"id": `"5"`, "title": string(stored)})
		article := projectPublicArticle(result, c.language, []string{"en", "fi"}, noTranslations)
		if article.Title != c.wantTitle || article.Slugs[c.language] != c.wantWords {
			t.Errorf("stored %q in %s: title = %q, address words = %q; want %q, %q",
				c.stored, c.language, article.Title, article.Slugs[c.language], c.wantTitle, c.wantWords)
		}
		if strings.Contains(c.stored, "Helsingfors") && !reflect.DeepEqual(article.TitleLanguages, []string{"en", "fi"}) {
			t.Errorf("stored %q: title languages = %v, want the map's two languages", c.stored, article.TitleLanguages)
		}
	}
}

// The app takes no title from a list or from an object that is not a language
// map: it names the record by the next title. Printed as it is stored, such a
// value would put JSON brackets into the page title and the address.
func TestProjectPublicArticlePassesOverAListOrObjectHeader(t *testing.T) {
	types := map[string]string{
		"id":     `{"card_element":"details"}`,
		"kicker": `{"card_element":"header","data_type":"text"}`,
		"title":  `{"card_element":"header","data_type":"text"}`,
	}
	for _, c := range []struct{ kicker, wantTitle, wantWords string }{
		{`["Title"]`, "Plain title", "plain-title"},
		{`["<b>x</b>"]`, "Plain title", "plain-title"},
		{`[]`, "Plain title", "plain-title"},
		{`{"a":1}`, "Plain title", "plain-title"},
		{`{"en":"Kicker","fi":"Kiilto"}`, "Kicker", "kicker"},
		{`5`, "5", "5"},
	} {
		result := projectionResult([]string{"id", "kicker", "title"}, types,
			map[string]string{"id": `"6"`, "kicker": c.kicker, "title": `"Plain title"`})
		article := projectPublicArticle(result, "en", []string{"en", "fi"}, noTranslations)
		if article.Title != c.wantTitle || article.Slugs["en"] != c.wantWords {
			t.Errorf("first header %s: title = %q, address words = %q; want %q, %q",
				c.kicker, article.Title, article.Slugs["en"], c.wantTitle, c.wantWords)
		}
	}
}
