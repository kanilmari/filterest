// lang_key_code_evidence_test.go
// Protects raw literal recall, including comments, without promoting it to code.
// Exercises the production registry gate and reviewed Home helper import scope.
// Measures the source-only scan without a running application or database.
package system_table_tools

import (
	"os"
	"path/filepath"
	"testing"

	"easelect/backend/core_components/runtimepaths"
)

func TestB3LiteralRecallAfterAmbiguousQuotes(t *testing.T) {
	for _, c := range []struct{ name, source string }{
		{"gate regex after control condition", `if (ok) /"/.test(value); const key = "sort_set_default";`},
		{"division after parenthesized expression", `(a + b) / 2; const k = "sort_set_default";`},
		{"unterminated double quote", "const broken = \"unfinished\nconst k = \"sort_set_default\";"},
		{"unterminated single quote CRLF", "const broken = 'unfinished\r\nconst k = 'sort_set_default';"},
		{"escaped newline still resynchronizes", "const broken = \"unfinished\\\nconst k = \"sort_set_default\";"},
		{"unterminated template", "const broken = `unfinished\nconst k = \"sort_set_default\";"},
		{"overlapping quote pairs on same line", `if (ok) /"/.test(value); const k = 'other'; const key = "sort_set_default";`},
		{"union survives unclassified block regex", `if (ok) {} /"/.test(value); const key = "sort_set_default";`},
	} {
		t.Run(c.name, func(t *testing.T) {
			entries := resolvedCodeInFile("app/frontend/ordinary.js", c.source, map[string]int64{"sort_set_default": 1})
			if len(entries) != 1 || entries[0].langKey != "sort_set_default" || entries[0].sourceType != "code_literal" {
				t.Fatalf("later exact key lost or promoted to definite code: %v", entries)
			}
		})
	}
}

func TestB3RegexQuotedKeyMayBeLiteralFalsePositive(t *testing.T) {
	// D3a prefers recall: an exact quoted name inside a regex may keep a dead
	// key alive, but it must never count toward the definite-code safety floor.
	for _, source := range []string{
		`if (ok) /"sort_set_default"/.test(value);`,
		`const expression = /"sort_set_default"/;`,
	} {
		entries := resolvedCodeInFile("app/frontend/ordinary.js", source, map[string]int64{"sort_set_default": 1})
		if len(entries) != 1 || entries[0].sourceType != "code_literal" {
			t.Fatalf("conservative regex literal evidence: %v", entries)
		}
	}
}

func TestB3RawLiteralFallbackIgnoresCommentMasking(t *testing.T) {
	// Exercise production file reading too: a helper-only test could pass raw
	// text while population still feeds the fallback the lexer's masked output.
	for _, c := range []struct{ name, source string }{
		{"gate 208b line marker in block regex", `if (ok) {} /[//]/.test(value); const key = "sort_set_default";`},
		{"gate 208b block marker in block regex", "if (ok) {} /[/*]/.test(value);\nconst key = \"sort_set_default\";"},
		{"gate 208a quote in control regex", `if (ok) /"/.test(value); const key = "sort_set_default";`},
		{"unterminated block comment", "/* no close\nconst key = \"sort_set_default\";"},
		{"line comment double quote", `// "sort_set_default"`},
		{"line comment single quote", `// 'sort_set_default'`},
		{"line comment backtick", "// `sort_set_default`"},
		{"overlapping quotes inside comment", `// "example 'sort_set_default'"`},
	} {
		t.Run(c.name, func(t *testing.T) {
			scanTrustFixture(t)
			path := filepath.Join(currentLangKeyRuntimePaths().ApplicationRoot, "frontend", "ordinary.js")
			if err := os.WriteFile(path, []byte(c.source), 0600); err != nil {
				t.Fatal(err)
			}
			candidates, err := scanCodebaseForLangKeySources()
			if err != nil {
				t.Fatal(err)
			}
			entries := resolveLangKeyCodeSources(candidates, map[string]int64{"sort_set_default": 1})
			if len(entries) != 1 || entries[0].langKey != "sort_set_default" || entries[0].sourceType != "code_literal" {
				t.Fatalf("raw exact key lost or promoted to definite code: %v", entries)
			}
		})
	}
}

