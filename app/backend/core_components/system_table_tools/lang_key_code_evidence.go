// lang_key_code_evidence.go
// Recognizes reviewed key helpers, narrow declarations and existing-key literals.
// Connects source-file candidates to the registry without creating language keys.
// Keeps short helpers scoped and comments out of definite code evidence only.
package system_table_tools

import (
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Short names are meaningful only in these verified owners. Argument positions
// are zero-based. frontPageStatus takes a test id, the cloud view's t uses a
// local dictionary, and the article-button copy/field/report take suffixes;
// none is a full-key helper. nameRefusal has no maintained definition.
var langKeyHelperOwners = map[string]map[string]int{
	"filterbar/top_row_buttons/sort_default_scope_modal_builder.js": {"t": 0},
	"filterbar/top_row_buttons/dataset_sort_default_controller.js":  {"t": 0},
	"filterbar/filter_list/column_view_preset_builder.js":           {"t": 0},
	"admin_tools/row_group_assignment_editor.js":                    {"text": 0, "element": 1, "field": 1},
	"admin_tools/dataset_default_view_row.js":                       {"text": 0},
	"admin_tools/site_label_value_layout_control.js":                {"text": 0},
	"user_tools/profile_security_printer.js":                        {"text": 0, "label": 1},
	"table_views/article_view/article_language_editor.js":           {"copy": 0},
	"table_views/price_chart_view/price_chart_view_printer.js":      {"copy": 0},
	"admin_tools/front_page_settings_view.js":                       {"report": 0},
	"filterbar/filter_list/row_group_facet_card_builder.js":         {"createPanelText": 1},
	"auth/profile_update.go":                                        {"profileFailure": 2},
	"workline_observatory/publication_handlers.go":                  {"respondPublicationRefusal": 2},
	"email/account_email.go":                                        {"copy": 0},
}

var frontPageKeyHelpers = map[string]int{
	"frontPageText": 0, "frontPageLabel": 1, "frontPageButton": 0,
	"frontPageField": 0, "frontPageSection": 0,
}

type langKeyCodeLexeme struct {
	text, value string
	quoted      bool
	dynamic     bool
}

// lexLangKeyCode recognizes lexical boundaries, not language semantics. In JS,
// regexes and template expressions need their own handling: treating JS as Go
// would mistake quotes in a regex for strings and swallow later real evidence.
// Incomplete strings resume at a line boundary; the overlapping literal pass
// below also protects recall when a plausible closing quote was the wrong one.
func lexLangKeyCode(content string, ext string, visitComments ...func(string)) (string, []langKeyCodeLexeme) {
	clean := []byte(content)
	var tokens []langKeyCodeLexeme
	mask := func(start, end int) {
		for i := start; i < end; i++ {
			if clean[i] != '\n' {
				clean[i] = ' '
			}
		}
	}
	identifier := func(c byte) bool {
		return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '$'
	}
	var scan func(int, bool) int
	scan = func(start int, expression bool) int {
		depth := 0
		previous := ""
		var controlParens []bool
		for i := start; i < len(content); {
			c := content[i]
			if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
				i++
				continue
			}
			if ext == ".html" && strings.HasPrefix(content[i:], "<!--") {
				end := strings.Index(content[i+4:], "-->")
				if end < 0 {
					mask(i, len(content))
					return len(content)
				}
				end += i + 7
				mask(i, end)
				i = end
				continue
			}
			if strings.HasPrefix(content[i:], "//") || strings.HasPrefix(content[i:], "/*") {
				end := len(content)
				if content[i+1] == '/' {
					if offset := strings.IndexByte(content[i:], '\n'); offset >= 0 {
						end = i + offset
					}
				} else if offset := strings.Index(content[i+2:], "*/"); offset >= 0 {
					end = i + offset + 4
				}
				for _, visit := range visitComments {
					visit(content[i:end])
				}
				mask(i, end)
				i = end
				continue
			}
			if expression && c == '}' && depth == 0 {
				return i + 1
			}
			if c == '\'' || c == '"' || c == '`' {
				quote, begin := c, i
				i++
				segment := i
				var expressions []langKeyCodeLexeme
				dynamic := false
				for i < len(content) {
					if quote != '`' && (content[i] == '\n' || content[i] == '\r') {
						break
					}
					if content[i] == '\\' && (quote != '`' || ext != ".go") {
						if i+1 < len(content) && quote != '`' && (content[i+1] == '\n' || content[i+1] == '\r') {
							i++
							break
						}
						i += 2
						continue
					}
					if quote == '`' && ext != ".go" && strings.HasPrefix(content[i:], "${") {
						dynamic = true
						// Preserve interpolation tokens separately while keeping the outer
						// template one token, so it cannot be an exact literal by accident.
						saved := tokens
						tokens = nil
						i = scan(i+2, true)
						expressions = append(expressions, tokens...)
						tokens = saved
						continue
					}
					if content[i] == quote {
						break
					}
					i++
				}
				if i >= len(content) || content[i] != quote {
					// A malformed quote must not end the scan. Even a multiline
					// template/raw string with no closing backtick resumes at its
					// first line end, so subsequent comments are still masked.
					if quote == '`' {
						if offset := strings.IndexAny(content[begin+1:], "\r\n"); offset >= 0 {
							i = begin + 1 + offset
						}
					}
					tokens = append(tokens, expressions...)
					previous = ""
					continue
				}
				raw := content[segment:i]
				value := langKeyQuotedValue(raw, quote)
				tokens = append(tokens, langKeyCodeLexeme{text: content[begin : i+1], value: value, quoted: true, dynamic: dynamic})
				tokens = append(tokens, expressions...)
				i++
				previous = "literal"
				continue
			}
			// A slash can start a regex only where an expression can begin. Ignore
			// quoted-looking characters inside its character classes and escapes.
			if c == '/' && ext == ".js" && (previous == "" || strings.Contains("=(:,[!&|?{;", previous) || previous == "return" || previous == "case" || previous == "throw" || previous == ">" || previous == "control)") {
				begin, inClass := i, false
				i++
				for i < len(content) && content[i] != '\n' {
					if content[i] == '\\' {
						i += 2
						continue
					}
					if content[i] == '[' {
						inClass = true
					}
					if content[i] == ']' {
						inClass = false
					}
					if content[i] == '/' && !inClass {
						i++
						break
					}
					i++
				}
				for i < len(content) && identifier(content[i]) {
					i++
				}
				if i > len(content) {
					i = len(content)
				}
				tokens = append(tokens, langKeyCodeLexeme{text: content[begin:i]})
				previous = "regex"
				continue
			}
			if identifier(c) {
				end := i + 1
				for end < len(content) && identifier(content[end]) {
					end++
				}
				previous = content[i:end]
				tokens = append(tokens, langKeyCodeLexeme{text: previous})
				i = end
				continue
			}
			if c == '{' {
				depth++
			}
			if c == '}' {
				depth--
			}
			if c == '(' {
				controlParens = append(controlParens, previous == "if" || previous == "while" || previous == "for" || previous == "with" || previous == "switch" || previous == "catch")
			}
			previous = string(c)
			if c == ')' && len(controlParens) > 0 {
				if controlParens[len(controlParens)-1] {
					previous = "control)"
				}
				controlParens = controlParens[:len(controlParens)-1]
			}
			tokens = append(tokens, langKeyCodeLexeme{text: string(c)})
			i++
		}
		return len(content)
	}
	scan(0, false)
	return string(clean), tokens
}

