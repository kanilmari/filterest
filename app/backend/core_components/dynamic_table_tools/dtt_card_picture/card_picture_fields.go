// card_picture_fields.go
// Names the row fields a card can show a picture from and chooses the one a row shows.
// Between the read-time card enrichment, the article's related-rows response, which reports the
// row's shown picture, and the missing-media check, which must count every such field as a
// reference to a stored file; and between the article and the browser's card list, whose test
// for a picture in a named field LikelyPictureValue repeats.
// Exists so they read the same fields; a field one of them missed was a file the check could
// call unused while a card still showed it, or an article picture other than the card's.
package dtt_card_picture

import (
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
)

// CardPictureFields are the named picture fields, cached_image first. Columns whose
// card role is an image are picture fields as well; callers add them from metadata.
var CardPictureFields = []string{
	"cached_image",
	"image",
	"image_url",
	"image_path",
	"hero_image",
	"avatar_image",
	"avatar_url",
	"logo_image",
	"thumbnail_image",
}

// ImageRoleCondition is the SQL condition on a system_column_details row, aliased d, that
// marks a column whose card role is an image.
const ImageRoleCondition = `d.card_element ILIKE '%image%'`

// OwnPictureFields are the text fields of one dataset that can show a row's picture.
type OwnPictureFields struct {
	// Role are the columns whose card role is an image and which the card shows
	// (show_value_on_card, not hidden on the small card), in column order: the fields the
	// dataset's designer chose to show as its picture.
	Role []string
	// Named are the named picture fields (CardPictureFields) the dataset has, in that
	// list's order, so cached_image, the card picture rule's field, comes first.
	Named []string
	// HidesFalse names the Role fields whose card hides a false or empty value
	// (hide_false_null_on_sml_crd): the card then moves on to the next picture.
	HidesFalse map[string]bool
}

// Columns lists every field once, for reading them in one statement.
func (fields OwnPictureFields) Columns() []string {
	columns := make([]string, 0, len(fields.Role)+len(fields.Named))
	seen := make(map[string]bool, cap(columns))
	for _, column := range append(append([]string(nil), fields.Role...), fields.Named...) {
		if !seen[column] {
			seen[column] = true
			columns = append(columns, column)
		}
	}
	return columns
}

// ReadOwnPictureFields returns the dataset's picture fields that are delivered to the
// browser at all (client_delivery_mode 'include'): a field kept on the server never
// leaves it as a picture either.
func ReadOwnPictureFields(querier dbutils.Querier, table string) (OwnPictureFields, error) {
	rows, err := querier.Query(`
		SELECT c.column_name,
		       COALESCE(`+ImageRoleCondition+`
		                AND COALESCE(d.show_value_on_card, false)
		                AND NOT COALESCE(d.hide_on_small_card, false), false),
		       COALESCE(d.hide_false_null_on_sml_crd, false)
		  FROM information_schema.columns c
		  LEFT JOIN system_column_details d
		         ON d.column_name = c.column_name
		        AND d.table_uid = (SELECT table_uid FROM system_db_tables WHERE table_name = $1 LIMIT 1)
		 WHERE c.table_schema = 'public'
		   AND c.table_name = $1
		   AND c.data_type IN ('text', 'character varying')
		   AND COALESCE(d.client_delivery_mode, 'include') = 'include'
		 ORDER BY c.ordinal_position`,
		table,
	)
	if err != nil {
		return OwnPictureFields{}, err
	}
	defer rows.Close()
	fields := OwnPictureFields{HidesFalse: map[string]bool{}}
	present := make(map[string]bool)
	for rows.Next() {
		var column string
		var imageRole, hidesFalse bool
		if err := rows.Scan(&column, &imageRole, &hidesFalse); err != nil {
			return OwnPictureFields{}, err
		}
		present[column] = true
		if imageRole {
			fields.Role = append(fields.Role, column)
			if hidesFalse {
				fields.HidesFalse[column] = true
			}
		}
	}
	if err := rows.Err(); err != nil {
		return OwnPictureFields{}, err
	}
	for _, column := range CardPictureFields {
		if present[column] {
			fields.Named = append(fields.Named, column)
		}
	}
	return fields, nil
}

