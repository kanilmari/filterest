// public_article_heading_text.go
// Reads a stored article heading as the words a reader sees, markup removed.
// Server twin of readInlineHeadingText in app/frontend/reusable_components/dom_container_builder.js.
// Exists so page titles, link previews and plain article pages print the heading the app shows.
//
// The browser gives a heading with markup to its HTML parser and reads the
// text of the result. The standard library has no HTML parser, so this file
// reads the markup by hand in the parser's own steps: where a tag, a comment
// and a text-only element such as <script> begin and end, which start tags end
// an open paragraph, list item, heading or link, how a wrongly nested inline
// tag is repaired, and which stray end tags count.
// Both sides answer app/testing/shared_contracts/heading_text_examples.json.
//
// Accepted limits. These rare inputs can read differently from every browser:
//   - table markup other than cells opened and closed in order: text placed
//     directly inside a table, cells without end tags, table tags outside a table;
//   - tags inside <select>, and svg or math content;
//   - the parser's extra rules for <form>, <button> and ruby tags;
//   - an inline formatting tag such as <b> that the parser ended on its own,
//     together with the block around it. The parser opens it again at the
//     next text, which is not followed here: a heading that starts inside
//     another heading then does not end the outer one, and the tag's end tag
//     ends the reopened copy, not an outer tag of the same name;
//   - the Kelvin sign in a tag name ("bloc\u212aquote" is a block to the
//     browser's reading but an unknown tag to its parser) between a wrongly
//     nested inline tag and a block opened inside it;
//   - more than 64 tags open at once (headingMaxOpenTags);
//   - a U+0000 character, which the parser drops from text. PostgreSQL cannot
//     store one, so a stored heading never holds it.
//
// Browsers also disagree with each other. Each line says whom the reader follows:
//   - <noscript> is read as an ordinary tag, as Chromium does; Firefox and the
//     frontend test DOM (jsdom) keep its content as literal text;
//   - <dialog> and <search> are ordinary tags to the nesting rules, as in
//     Chromium and jsdom; Firefox treats them like <div>, so there a new list
//     item stops at them and they stay open when an inline tag around them ends;
//   - a stray </p> or </br> after nothing but <title>, <noframes>, <base>,
//     <basefont> or <bgsound> tags is ignored, as the HTML standard, Firefox
//     and jsdom do; Chromium counts it as a word boundary;
//   - Chromium can drop a line feed right after a tag that holds a carriage
//     return ("<b \r>"), and Firefox repeats the previous numeric character
//     reference where the text ends in "&#". The reader follows the standard,
//     as the other engines do.
package system_table_tools