func langKeyQuotedValue(raw string, quote byte) string {
	if quote == '`' {
		return raw
	}
	var decoded strings.Builder
	for rest := raw; rest != ""; {
		value, _, tail, err := strconv.UnquoteChar(rest, quote)
		if err != nil {
			return ""
		}
		decoded.WriteRune(value)
		rest = tail
	}
	return decoded.String()
}

// visitLangKeyLineLiterals reads raw file text and tries every unescaped
// opening quote, including one already used as a closing quote. This overlap
// avoids inheriting regex/comment/string classification from the main lexer.
// D3a includes comments: false hits only keep existing keys alive, and these
// candidates are code_literal only.
func visitLangKeyLineLiterals(content string, visit func(string)) {
	for _, line := range strings.FieldsFunc(content, func(c rune) bool { return c == '\n' || c == '\r' }) {
		for begin := 0; begin < len(line); begin++ {
			quote := line[begin]
			if quote == '\\' {
				begin++
				continue
			}
			if quote != '\'' && quote != '"' && quote != '`' {
				continue
			}
			for end := begin + 1; end < len(line); end++ {
				if line[end] == '\\' {
					end++
					continue
				}
				if line[end] == quote {
					raw := line[begin+1 : end]
					if quote != '`' || !strings.Contains(raw, "${") {
						visit(langKeyQuotedValue(raw, quote))
					}
					break
				}
			}
		}
	}
}

const langKeyRawQuotedPattern = `"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|` + "`[^`]*`"