// ChooseShownPicture returns the picture a row shows as its main picture, by the card
// list's rule, which the article follows (owner decision K128, alternative (a)): the first
// non-empty image-role field the card shows — skipping a "false" the card hides
// (HidesFalse) — otherwise the first named picture field that holds a picture
// (LikelyPictureValue), cached_image, the card picture the gallery rule stores, first.
// One difference is deliberate: where the card shows a letter avatar for an empty
// image-role field it does not hide, the article shows the next picture the row has.
func ChooseShownPicture(fields OwnPictureFields, values map[string]string) string {
	for _, column := range fields.Role {
		value := strings.TrimSpace(values[column])
		if value == "" || (fields.HidesFalse[column] && value == "false") {
			continue
		}
		return value
	}
	for _, column := range fields.Named {
		if value := LikelyPictureValue(values[column]); value != "" {
			return value
		}
	}
	return ""
}

// The test for a picture in a named field is the browser's own, repeated here:
// normalizeFallbackImageCandidate in
// app/frontend/core_components/table_views/card_view/card_element_builder_helpers.js, which
// the card list applies to these fields, together with the JavaScript it relies on —
// String.prototype.trim, JSON.parse, Object.values, String() of an array and of a number,
// and its regular expressions as JavaScript reads them. Both sides answer the examples in
// app/testing/shared_contracts/card_picture_candidate_examples.json; change both together,
// or a card and its article show different pictures.

// javaScriptDot is what . matches in a JavaScript pattern without the s flag: any character
// but a line terminator. Go's . stops at \n alone.
const javaScriptDot = `[^\n\r\x{2028}\x{2029}]`

var (
	// The filename pattern is matched on the text with its ASCII letters in lower case
	// (lowerASCII): the browser's /i flag, without the u flag, folds only ASCII letters
	// here, where Go's (?i) would also take the long s (U+017F) for an s.
	pictureFilenamePattern    = regexp.MustCompile(`\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#]` + javaScriptDot + `*)?$`)
	pictureStoragePathPattern = regexp.MustCompile(`^(\d+)/(\d+)/(?:\d+|original)/(` + javaScriptDot + `+)$`)
	pictureFlatFilePattern    = regexp.MustCompile(`^(\d+)_(\d+)_(\d+)\.(\w+)$`)
)

// LikelyPictureValue returns the picture a named picture field holds, or "" when it holds
// none: the answer the browser's normalizeFallbackImageCandidate gives for the same text.
// The text is trimmed as String.prototype.trim trims it. An address, a path, a stored file
// name or a name with a picture extension is itself the picture. A text that opens with {
// and closes with } is read as JSON.parse reads it and searched (pictureInJSON); the browser
// reads and searches inside one try block, so when either fails — the text is not one whole
// JSON value, or the search meets a value JavaScript cannot turn into text — the text holds
// no picture, even where a later value would have held one. The literal text "null" seen in
// a live database is none.
func LikelyPictureValue(raw string) string {
	candidate := trimLikeJavaScript(raw)
	if candidate == "" {
		return ""
	}
	if isLikelyPicture(candidate) {
		return candidate
	}
	if !strings.HasPrefix(candidate, "{") || !strings.HasSuffix(candidate, "}") {
		return ""
	}
	value, parsed := parseLikeJSONParse(candidate)
	if !parsed {
		return ""
	}
	picture, completed := pictureInJSON(value)
	if !completed {
		// The search threw inside this text's try block; the browser's catch answers nothing.
		return ""
	}
	return picture
}

// isLikelyPicture is the browser's isLikelyCardImageValue: whether a trimmed text is itself
// a picture.
func isLikelyPicture(candidate string) bool {
	for _, prefix := range []string{"http://", "https://", "/", "./", "../"} {
		if strings.HasPrefix(candidate, prefix) {
			return true
		}
	}
	return pictureStoragePathPattern.MatchString(candidate) ||
		pictureFlatFilePattern.MatchString(candidate) ||
		pictureFilenamePattern.MatchString(lowerASCII(candidate))
}

// trimLikeJavaScript removes from both ends what String.prototype.trim removes: the white
// space and line terminators of ECMAScript. strings.TrimSpace differs on two characters: it
// keeps the byte order mark, which JavaScript removes, and removes U+0085, which JavaScript
// keeps.
func trimLikeJavaScript(text string) string {
	return strings.TrimFunc(text, isJavaScriptWhiteSpace)
}

