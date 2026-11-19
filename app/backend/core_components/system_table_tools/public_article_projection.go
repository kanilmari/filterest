// public_article_projection.go
// Turns one authorized article response into the title, description, picture and address words public pages print.
// Between the canonical reader's columns and field roles and the router's heads, sitemap and plain article pages.
// Reads only what the response carries, so a column the visitor may not see never reaches a page.
package system_table_tools

import (
	"encoding/json"
	"html"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"easelect/backend/core_components/dataset_routes"
)

// publicArticleField is one column of the response the visitor may see on an article.
type publicArticleField struct {
	column string
	raw    json.RawMessage
	meta   frontPageArticleColumn
	facts  publicArticleColumnFacts
}

// publicArticleColumnFacts holds the column metadata the public projection reads
// beyond what a Home button label needs. It is parsed leniently and separately,
// so an unexpected value type can never drop a column from the shared Home
// reading (frontPageArticleColumn) nor from this one.
type publicArticleColumnFacts struct {
	isHidden, restricted, notAuthorized, notSelectable, notShownOnCard bool
	dataType, foreignTable                                             string
	position                                                           float64 // co_number; +Inf when absent
}

func readPublicArticleColumnFacts(description json.RawMessage) publicArticleColumnFacts {
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(description, &raw)
	literal := func(key string) string { return strings.TrimSpace(string(raw[key])) }
	text := func(key string) string {
		var value string
		if json.Unmarshal(raw[key], &value) == nil {
			return strings.TrimSpace(value)
		}
		return ""
	}
	facts := publicArticleColumnFacts{
		isHidden: literal("is_hidden") == "true", restricted: literal("restricted") == "true",
		notAuthorized: literal("authorized") == "false", notSelectable: literal("selectable") == "false",
		notShownOnCard: literal("show_value_on_card") == "false",
		dataType:       strings.ToLower(text("data_type")), foreignTable: text("foreign_table"),
		position: math.Inf(1),
	}
	var number float64
	if json.Unmarshal(raw["co_number"], &number) == nil && number > 0 {
		facts.position = number
	} else if parsed, err := strconv.ParseFloat(text("co_number"), 64); err == nil && parsed > 0 {
		facts.position = parsed
	}
	return facts
}

var hiddenArticleRole = regexp.MustCompile(`^hidden\d*$`)
var structuredStorageName = regexp.MustCompile(`^(\d+)_(\d+)_(\d+)\.(\w+)$`)

// publicArticleTitleNames are the column names the app infers a title from when
// no field is marked as the header: EXACT_NAMES in
// app/frontend/core_components/table_views/record_title_resolver.js.
var publicArticleTitleNames = []string{"display_name", "name", "title", "key"}

// articleTranslator answers one language key's copy in one language; it is how
// a header marked as a language key becomes the title's words.
type articleTranslator func(language, key string) string