import (
	"html"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// headingSpaces is JavaScript's whitespace: the characters \s matches in the
// browser's patterns and String.prototype.trim removes. Go's own sets differ
// (its \s is ASCII only; strings.TrimSpace takes U+0085 and leaves U+FEFF), so
// neither is used in this file.
const headingSpaces = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

// The browser's three tests for "this heading holds markup"
// (containsHeadingMarkup and containsAllowedHtml). Each JavaScript lookahead
// (?=[\s/>]) is one consumed character here, which accepts the same texts.
var (
	// A tag the app renders, such as "<p>" or "< br/>". JavaScript compares
	// these names without its u flag, so only ASCII letters match in either
	// case. The text is therefore ASCII-lower-cased before the test; Go's (?i)
	// would also accept the long s and the Kelvin sign for "s" and "k".
	headingRenderedTag = regexp.MustCompile(`<[` + headingSpaces + `]*` +
		`(?:div|p|h1|h2|h3|h4|h5|h6|ul|ol|li|strong|em|span|br|b|i|a|hr|blockquote|pre)` +
		`(?:[` + headingSpaces + `]|/>|>)`)
	// A tag whose content is never shown. Here JavaScript does use its u flag,
	// and Go's (?i) folds letters the same way.
	headingHiddenTag = regexp.MustCompile(`(?i)<(?:script|style|template)[` + headingSpaces + `/>]`)
	// Any start tag. It counts only when the text also holds "</".
	headingAnyStartTag = regexp.MustCompile(`(?i)<[a-z][\w:-]*[` + headingSpaces + `/>]`)
)

var (
	// The parser turns every line ending into a line feed before anything else.
	headingLineEndings = strings.NewReplacer("\r\n", "\n", "\r", "\n")
	// The two named character references html.UnescapeString does not know,
	// because their replacement is longer than their name.
	headingMissingReferences = strings.NewReplacer("&nGt;", "\u226b\u20d2", "&nLt;", "\u226a\u20d2")
	// A numeric character reference as far as the parser reads one: "&#", the
	// digits it finds, and a semicolon when one follows.
	headingNumericReference = regexp.MustCompile(`&#(?:[xX][0-9a-fA-F]*|[0-9]*);?`)
)

// How the parser reads the content of an element that holds text only.
const (
	headingTextDropped = iota + 1 // the app never shows it
	headingTextDecoded            // text in which character references are decoded
	headingTextLiteral            // text in which every character stands for itself
)

// headingMaxOpenTags bounds how many open elements are remembered. No real
// heading nests this deep; the bound keeps a hostile value cheap to read.
const headingMaxOpenTags = 64

// headingTagSpaces is the whitespace the parser knows inside a tag (line
// endings are line feeds by then); with "/" and ">" it also ends a tag name.
const (
	headingTagSpaces  = "\t\n\f "
	headingTagNameEnd = headingTagSpaces + "/>"
)

const (
	headingParagraphEnders = "address article aside blockquote center details dialog dir div dl fieldset figcaption figure " +
		"footer header hgroup main menu nav ol p search section summary ul h1 h2 h3 h4 h5 h6 pre listing form li dd dt " +
		"plaintext table hr xmp"
	headingScopeEnders = "applet caption table td th marquee object"
)

var (
	// The browser's block tags: the tags the app renders, minus the inline
	// ones. Each marks a word boundary where it starts and where it ends.
	headingBlockTags = headingTagSet("div p h1 h2 h3 h4 h5 h6 ul ol li br hr blockquote pre")
	headingLevelTags = headingTagSet("h1 h2 h3 h4 h5 h6")
	// Tags that never have content, so they are never left open.
	headingVoidTags = headingTagSet("area base basefont bgsound br col embed frame hr image img input keygen link meta param source track wbr")
	// Tags the parser treats as page-head material; they do not count as the
	// first ordinary start tag (see inBody).
	headingHeadTags = headingTagSet("base basefont bgsound link meta noframes script style title")
	// Start tags the parser ignores inside a fragment.
	headingIgnoredTags = headingTagSet("html head body frameset")
	// Start tags that first end an open paragraph.
	headingEndsParagraph = headingTagSet(headingParagraphEnders)
	// Tags whose end tag closes whatever was opened inside them. All of them
	// but dialog and search are also what the parser treats as "special": the
	// end tag of an inline or unknown tag never closes one (isHeadingStructural).
	// Every block tag that can hold content is among them.
	headingStructuralTags = headingTagSet(headingParagraphEnders + " button colgroup noscript select tbody tfoot thead tr " + headingScopeEnders)
	// The inline formatting tags. The parser repairs their wrong nesting in its
	// own way (endFormatting).
	headingFormattingTags = headingTagSet("a b big code em font i nobr s small strike strong tt u")
	// An end tag reaches its open element only when none of these stands in
	// between; a paragraph also stops at a button, a list item at a list.
	headingScope       = headingTagSet(headingScopeEnders)
	headingButtonScope = headingTagSet(headingScopeEnders + " button")
	headingListScope   = headingTagSet(headingScopeEnders + " ol ul")
	headingParagraph   = headingTagSet("p")
	headingListItem    = headingTagSet("li")
	headingDescription = headingTagSet("dd dt")
	// Elements whose content the parser reads as text up to their own end tag.
	headingTextElements = map[string]int{
		"script": headingTextDropped, "style": headingTextDropped,
		"title": headingTextDecoded, "textarea": headingTextDecoded,
		"xmp": headingTextLiteral, "iframe": headingTextLiteral, "noembed": headingTextLiteral,
		"noframes": headingTextLiteral, "plaintext": headingTextLiteral,
	}
)

// headingMarkupReader collects the text of one heading while its markup is read.
type headingMarkupReader struct {
	text strings.Builder
	// The browser's two flags. A block tag sets pendingBreak to endsWithWord;
	// the next text then starts with one space unless it opens with whitespace.
	pendingBreak bool
	endsWithWord bool     // the text so far ends in something other than whitespace
	open         []string // names of the elements still open, innermost last
	// The browser parses a heading as the content of a <template>: until the
	// first ordinary start tag the parser ignores every end tag.
	inBody       bool
	templates    int  // how many <template> elements are open; their content is never shown
	dropLineFeed bool // the last thing read was <pre>, <listing> or <textarea>: a line feed right after it is dropped
}

// publicArticleHeadingText returns a stored heading as the text a reader sees.
// A value without markup is only trimmed: "Vector<T>", "2 < 5" and
// "Tom &amp; Jerry" stay exactly as stored. A value with markup loses its tags
// and has its character references decoded; neighbouring blocks such as two
// paragraphs get one space between them, and nothing else is added or collapsed.
func publicArticleHeadingText(stored string) string {
	if !headingHasMarkup(stored) {
		return strings.TrimFunc(stored, isHeadingSpace)
	}
	reader := headingMarkupReader{}
	reader.read(headingLineEndings.Replace(stored))
	return strings.TrimFunc(reader.text.String(), isHeadingSpace)
}

func headingHasMarkup(stored string) bool {
	if !strings.Contains(stored, "<") {
		return false // every test needs a "<"; most headings have none
	}
	return headingRenderedTag.MatchString(headingASCIILower(stored)) || headingHiddenTag.MatchString(stored) ||
		(strings.Contains(stored, "</") && headingAnyStartTag.MatchString(stored))
}

// read walks the markup from left to right: text up to the next "<", then
// whatever that "<" starts.
func (r *headingMarkupReader) read(source string) {
	for source != "" {
		tagStart := strings.IndexByte(source, '<')
		if tagStart < 0 {
			r.addText(decodeHeadingText(source))
			return
		}
		r.addText(decodeHeadingText(source[:tagStart]))
		source = source[tagStart:]
		switch {
		case len(source) > 1 && isHeadingASCIILetter(source[1]):
			source = r.readTag(source, 1)
		case len(source) > 2 && source[1] == '/' && isHeadingASCIILetter(source[2]):
			source = r.readTag(source, 2)
		case strings.HasPrefix(source, "</>"):
			source = source[3:] // an end tag without a name leaves nothing behind
		case strings.HasPrefix(source, "<!--"):
			r.dropLineFeed = false
			source = afterHeadingComment(source[4:])
		case source == "</":
			r.addText(source) // at the very end these two characters are text
			return
		case len(source) > 1 && strings.IndexByte("/!?", source[1]) >= 0:
			// "</ ...>", "<!...>" and "<?...>" are comments that end at the next ">".
			r.dropLineFeed = false
			end := strings.IndexByte(source, '>')
			if end < 0 {
				return
			}
			source = source[end+1:]
		default:
			r.addText("<") // a "<" that starts no tag is ordinary text
			source = source[1:]
		}
	}
}

// readTag reads the start tag (nameStart 1) or end tag (nameStart 2) that
// opens source and returns what follows it. A tag name runs up to whitespace,
// "/" or ">", whatever characters it holds.
func (r *headingMarkupReader) readTag(source string, nameStart int) string {
	nameEnd := nameStart
	for nameEnd < len(source) && strings.IndexByte(headingTagNameEnd, source[nameEnd]) < 0 {
		nameEnd++
	}
	end := headingTagEnd(source, nameEnd)
	if end < 0 {
		return "" // the text ends inside the tag: the parser discards the tag and everything after it
	}
	r.dropLineFeed = false
	name := headingASCIILower(source[nameStart:nameEnd])
	if nameStart == 2 {
		r.endTag(name)
		return source[end:]
	}
	return r.startTag(name, source[end:])
}

// startTag applies a start tag and returns the markup that is left to read.
func (r *headingMarkupReader) startTag(name, rest string) string {
	textKind := headingTextElements[name]
	if r.templates > 0 || name == "template" {
		// Nothing inside a template is shown. Only its own end tag matters, and
		// a text-only element in it can still hide a "</template>".
		if name == "template" {
			r.templates++
		} else if textKind != 0 {
			_, rest = cutHeadingTextElement(name, rest)
		}
		return rest
	}
	if !headingHeadTags[name] {
		r.inBody = true
		if headingIgnoredTags[name] {
			return rest
		}
		if headingEndsParagraph[name] {
			r.closeFrom(r.openInScope(headingParagraph, headingButtonScope))
		}
		switch {
		case name == "li":
			r.closeListItem(headingListItem)
		case name == "dd" || name == "dt":
			r.closeListItem(headingDescription)
		case headingLevelTags[name] && headingLevelTags[r.innermost()]:
			r.closeFrom(len(r.open) - 1) // a heading directly inside a heading ends the outer one
		case name == "a" || name == "nobr":
			r.endFormatting(name) // a link inside a link ends the outer one, as its end tag would
		case (name == "option" || name == "optgroup") && r.innermost() == "option":
			r.closeFrom(len(r.open) - 1) // an option ends where the next option or group starts
		}
	}
	if textKind != 0 {
		var content string
		content, rest = cutHeadingTextElement(name, rest)
		r.dropLineFeed = name == "textarea"
		switch textKind {
		case headingTextDecoded:
			r.addText(decodeHeadingText(content))
		case headingTextLiteral:
			r.addText(content)
		}
		r.dropLineFeed = false
		return rest
	}
	if isHeadingBlock(name) {
		r.pendingBreak = r.endsWithWord
	}
	if !headingVoidTags[name] && len(r.open) < headingMaxOpenTags {
		r.open = append(r.open, name)
	}
	r.dropLineFeed = name == "pre" || name == "listing"
	return rest
}

// endTag applies an end tag. The parser ignores an end tag that has no open
// element to close, with two exceptions: "</p>" and "</br>" then stand for an
// empty paragraph and a line break, which are word boundaries.
func (r *headingMarkupReader) endTag(name string) {
	if r.templates > 0 {
		if name == "template" {
			r.templates--
		}
		return
	}
	if !r.inBody {
		return
	}
	switch {
	case name == "br":
		r.pendingBreak = r.endsWithWord
	case name == "p":
		if at := r.openInScope(headingParagraph, headingButtonScope); at >= 0 {
			r.closeFrom(at)
		} else {
			r.pendingBreak = r.endsWithWord
		}
	case headingLevelTags[name]:
		r.closeFrom(r.openInScope(headingLevelTags, headingScope)) // an end tag of any level ends the open heading
	case name == "li":
		r.closeFrom(r.openInScope(headingListItem, headingListScope))
	case headingStructuralTags[name]:
		r.closeFrom(r.openInScope(map[string]bool{name: true}, headingScope))
	case headingFormattingTags[name]:
		r.endFormatting(name)
	default:
		// Any other end tag closes its element only when no structural element
		// was opened inside it.
		for at := len(r.open) - 1; at >= 0 && !isHeadingStructural(r.open[at]); at-- {
			if r.open[at] == name {
				r.closeFrom(at)
				return
			}
		}
	}
}

// endFormatting ends the open inline formatting element with this name, such
// as <b> or <a>. With nothing structural open inside it, it ends together with
// everything opened in it. Otherwise the parser repairs the wrong nesting (the
// standard's "adoption agency"): the first structural element inside moves out
// of the formatting element and stays open, the elements between the two end,
// except up to three formatting elements next to the structural one, and the
// formatting element starts again inside the structural one. The parser then
// ends that new element the same way, at most eight times in all.
func (r *headingMarkupReader) endFormatting(name string) {
	at := r.openInScope(map[string]bool{name: true}, headingScope)
	for round := 0; at >= 0 && round < 8; round++ {
		structural := at + 1
		for structural < len(r.open) && !isHeadingStructural(r.open[structural]) {
			structural++
		}
		if structural == len(r.open) {
			r.closeFrom(at)
			return
		}
		kept := r.open[:at]
		for between := at + 1; between < structural; between++ {
			if headingFormattingTags[r.open[between]] && structural-between <= 3 {
				kept = append(kept, r.open[between])
			}
		}
		kept = append(kept, r.open[structural])
		at = len(kept)
		r.open = append(append(kept, name), r.open[structural+1:]...)
	}
}

// innermost names the element opened last and still open, or "".
func (r *headingMarkupReader) innermost() string {
	if len(r.open) == 0 {
		return ""
	}
	return r.open[len(r.open)-1]
}

// openInScope finds the innermost open element with a wanted name, or -1 when
// there is none or a scope-ending element stands in between.
func (r *headingMarkupReader) openInScope(wanted, scopeEnders map[string]bool) int {
	for at := len(r.open) - 1; at >= 0; at-- {
		if wanted[r.open[at]] {
			return at
		}
		if scopeEnders[r.open[at]] {
			return -1
		}
	}
	return -1
}

// closeListItem ends the open list item that a new one replaces. The search
// stops at any structural element other than address, div and p, so an item
// of an inner list never ends the item that holds the list.
func (r *headingMarkupReader) closeListItem(items map[string]bool) {
	for at := len(r.open) - 1; at >= 0; at-- {
		name := r.open[at]
		if items[name] {
			r.closeFrom(at)
			return
		}
		if isHeadingStructural(name) && name != "address" && name != "div" && name != "p" {
			return
		}
	}
}

// closeFrom ends the open elements from position at inwards; the end of a
// block tag is a word boundary.
func (r *headingMarkupReader) closeFrom(at int) {
	if at < 0 {
		return
	}
	for _, name := range r.open[at:] {
		if isHeadingBlock(name) {
			r.pendingBreak = r.endsWithWord
		}
	}
	r.open = r.open[:at]
}

// addText appends text exactly as it is. The only addition is the browser's:
// one space in front when a block tag came since the last text, that text
// ended in a word, and this text does not open with whitespace.
func (r *headingMarkupReader) addText(text string) {
	if text == "" || r.templates > 0 {
		return
	}
	if r.dropLineFeed {
		r.dropLineFeed = false
		if text = strings.TrimPrefix(text, "\n"); text == "" {
			return
		}
	}
	first, _ := utf8.DecodeRuneInString(text)
	last, _ := utf8.DecodeLastRuneInString(text)
	if r.pendingBreak && !isHeadingSpace(first) {
		r.text.WriteByte(' ')
	}
	r.pendingBreak, r.endsWithWord = false, !isHeadingSpace(last)
	r.text.WriteString(text)
}

// headingTagEnd returns the position just after the ">" that ends a tag whose
// attributes start at position at, or -1 when the text ends first. A ">"
// inside a quoted attribute value does not end the tag; a quote anywhere else
// is an ordinary character, as it is for the parser.
func headingTagEnd(source string, at int) int {
	const (
		beforeName = iota
		inName
		afterName
		beforeValue
		inBareValue
		afterQuotedValue
	)
	state := beforeName
	for ; at < len(source); at++ {
		character := source[at]
		switch {
		case character == '>':
			return at + 1
		case strings.IndexByte(headingTagSpaces, character) >= 0:
			if state == inName {
				state = afterName
			} else if state == inBareValue || state == afterQuotedValue {
				state = beforeName
			}
		case state == beforeValue && (character == '"' || character == '\''):
			closing := strings.IndexByte(source[at+1:], character)
			if closing < 0 {
				return -1
			}
			at += closing + 1
			state = afterQuotedValue
		case state == beforeValue:
			state = inBareValue
		case state == inBareValue:
			// Any other character, "/" and "=" included, belongs to the value.
		case character == '/':
			state = beforeName
		case character == '=' && (state == inName || state == afterName):
			state = beforeValue
		default:
			state = inName
		}
	}
	return -1
}

// cutHeadingTextElement splits what follows the start tag of a text-only
// element into the element's text and what comes after its end tag. Without an
// end tag the element takes the rest of the text. A script is the one special
// case: once its text holds "<!--", a "<script>" inside it hides the next
// "</script>", until "-->".
func cutHeadingTextElement(name, rest string) (content, after string) {
	endTag := "</" + name
	hidden := 0 // script only: 1 after "<!--", 2 after a "<script" inside that
	for at := 0; at < len(rest) && name != "plaintext"; at++ {
		switch {
		case name == "script" && hidden == 0 && strings.HasPrefix(rest[at:], "<!--"):
			hidden, at = 1, at+1 // its two dashes may already belong to "-->"
		case hidden > 0 && strings.HasPrefix(rest[at:], "-->"):
			hidden, at = 0, at+2
		case hidden == 1 && headingTagOpensAt(rest, at, "<script"):
			hidden = 2
		case hidden == 2 && headingTagOpensAt(rest, at, "</script"):
			hidden = 1
		case hidden < 2 && headingTagOpensAt(rest, at, endTag):
			if end := headingTagEnd(rest, at+len(endTag)); end >= 0 {
				return rest[:at], rest[end:]
			}
			return rest[:at], ""
		}
	}
	return rest, ""
}

// headingTagOpensAt reports whether a tag with this opening, such as
// "</title", starts at position at: the name in either ASCII letter case,
// directly followed by whitespace, "/" or ">".
func headingTagOpensAt(source string, at int, opening string) bool {
	end := at + len(opening)
	return source[at] == '<' && end < len(source) && headingASCIILower(source[at:end]) == opening &&
		strings.IndexByte(headingTagNameEnd, source[end]) >= 0
}

// afterHeadingComment returns what follows a comment whose "<!--" has been read.
// A comment ends at "-->" or "--!>"; "<!-->" and "<!--->" are complete comments;
// an unfinished comment hides the rest of the text.
func afterHeadingComment(rest string) string {
	if strings.HasPrefix(rest, ">") {
		return rest[1:]
	}
	if strings.HasPrefix(rest, "->") {
		return rest[2:]
	}
	// One pass over the text, however many comments it holds: only a run of
	// two or more dashes can be followed by the ">" or "!>" that ends a comment.
	for {
		dashes := strings.Index(rest, "--")
		if dashes < 0 {
			return ""
		}
		rest = strings.TrimLeft(rest[dashes:], "-")
		if strings.HasPrefix(rest, ">") {
			return rest[1:]
		}
		if strings.HasPrefix(rest, "!>") {
			return rest[2:]
		}
	}
}

// decodeHeadingText decodes character references such as "&amp;" the way the
// parser does in text.
func decodeHeadingText(text string) string {
	if !strings.Contains(text, "&") {
		return text
	}
	if strings.Contains(text, "&#") {
		text = headingNumericReference.ReplaceAllStringFunc(text, wholeHeadingReference)
	}
	return html.UnescapeString(headingMissingReferences.Replace(text))
}

// wholeHeadingReference spells one numeric character reference out in full, so
// that html.UnescapeString reads it as the parser does. Left as typed, three
// forms would read differently: "&#x;" has no digits and stays as it is, a
// one-digit number without its semicolon at the very end of a text ("&#9") is
// still a reference, and a number beyond the last character becomes U+FFFD.
func wholeHeadingReference(reference string) string {
	digits, base := strings.TrimSuffix(reference[2:], ";"), 10
	if strings.HasPrefix(digits, "x") || strings.HasPrefix(digits, "X") {
		digits, base = digits[1:], 16
	}
	if digits == "" {
		return "&amp;" + reference[1:]
	}
	number, err := strconv.ParseUint(digits, base, 32)
	if err != nil || number > utf8.MaxRune {
		number = utf8.RuneError
	}
	return "&#" + strconv.FormatUint(number, 10) + ";"
}

// isHeadingBlock reports whether the browser's walk treats a tag as a block. It
// lower-cases the name with toLowerCase, which also turns the Kelvin sign into "k".
func isHeadingBlock(name string) bool {
	return headingBlockTags[strings.ReplaceAll(name, "\u212a", "k")]
}

// isHeadingStructural reports whether the parser treats an open element as
// "special". Chromium and the frontend test DOM leave dialog and search out;
// Firefox counts both.
func isHeadingStructural(name string) bool {
	return name != "dialog" && name != "search" && headingStructuralTags[name]
}

func isHeadingSpace(character rune) bool { return strings.ContainsRune(headingSpaces, character) }

func isHeadingASCIILetter(character byte) bool {
	return character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z'
}

// headingASCIILower lower-cases A-Z only, as the HTML parser does with tag names.
func headingASCIILower(text string) string {
	return strings.Map(func(character rune) rune {
		if character >= 'A' && character <= 'Z' {
			return character + ('a' - 'A')
		}
		return character
	}, text)
}

func headingTagSet(names string) map[string]bool {
	set := map[string]bool{}
	for _, name := range strings.Fields(names) {
		set[name] = true
	}
	return set
}