func isJavaScriptWhiteSpace(character rune) bool {
	switch character {
	case '\t', '\n', 0x0B, 0x0C, '\r', ' ', // tab, line feed, vertical tab, form feed, carriage return, space
		0x00A0, 0x1680, 0x202F, 0x205F, 0x3000, // the other space separators besides U+2000-U+200A
		0x2028, 0x2029, // line and paragraph separators
		0xFEFF: // byte order mark
		return true
	}
	return 0x2000 <= character && character <= 0x200A
}

// lowerASCII lowers the ASCII letters of text and leaves every other character as it is.
func lowerASCII(text string) string {
	lowered := []byte(text)
	for index, character := range lowered {
		if 'A' <= character && character <= 'Z' {
			lowered[index] = character + ('a' - 'A')
		}
	}
	return string(lowered)
}

// jsonValue is one value JSON.parse returned, as the browser's search sees it.
type jsonValue struct {
	kind jsonKind
	// text is a string's own text, or the text String() writes for a number, true or false.
	// null has none: the search finds nothing in it, and a join writes nothing for it.
	text string
	// values are an object's values in the order Object.values lists them, or an array's
	// elements in their order.
	values []jsonValue
	// ownToString marks an object with its own property named toString. JavaScript turns
	// such an object into text by calling that property, and no JSON value can be called,
	// so the attempt throws.
	ownToString bool
}

type jsonKind int

const (
	jsonScalar jsonKind = iota // a string, a number, true, false or null
	jsonObject
	jsonArray
)

// parseLikeJSONParse reads text as JSON.parse reads it: one whole JSON value, nothing after
// it. parsed is false where JSON.parse throws.
func parseLikeJSONParse(text string) (value jsonValue, parsed bool) {
	if !json.Valid([]byte(text)) {
		return jsonValue{}, false
	}
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.UseNumber()
	value, err := readJSONValue(decoder)
	return value, err == nil
}

// readJSONValue reads the next value of text that json.Valid has accepted.
func readJSONValue(decoder *json.Decoder) (jsonValue, error) {
	token, err := decoder.Token()
	if err != nil {
		return jsonValue{}, err
	}
	switch token := token.(type) {
	case json.Delim:
		switch token {
		case '{':
			return readJSONObject(decoder)
		case '[':
			return readJSONArray(decoder)
		}
		return jsonValue{}, errors.New("a closing delimiter where a value belongs")
	case string:
		return jsonValue{kind: jsonScalar, text: token}, nil
	case json.Number:
		// Where a number lies beyond the double range, ParseFloat returns the infinity
		// JSON.parse reads it as, with an error that is no error here; an underflow is
		// zero, as in JavaScript. The text is valid JSON, so nothing else can fail.
		number, _ := strconv.ParseFloat(string(token), 64)
		return jsonValue{kind: jsonScalar, text: javaScriptNumberText(number)}, nil
	case bool:
		return jsonValue{kind: jsonScalar, text: strconv.FormatBool(token)}, nil
	}
	return jsonValue{kind: jsonScalar}, nil // null
}

// readJSONObject reads an object's members after its opening brace and lists its values
// in the order Object.values gives them: names that are array indexes first, ascending,
// then the other names in the order they first appear. A repeated name keeps its first
// place and its last value, as JSON.parse leaves it.
func readJSONObject(decoder *json.Decoder) (jsonValue, error) {
	order := make([]string, 0)
	values := make(map[string]jsonValue)
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return jsonValue{}, err
		}
		name, _ := token.(string)
		value, err := readJSONValue(decoder)
		if err != nil {
			return jsonValue{}, err
		}
		if _, seen := values[name]; !seen {
			order = append(order, name)
		}
		values[name] = value
	}
	if _, err := decoder.Token(); err != nil { // the closing brace
		return jsonValue{}, err
	}
	sort.SliceStable(order, func(left, right int) bool {
		leftIndex, leftIsIndex := arrayIndexName(order[left])
		rightIndex, rightIsIndex := arrayIndexName(order[right])
		if leftIsIndex && rightIsIndex {
			return leftIndex < rightIndex
		}
		return leftIsIndex && !rightIsIndex
	})
	object := jsonValue{kind: jsonObject, values: make([]jsonValue, 0, len(order))}
	for _, name := range order {
		object.values = append(object.values, values[name])
	}
	_, object.ownToString = values["toString"]
	return object, nil
}

