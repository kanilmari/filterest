// table_classifier_sql_scanner_test.go
// Removes SQL comments before scanning the shipped table inventory.
// Connects the classifier regression with immutable migration and bootstrap SQL.
// Preserves quoted text and dollar bodies rather than editing executed sources.
package runtime_grants

import (
	"reflect"
	"regexp"
	"strings"
	"testing"
)

var createdTablePattern = regexp.MustCompile(`(?i)\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNLOGGED\s+|MATERIALIZED\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?[a-z_][a-z_0-9]*"?\.)?"?[a-z_][a-z_0-9]*"?)`)

func literalCreatedTables(source string) []string {
	var names []string
	for _, match := range createdTablePattern.FindAllStringSubmatch(sqlWithoutComments(source), -1) {
		names = append(names, match[1])
	}
	return names
}

// Mask comments with whitespace so adjacent tokens stay separate and newlines
// remain intact. Quotes are opaque here, including dollar-quoted function/DO
// bodies: the inventory must still see the procedural DDL it scanned before.
func sqlWithoutComments(source string) string {
	filtered := []byte(source)
	for offset := 0; offset < len(source); {
		switch {
		case strings.HasPrefix(source[offset:], "--"):
			end := offset + 2
			for end < len(source) && source[end] != '\n' && source[end] != '\r' {
				end++
			}
			maskSQLComment(filtered, offset, end)
			offset = end
		case strings.HasPrefix(source[offset:], "/*"):
			end, depth := offset+2, 1
			for end < len(source) && depth > 0 {
				switch {
				case strings.HasPrefix(source[end:], "/*"):
					depth++
					end += 2
				case strings.HasPrefix(source[end:], "*/"):
					depth--
					end += 2
				default:
					end++
				}
			}
			maskSQLComment(filtered, offset, end)
			offset = end
		case source[offset] == '\'' || source[offset] == '"':
			offset = quotedSQLTextEnd(source, offset)
		case source[offset] == '$' && (offset == 0 || !sqlIdentifierByte(source[offset-1])):
			delimiter := sqlDollarQuoteDelimiter(source[offset:])
			if delimiter == "" {
				offset++
				continue
			}
			body := offset + len(delimiter)
			end := strings.Index(source[body:], delimiter)
			if end < 0 {
				offset = len(source)
			} else {
				offset = body + end + len(delimiter)
			}
		default:
			offset++
		}
	}
	return string(filtered)
}

func maskSQLComment(filtered []byte, start, end int) {
	for index := start; index < end; index++ {
		if filtered[index] != '\n' && filtered[index] != '\r' {
			filtered[index] = ' '
		}
	}
}

func sqlIdentifierByte(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z' || value >= '0' && value <= '9' || value == '_' || value == '$' || value >= 0x80
}

func sqlDollarQuoteDelimiter(source string) string {
	// PostgreSQL tags use identifier bytes, including non-ASCII text, but
	// cannot start with a digit. A dollar sign closes the tag, including $$.
	for end := 1; end < len(source); end++ {
		if source[end] == '$' {
			return source[:end+1]
		}
		if !sqlIdentifierByte(source[end]) || end == 1 && source[end] >= '0' && source[end] <= '9' {
			return ""
		}
	}
	return ""
}

func quotedSQLTextEnd(source string, start int) int {
	quote := source[start]
	// Standard strings escape quotes by doubling; only E'...' treats a
	// backslash as an escape. Quoted identifiers double their quote too.
	escape := quote == '\'' && start > 0 && (source[start-1] == 'E' || source[start-1] == 'e') && (start == 1 || !sqlIdentifierByte(source[start-2]))
	for offset := start + 1; offset < len(source); {
		if escape && source[offset] == '\\' {
			offset += 2
		} else if source[offset] == quote {
			if offset+1 < len(source) && source[offset+1] == quote {
				offset += 2
			} else {
				return offset + 1
			}
		} else {
			offset++
		}
	}
	return len(source)
}

func TestTableClassifierScannerIgnoresSQLComments(t *testing.T) {
	// Exact comment from executed migration 20261009000003, including its wrap.
	const source = `-- An upgrade cannot rely on the bootstrap's repeated check: CREATE TABLE IF NOT EXISTS keeps a pre-existing table as
-- it is, so refuse here, before recording completion, inside the runner's transaction.
/* CREATE TABLE block_comment(id int);
   /* CREATE VIEW nested_comment AS SELECT 1; */
   CREATE TABLE still_in_comment(id int); */
CREATE/* separator */TABLE IF NOT EXISTS public.system_dataset_appearance(id int);
CREATE OR REPLACE VIEW public.systemview_scanner AS SELECT 1;
-- CREATE TABLE trailing_comment(id int);`
	want := []string{"public.system_dataset_appearance", "public.systemview_scanner"}
	if got := literalCreatedTables(source); !reflect.DeepEqual(got, want) {
		t.Fatalf("comment text became a table, or real DDL disappeared: got %v want %v", got, want)
	}
}

func TestTableClassifierScannerPreservesQuotedText(t *testing.T) {
	for _, source := range []string{
		`SELECT '-- line /* block */', 'it''s -- quoted';`,
		`SELECT E'escaped \' -- still a string /* block */';`,
		`SELECT 'ordinary backslash\';`,
		`SELECT "identifier--/*""quote";`,
		`DO $$ BEGIN CREATE TABLE public.system_config(id int); -- body comment
/* body block */ END $$;`,
		`DO $Mixed_42$ BEGIN PERFORM '$$ -- /*'; END $Mixed_42$;`,
		`DO $välilehti$ BEGIN PERFORM '-- /*'; END $välilehti$;`,
		`SELECT name$inner$part, $1, '-- /*';`,
	} {
		// A dollar-quoted body is a literal at this SQL level; preserve it whole,
		// including embedded procedural DDL already covered by the inventory.
		if got := sqlWithoutComments(source + " -- outer comment\n"); got != source+"                 \n" {
			t.Fatalf("quoted text changed: got %q want prefix %q", got, source)
		}
	}
	if got := literalCreatedTables(`DO $body$ BEGIN CREATE TABLE public.system_config(id int); END $body$;`); !reflect.DeepEqual(got, []string{"public.system_config"}) {
		t.Fatal("dollar-body DDL disappeared", got)
	}
}

func TestTableClassifierScannerPreservesCommentLineEndings(t *testing.T) {
	const source = "-- ignored\r\nCREATE/* first\r\n/* nested */ last */TABLE public.system_config(id int);-- eof"
	filtered := sqlWithoutComments(source)
	if len(filtered) != len(source) {
		t.Fatal("comment masking changed source offsets")
	}
	for index := range source {
		if (source[index] == '\r' || source[index] == '\n') && filtered[index] != source[index] {
			t.Fatal("comment masking changed line endings", index)
		}
	}
	if got := literalCreatedTables(source); !reflect.DeepEqual(got, []string{"public.system_config"}) {
		t.Fatal("comment masking merged or removed DDL tokens", got)
	}
}