// projectPublicArticle reads one row of an authorized Article response.
// language is the page's language; languages are the site's enabled languages,
// in each of which the title's address words are built.
func projectPublicArticle(result frontPageArticleResult, language string, languages []string, translate articleTranslator) PublicArticle {
	if len(result.Data) != 1 {
		return PublicArticle{}
	}
	row := result.Data[0]
	article := PublicArticle{ID: articleRowID(row)}
	if article.ID == "" {
		return PublicArticle{}
	}
	fields := publicArticleVisibleFields(result)

	title, titleField := publicArticleTitle(fields, language, translate)
	article.Title = title
	if titleField != nil {
		article.TitleLanguages = articleValueLanguages(titleField.raw, titleField.meta.IsMultilingual)
		if _, languageKey := articleHeaderRole(titleField.meta.CardElement); languageKey {
			// A language-key title exists in every language its key is translated into.
			key := articleDisplayValue(titleField.raw, titleField.meta.IsMultilingual, language)
			article.TitleLanguages = nil
			for _, code := range languages {
				if strings.TrimSpace(translate(code, key)) != "" {
					article.TitleLanguages = append(article.TitleLanguages, code)
				}
			}
		}
		if len(article.TitleLanguages) > 0 {
			article.TitleLanguage = articleChosenLanguage(article.TitleLanguages, language)
		}
	}
	article.Slugs = make(map[string]string, len(languages)+1)
	if title != "" {
		article.Slugs[language] = dataset_routes.ArticleSlug(title)
		for _, code := range languages {
			if translated, _ := publicArticleTitle(fields, code, translate); translated != "" {
				article.Slugs[code] = dataset_routes.ArticleSlug(translated)
			}
		}
	}

	if description := firstFieldWithRole(fields, "description"); description != nil {
		value := articleDisplayValue(description.raw, description.meta.IsMultilingual, language)
		article.Paragraphs = articleParagraphs(value)
		article.Description = strings.Join(article.Paragraphs, " ")
	}
	if image := firstFieldWithRole(fields, "image"); image != nil {
		article.ImagePath = articleImagePath(articleDisplayValue(image.raw, boolPointer(false), language))
	}
	for _, field := range fields {
		if field.column == "updated" || field.column == "updated_at" {
			var stamp string
			if json.Unmarshal(field.raw, &stamp) == nil {
				if parsed, err := time.Parse(time.RFC3339Nano, stamp); err == nil {
					article.Updated = parsed
				}
			}
			break
		}
	}
	return article
}

// publicArticleVisibleFields keeps the columns the app would show a visitor on an
// article, in the response's order. The checks are the article half of
// isRecordTitleColumnVisible in record_title_resolver.js. The visitor never
// owns a row, so a field shown only to its owner is always left out.
func publicArticleVisibleFields(result frontPageArticleResult) []publicArticleField {
	row := result.Data[0]
	fields := make([]publicArticleField, 0, len(result.Columns))
	for _, column := range result.Columns {
		raw, present := row[column]
		var meta frontPageArticleColumn
		if !present || json.Unmarshal(result.Types[column], &meta) != nil {
			continue
		}
		facts := readPublicArticleColumnFacts(result.Types[column])
		if meta.HideEverywhere || meta.HideUnlessOwn || facts.isHidden || facts.restricted ||
			facts.notAuthorized || facts.notSelectable || facts.notShownOnCard ||
			(meta.ClientDeliveryMode != "" && meta.ClientDeliveryMode != "include") {
			continue
		}
		hidden := false
		for _, role := range articleBaseRoles(meta.CardElement) {
			hidden = hidden || hiddenArticleRole.MatchString(role)
		}
		if !hidden {
			fields = append(fields, publicArticleField{column: column, raw: raw, meta: meta, facts: facts})
		}
	}
	return fields
}

// publicArticleTitle answers the article's title in language: the first header
// field with a value, as the Home article buttons read it, and otherwise a
// plain single-line text column named as the app's title inference names
// them. Rarer inferences of the app (relation labels, other columns) give no
// title here; a page then keeps the dataset's own title and no address words.
func publicArticleTitle(fields []publicArticleField, language string, translate articleTranslator) (string, *publicArticleField) {
	for index := range fields {
		field := &fields[index]
		header, languageKey := articleHeaderRole(field.meta.CardElement)
		if !header {
			continue
		}
		value := articleDisplayValue(field.raw, field.meta.IsMultilingual, language)
		if field.meta.HideFalseNull && (string(field.raw) == "false" || value == "false" || value == "null") {
			continue
		}
		if languageKey && value != "" {
			value = strings.TrimSpace(translate(language, value))
		}
		if value != "" {
			return value, field
		}
	}
	for _, name := range publicArticleTitleNames {
		for _, index := range fieldsByPhysicalOrder(fields) {
			field := &fields[index]
			if strings.ToLower(field.column) != name || field.facts.foreignTable != "" {
				continue
			}
			if roleExcludedFromInferredTitle(field.meta.CardElement) {
				continue
			}
			dataType := field.facts.dataType
			multilingual := articleValueLanguages(field.raw, field.meta.IsMultilingual) != nil
			if strings.Contains(dataType, "json") && !(multilingual && field.meta.IsMultilingual != nil && *field.meta.IsMultilingual) {
				continue
			}
			if !multilingual && !strings.Contains(dataType, "text") && !strings.Contains(dataType, "char") {
				continue
			}
			value := articleDisplayValue(field.raw, field.meta.IsMultilingual, language)
			if value == "" || strings.ContainsAny(value, "\r\n") || utf8.RuneCountInString(value) > 160 ||
				strings.HasPrefix(value, "{") || strings.HasPrefix(value, "[") {
				continue
			}
			if field.meta.HideFalseNull && (value == "false" || value == "null") {
				continue
			}
			return value, field
		}
	}
	return "", nil
}