func TestB3RawArrayAndPrefixRecognisers(t *testing.T) {
	for _, c := range []struct {
		name, source, key string
		wantCode          bool
	}{
		{"208d property array", `if (ok) {} /[//]/.test(value); const COPY = { view_chart: ['Kaavio', 'Chart'] };`, "view_chart", false},
		{"208d variable prefix", `if (ok) {} /[//]/.test('x'); const key = 'label_value_layout_' + value;`, "label_value_layout_inline", false},
		{"property array control", `if (ok) {} const COPY = { view_chart: ['Kaavio', 'Chart'] };`, "view_chart", true},
		{"variable prefix control", `if (ok) {} const key = 'label_value_layout_' + value;`, "label_value_layout_inline", true},
		{"commented property array", `// const COPY = { view_chart: ['Kaavio', 'Chart'] };`, "view_chart", false},
		{"commented variable prefix", `// const key = 'label_value_layout_' + value;`, "label_value_layout_inline", false},
		{"commented quoted property", `// const COPY = { 'view_chart': ['Kaavio', 'Chart'] };`, "view_chart", false},
		{"commented template prefix", "// const key = `label_value_layout_${value}`;", "label_value_layout_inline", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			scanTrustFixture(t)
			path := filepath.Join(currentLangKeyRuntimePaths().ApplicationRoot, "frontend", "ordinary.js")
			// Include unregistered candidates to exercise the registry boundary.
			source := c.source + "\n// unknown_array: ['copy']; const key = 'unknown_prefix_' + value;"
			if err := os.WriteFile(path, []byte(source), 0600); err != nil {
				t.Fatal(err)
			}
			candidates, err := scanCodebaseForLangKeySources()
			if err != nil {
				t.Fatal(err)
			}
			entries := resolveLangKeyCodeSources(candidates, map[string]int64{c.key: 1})
			if hasDefiniteCode(entries) != c.wantCode {
				t.Fatalf("definite code changed: %v, want %v", entries, c.wantCode)
			}
			literal := false
			for _, entry := range entries {
				if entry.langKey != c.key {
					t.Fatalf("unregistered key escaped registry filter: %v", entries)
				}
				literal = literal || entry.sourceType == "code_literal"
			}
			if !literal && !c.wantCode {
				t.Fatalf("raw recogniser lost literal evidence: %v", entries)
			}
		})
	}
}

func TestB3LiteralRecoveryIncludesCommentsWithoutDefiniteCode(t *testing.T) {
	// D3a includes comments in the literal safety net: false hits only keep
	// existing keys alive. Comments must still never count as definite code.
	for _, c := range []struct{ name, path, source string }{
		{"line after broken quote", "ordinary.js", "const broken = \"unfinished\n// \"comment_only\"\nconst k = \"sort_set_default\";"},
		{"block after broken quote", "ordinary.js", "const broken = 'unfinished\n/* 'comment_only' */\nconst k = 'sort_set_default';"},
		{"line after control regex", "ordinary.js", "if (ok) /\"/.test(value); // \"comment_only\"\nconst k = \"sort_set_default\";"},
		{"block after control regex", "ordinary.js", `if (ok) /"/.test(value); /* "comment_only" */ const k = "sort_set_default";`},
		{"HTML after broken quote", "ordinary.html", "<p title=\"unfinished\n<!-- \"comment_only\" -->\n<p data-name=\"sort_set_default\">"},
		{"Go raw string recovery", "ordinary.go", "var broken = `unfinished\n// \"comment_only\"\nvar k = \"sort_set_default\""},
	} {
		t.Run(c.name, func(t *testing.T) {
			entries := resolvedCodeInFile("app/frontend/"+c.path, c.source, map[string]int64{"sort_set_default": 1, "comment_only": 2})
			if len(entries) != 2 {
				t.Fatalf("D3a must retain both the real key and the quoted comment key: %v", entries)
			}
			for _, entry := range entries {
				if entry.sourceType != "code_literal" {
					t.Fatalf("comment or recovered literal promoted to definite code: %v", entries)
				}
			}
		})
	}
}

func TestB3HomeHelpersRequireRealModuleImport(t *testing.T) {
	for _, c := range []struct {
		name, prefix string
		wantCode     bool
	}{
		{"plain filename string", `const filename = "front_page_settings_controls.js";`, false},
		{"import-looking string", `const example = "import { frontPageText } from './front_page_settings_controls.js'";`, false},
		{"commented import", "// import { frontPageText } from './front_page_settings_controls.js';\n", false},
		{"other module", `import { frontPageText } from './other_front_page_settings_controls.js';`, false},
		{"named import", `import { frontPageText } from './front_page_settings_controls.js';`, true},
		{"multiline commented import", "import {\nfrontPageText\n} /* owner */ from\n'./front_page_settings_controls.js';", true},
	} {
		t.Run(c.name, func(t *testing.T) {
			source := c.prefix + `frontPageText("sort_set_default");`
			entries := resolvedCodeInFile("app/frontend/ordinary.js", source, map[string]int64{"sort_set_default": 1})
			if hasDefiniteCode(entries) != c.wantCode {
				t.Fatalf("helper scope: %v, want definite code %v", entries, c.wantCode)
			}
			literal := false
			for _, entry := range entries {
				literal = literal || entry.sourceType == "code_literal"
			}
			if !literal {
				t.Fatalf("helper scope must retain literal safety net: %v", entries)
			}
		})
	}
}

func BenchmarkB3LangKeyCodebaseScan(b *testing.B) {
	applicationRoot, err := filepath.Abs("../../..")
	if err != nil {
		b.Fatal(err)
	}
	previous := currentLangKeyRuntimePaths
	currentLangKeyRuntimePaths = func() runtimepaths.Paths {
		return langKeyRuntimePaths(filepath.Dir(applicationRoot), applicationRoot)
	}
	b.Cleanup(func() { currentLangKeyRuntimePaths = previous })
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := scanCodebaseForLangKeySources(); err != nil {
			b.Fatal(err)
		}
	}
}