// readJSONArray reads an array's elements after its opening bracket.
func readJSONArray(decoder *json.Decoder) (jsonValue, error) {
	array := jsonValue{kind: jsonArray}
	for decoder.More() {
		element, err := readJSONValue(decoder)
		if err != nil {
			return jsonValue{}, err
		}
		array.values = append(array.values, element)
	}
	if _, err := decoder.Token(); err != nil { // the closing bracket
		return jsonValue{}, err
	}
	return array, nil
}

// arrayIndexName reports a property name JavaScript treats as an array index: a whole
// number below 2^32-1 written without leading zeros.
func arrayIndexName(name string) (uint64, bool) {
	value, err := strconv.ParseUint(name, 10, 32)
	if err != nil || value == math.MaxUint32 || strconv.FormatUint(value, 10) != name {
		return 0, false
	}
	return value, true
}

// pictureInJSON searches one value JSON.parse returned, as normalizeFallbackImageCandidate
// does: an object's values in order, the first picture winning; an array as the text
// String() makes of it, tested again in full; anything else as its own text, a JSON object
// inside it read under a try block of its own (LikelyPictureValue). completed is false where
// the browser's search throws, which ends the search of the whole text being read.
func pictureInJSON(value jsonValue) (picture string, completed bool) {
	switch value.kind {
	case jsonObject:
		for _, nested := range value.values {
			if picture, completed := pictureInJSON(nested); !completed || picture != "" {
				return picture, completed
			}
		}
		return "", true
	case jsonArray:
		text, completed := arrayAsText(value)
		if !completed {
			return "", false
		}
		return LikelyPictureValue(text), true
	}
	// A string is tested as a field's own text is. So is the text of a number or a truth
	// value, as the browser tests it, though such a text is never a picture by itself; null
	// has no text.
	return LikelyPictureValue(value.text), true
}

// arrayAsText is String() of an array in JavaScript, which joins its elements with commas:
// null as nothing, a string as itself, a number and a truth value as String() writes them,
// a nested array the same way, and an object as "[object Object]". completed is false
// where JavaScript throws: an object with its own toString cannot be turned into text.
func arrayAsText(array jsonValue) (text string, completed bool) {
	parts := make([]string, len(array.values))
	for index, element := range array.values {
		switch element.kind {
		case jsonArray:
			nested, completed := arrayAsText(element)
			if !completed {
				return "", false
			}
			parts[index] = nested
		case jsonObject:
			if element.ownToString {
				return "", false
			}
			parts[index] = "[object Object]"
		default:
			parts[index] = element.text
		}
	}
	return strings.Join(parts, ","), true
}

// javaScriptNumberText writes a number as JavaScript's String() does (ECMAScript
// Number::toString): the shortest digits that read back as the same double, in plain
// notation from 1e-6 up to below 1e21 and in exponent notation outside it ("1e+21",
// "1.5e-7"); a negative zero as "0", and an infinity as "Infinity" or "-Infinity". JSON
// never yields NaN, but it is written "NaN" all the same.
func javaScriptNumberText(number float64) string {
	switch {
	case math.IsNaN(number):
		return "NaN"
	case number == 0:
		return "0"
	case math.IsInf(number, 1):
		return "Infinity"
	case math.IsInf(number, -1):
		return "-Infinity"
	case number < 0:
		return "-" + javaScriptNumberText(-number)
	}
	// FormatFloat gives the same shortest digits, written d.ddde+xx; JavaScript lays them
	// out by where the decimal point falls: after `point` digits, so that the number is
	// digits * 10^(point - len(digits)).
	mantissa, exponentText, _ := strings.Cut(strconv.FormatFloat(number, 'e', -1, 64), "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	exponent, _ := strconv.Atoi(exponentText)
	point := exponent + 1
	switch {
	case len(digits) <= point && point <= 21:
		return digits + strings.Repeat("0", point-len(digits))
	case 0 < point && point <= 21:
		return digits[:point] + "." + digits[point:]
	case -6 < point && point <= 0:
		return "0." + strings.Repeat("0", -point) + digits
	}
	sign := "+"
	if exponent < 0 {
		sign, exponent = "-", -exponent
	}
	if len(digits) == 1 {
		return digits + "e" + sign + strconv.Itoa(exponent)
	}
	return digits[:1] + "." + digits[1:] + "e" + sign + strconv.Itoa(exponent)
}