func roleExcludedFromInferredTitle(roles string) bool {
	for _, role := range articleBaseRoles(roles) {
		trimmed := strings.TrimRight(role, "0123456789")
		if trimmed == "image" || trimmed == "keywords" || trimmed == "description" {
			return true
		}
	}
	return false
}

// fieldsByPhysicalOrder orders fields by the dataset's stable column order, as
// the app's title inference does; ties keep the response order.
func fieldsByPhysicalOrder(fields []publicArticleField) []int {
	indexes := make([]int, len(fields))
	for i := range indexes {
		indexes[i] = i
	}
	sort.SliceStable(indexes, func(a, b int) bool { return fields[indexes[a]].facts.position < fields[indexes[b]].facts.position })
	return indexes
}

// firstFieldWithRole picks the field the article shows first for a role: the
// lowest number after the role name (description2 before description10, an
// unnumbered role last), ties in response order, skipping empty values.
func firstFieldWithRole(fields []publicArticleField, base string) *publicArticleField {
	var best *publicArticleField
	bestNumber := math.MaxInt
	for index := range fields {
		field := &fields[index]
		for _, role := range articleBaseRoles(field.meta.CardElement) {
			if strings.TrimRight(role, "0123456789") != base {
				continue
			}
			if articleDisplayValue(field.raw, field.meta.IsMultilingual, "en") == "" {
				continue
			}
			number := roleSuffixNumber(role)
			if best == nil || number < bestNumber {
				best, bestNumber = field, number
			}
		}
	}
	return best
}

// roleSuffixNumber is extractSuffixNumber in row_article_content_builder_helpers.js.
func roleSuffixNumber(role string) int {
	start := strings.IndexAny(role, "0123456789")
	if start < 0 {
		return math.MaxInt
	}
	end := start
	for end < len(role) && role[end] >= '0' && role[end] <= '9' {
		end++
	}
	number := 0
	for _, digit := range role[start:end] {
		if number > (math.MaxInt-9)/10 {
			return math.MaxInt
		}
		number = number*10 + int(digit-'0')
	}
	return number
}

func articleBaseRoles(roles string) []string {
	parts := strings.Split(roles, ",")
	bases := make([]string, 0, len(parts))
	for _, role := range parts {
		base, _, _ := strings.Cut(strings.TrimSpace(role), "+")
		if base = strings.TrimSpace(base); base != "" {
			bases = append(bases, base)
		}
	}
	return bases
}

// articleValueLanguages lists the languages a multilingual value holds text in,
// in the value's own order, recognising a language map exactly as
// articleDisplayValue does. A plain value gives nil.
func articleValueLanguages(raw json.RawMessage, multilingual *bool) []string {
	if len(raw) == 0 || string(raw) == "null" || (multilingual != nil && !*multilingual) {
		return nil
	}
	value := strings.TrimSpace(string(raw))
	var text string
	if json.Unmarshal(raw, &text) == nil {
		value = strings.TrimSpace(text)
	}
	if !strings.HasPrefix(value, "{") {
		return nil
	}
	decoder := json.NewDecoder(strings.NewReader(value))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return nil
	}
	var languages []string
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil
		}
		key, _ := token.(string)
		var candidate json.RawMessage
		if decoder.Decode(&candidate) != nil {
			return nil
		}
		isText := json.Unmarshal(candidate, &text) == nil
		if multilingual == nil && (!articleLanguageKey.MatchString(key) || !isText) {
			return nil
		}
		if isText && strings.TrimSpace(text) != "" {
			languages = append(languages, key)
		}
	}
	return languages
}