var (
	langKeyRawArrayPattern    = regexp.MustCompile(`([a-zA-Z0-9_$]+|` + langKeyRawQuotedPattern + `)\s*:\s*\[`)
	langKeyRawConcatPattern   = regexp.MustCompile(`(` + langKeyRawQuotedPattern + `)\s*\+\s*[^'"\x60\s]`)
	langKeyRawTemplatePattern = regexp.MustCompile("`([^`]*?)\\$\\{")
)

// visitLangKeyRawPatterns repeats the array/prefix shapes without lexical
// classification. Comments and ambiguous regexes cannot mask these candidates;
// D3a accepts false hits, but callers must record them as code_literal only.
func visitLangKeyRawPatterns(content string, property, prefix func(string)) {
	quotedValue := func(text string) string {
		return langKeyQuotedValue(text[1:len(text)-1], text[0])
	}
	for _, match := range langKeyRawArrayPattern.FindAllStringSubmatch(content, -1) {
		key := match[1]
		if key[0] == '\'' || key[0] == '"' || key[0] == '`' {
			key = quotedValue(key)
		}
		property(key)
	}
	for _, match := range langKeyRawConcatPattern.FindAllStringSubmatch(content, -1) {
		prefix(quotedValue(match[1]))
	}
	for _, match := range langKeyRawTemplatePattern.FindAllStringSubmatch(content, -1) {
		prefix(match[1])
	}
}

func importsFrontPageKeyHelpers(content string) bool {
	if !strings.Contains(content, "front_page_settings_controls.js") {
		return false
	}
	_, tokens := lexLangKeyCode(content, ".js")
	module := func(token langKeyCodeLexeme) bool {
		return token.quoted && !token.dynamic && (strings.HasPrefix(token.text, "\"") || strings.HasPrefix(token.text, "'")) &&
			(token.value == "front_page_settings_controls.js" || strings.HasSuffix(token.value, "/front_page_settings_controls.js"))
	}
	for i, token := range tokens {
		if token.quoted || token.text != "import" || i+1 >= len(tokens) || (i > 0 && tokens[i-1].text == ".") {
			continue
		}
		if module(tokens[i+1]) {
			return true // Static side-effect import.
		}
		if tokens[i+1].text == "(" || tokens[i+1].text == "." {
			continue // Dynamic imports and import.meta do not bind these helpers.
		}
		for j := i + 1; j+1 < len(tokens) && tokens[j].text != ";"; j++ {
			if !tokens[j].quoted && tokens[j].text == "from" && module(tokens[j+1]) {
				return true
			}
		}
	}
	return false
}

func keyHelperArguments(path, content string) map[string]int {
	helpers := make(map[string]int)
	for owner, names := range langKeyHelperOwners {
		if strings.HasSuffix(filepath.ToSlash(path), "/"+owner) {
			for name, argument := range names {
				helpers[name] = argument
			}
		}
	}
	// These five exported functions all take full keys. Limit imported uses to
	// real static imports of their owner, rather than filenames in plain strings.
	if filepath.Ext(path) == ".js" && (strings.HasSuffix(path, "/front_page_settings_controls.js") ||
		importsFrontPageKeyHelpers(content)) {
		for name, argument := range frontPageKeyHelpers {
			helpers[name] = argument
		}
	}
	return helpers
}

func keyHelperArgument(tokens []langKeyCodeLexeme, open, argument int) (langKeyCodeLexeme, bool) {
	depth, current := 0, 0
	for i := open + 1; i < len(tokens); i++ {
		token := tokens[i]
		if depth == 0 && current == argument {
			return token, token.quoted && !token.dynamic && i+1 < len(tokens) &&
				(tokens[i+1].text == "," || tokens[i+1].text == ")")
		}
		switch token.text {
		case "(", "[", "{":
			depth++
		case ")", "]", "}":
			if depth == 0 {
				return langKeyCodeLexeme{}, false
			}
			depth--
		case ",":
			if depth == 0 {
				current++
			}
		}
	}
	return langKeyCodeLexeme{}, false
}

// appendLangKeyCodeCandidates only proposes names. resolveLangKeyCodeSources
// is the mandatory existing-registry gate before any candidate becomes a row.
// Tokens exclude comments for definite code; rawContent preserves every line
// for the independent literal, property-array and prefix safety nets.
func appendLangKeyCodeCandidates(results []sourceEntry, tokens []langKeyCodeLexeme, path, rawContent string, found map[string]bool) []sourceEntry {
	helpers := keyHelperArguments(path, rawContent)
	addCode := func(key string) {
		if key != "" && !found[key] {
			found[key] = true
			results = append(results, sourceEntry{langKey: key, filePath: path})
		}
	}
	constBlock, constDepth := false, 0
	for i, token := range tokens {
		if argument, ok := helpers[token.text]; ok && i+1 < len(tokens) && tokens[i+1].text == "(" &&
			(i == 0 || (tokens[i-1].text != "." && tokens[i-1].text != "function" && tokens[i-1].text != "func")) {
			if key, ok := keyHelperArgument(tokens, i+1, argument); ok {
				addCode(key.value)
			}
		}
		// A property is itself the key in translation arrays, unlike the
		// existing catalogue form whose first array item is the key.
		if i+2 < len(tokens) && tokens[i+1].text == ":" && tokens[i+2].text == "[" {
			if token.quoted {
				addCode(token.value)
			} else {
				addCode(token.text)
			}
		}
		name := -1
		if filepath.Ext(path) == ".go" {
			if token.text == "const" && i+1 < len(tokens) {
				if tokens[i+1].text == "(" {
					constBlock = true
				} else {
					name = i + 1
				}
			} else if constBlock {
				switch token.text {
				case "(":
					constDepth++
				case ")":
					constDepth--
					if constDepth == 0 {
						constBlock = false
					}
				default:
					if constDepth == 1 {
						name = i
					}
				}
			}
		}
		if name >= 0 && name+2 < len(tokens) && strings.HasSuffix(tokens[name].text, "Key") {
			value := name + 1
			if tokens[value].text == "string" {
				value++
			}
			if value+1 < len(tokens) && tokens[value].text == "=" && tokens[value+1].quoted {
				addCode(tokens[value+1].value)
			}
		}
	}
	seenLiterals, seenPrefixes := make(map[string]bool), make(map[string]bool)
	addLiteral := func(value string) {
		if value != "" && !seenLiterals[value] {
			seenLiterals[value] = true
			results = append(results, sourceEntry{langKey: value, filePath: path, sourceType: "code_literal"})
		}
	}
	for i, token := range tokens {
		if !token.quoted {
			continue
		}
		prefix := ""
		if token.dynamic {
			prefix = strings.SplitN(token.value, "${", 2)[0]
		} else if i+2 < len(tokens) && tokens[i+1].text == "+" && !tokens[i+2].quoted {
			prefix = token.value
		}
		if prefix != "" && !seenPrefixes[prefix] {
			seenPrefixes[prefix] = true
			results = append(results, sourceEntry{langKey: prefix, filePath: path, prefix: true})
		}
		// Keep literal evidence separate even when the same file also has a
		// definite reference. Only definite code participates in B2's floor.
		if !token.dynamic {
			addLiteral(token.value)
		}
	}
	visitLangKeyLineLiterals(rawContent, addLiteral)
	seenRawPrefixes := make(map[string]bool)
	visitLangKeyRawPatterns(rawContent, addLiteral, func(prefix string) {
		if prefix != "" && !seenRawPrefixes[prefix] {
			seenRawPrefixes[prefix] = true
			results = append(results, sourceEntry{langKey: prefix, filePath: path, prefix: true, sourceType: "code_literal"})
		}
	})
	return results
}

func resolveLangKeyCodeSources(candidates []sourceEntry, registry map[string]int64) []sourceEntry {
	keys := make([]string, 0, len(registry))
	for key := range registry {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var sources []sourceEntry
	seen := make(map[sourceEntry]bool)
	add := func(source sourceEntry) {
		if _, exists := registry[source.langKey]; exists && !seen[source] {
			seen[source] = true
			sources = append(sources, source)
		}
	}
	for _, candidate := range candidates {
		if !candidate.prefix {
			add(candidate)
			continue
		}
		prefix := candidate.langKey
		if prefix == "" {
			continue
		}
		for i := sort.SearchStrings(keys, prefix); i < len(keys) && strings.HasPrefix(keys[i], prefix); i++ {
			if keys[i] != prefix {
				add(sourceEntry{langKey: keys[i], filePath: candidate.filePath, sourceType: candidate.sourceType})
			}
		}
	}
	return sources
}

func skipLangKeyCodePath(name string, directory bool) bool {
	// Match ignored directory names before resolving links too: an excluded
	// node_modules/testing link may legitimately lead outside the source root.
	switch strings.ToLower(name) {
	case "dist", "node_modules", "testing", "e2e":
		return true
	}
	if directory {
		return false
	}
	return strings.HasSuffix(name, "_test.go") || strings.HasSuffix(name, ".test.js") ||
		strings.HasSuffix(name, ".test.ts") || strings.Contains(name, ".spec.")
}