// articleChosenLanguage is the language articleDisplayValue's fallback chain
// picks from the value's languages: the requested one, its base language,
// English, then the value's first.
func articleChosenLanguage(languages []string, requested string) string {
	requested = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(requested), "_", "-"))
	if requested == "" {
		requested = "en"
	}
	base, _, _ := strings.Cut(requested, "-")
	for _, wanted := range []string{requested, base, "en"} {
		for _, available := range languages {
			if available == wanted {
				return available
			}
		}
	}
	if len(languages) > 0 {
		return languages[0]
	}
	return ""
}

// articleImagePath is resolveImagePath in row_article_content_builder_helpers.js:
// an address or rooted path stays, a structured stored name goes to its row
// folder, and any other name to the storage root.
func articleImagePath(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
		return ""
	}
	if strings.HasPrefix(trimmed, "https://") || strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "/") {
		return trimmed
	}
	if strings.HasPrefix(trimmed, "./") {
		return ""
	}
	name := trimmed
	if cut := strings.IndexAny(name, "?#"); cut >= 0 {
		name = name[:cut]
	}
	if match := structuredStorageName.FindStringSubmatch(name); match != nil {
		return "/storage/" + match[1] + "/" + match[2] + "/original/" + trimmed
	}
	return "/storage/" + trimmed
}

var articleBlockBoundary = map[string]bool{
	"p": true, "br": true, "div": true, "li": true, "ul": true, "ol": true, "blockquote": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true, "tr": true, "table": true,
	"section": true, "article": true, "pre": true, "hr": true, "figure": true, "figcaption": true,
}

var articleSkippedContent = map[string]bool{"script": true, "style": true, "template": true, "noscript": true}

// articleParagraphs turns a stored rich-text or plain value into plain-text
// paragraphs. Markup is removed, never passed on: pages print the result through
// html/template, which escapes it. Block elements and blank lines separate
// paragraphs; script and style content is dropped.
func articleParagraphs(value string) []string {
	var paragraphs []string
	var current strings.Builder
	flush := func() {
		text := strings.Join(strings.Fields(html.UnescapeString(current.String())), " ")
		if text != "" {
			paragraphs = append(paragraphs, text)
		}
		current.Reset()
	}
	skipping := ""
	for index := 0; index < len(value); {
		character := value[index]
		if character == '<' {
			end := strings.IndexByte(value[index:], '>')
			if end < 0 {
				break
			}
			tag := strings.ToLower(strings.TrimSpace(value[index+1 : index+end]))
			closing := strings.HasPrefix(tag, "/")
			name := strings.TrimLeft(tag, "/")
			if cut := strings.IndexAny(name, " \t\r\n/"); cut >= 0 {
				name = name[:cut]
			}
			index += end + 1
			if skipping != "" {
				if closing && name == skipping {
					skipping = ""
				}
				continue
			}
			if !closing && articleSkippedContent[name] {
				skipping = name
				continue
			}
			if articleBlockBoundary[name] {
				flush()
			} else {
				current.WriteByte(' ')
			}
			continue
		}
		if skipping != "" {
			index++
			continue
		}
		if character == '\n' && nextLineIsBlank(value[index+1:]) {
			flush()
		}
		current.WriteByte(character)
		index++
	}
	flush()
	return paragraphs
}

// nextLineIsBlank reports whether the text up to the next line break is only
// whitespace, so a blank line in a plain-text value separates paragraphs.
func nextLineIsBlank(rest string) bool {
	if end := strings.IndexByte(rest, '\n'); end >= 0 {
		rest = rest[:end]
	}
	return strings.TrimSpace(rest) == ""
}

func boolPointer(value bool) *bool { return &value }
