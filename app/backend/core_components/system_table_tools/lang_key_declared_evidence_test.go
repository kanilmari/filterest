// lang_key_declared_evidence_test.go
// Proves file-owned declarations flow through the real scanner and registry gate.
// Connects public and composition roots, schema aliases and source persistence.
// Removes declarations/builders independently so abandoned code cannot self-protect.
package system_table_tools

import (
	"database/sql/driver"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"easelect/backend/core_components/lang_key_naming"
)

const noticeDeclaration = `// lang-key-declaration: {"build":"return prefix +","prefix":"notice_email_","values":["sent","failed"]}`
const noticeBuilder = `package example
func producer() string { prefix := "notice_email_"; return prefix + "sent" }`

func declaredSources(t *testing.T, path, source string) []sourceEntry {
	t.Helper()
	_, tokens := lexLangKeyCode(source, filepath.Ext(path))
	candidates, err := declaredLangKeyCandidates(path, source, tokens)
	if err != nil {
		t.Fatal(err)
	}
	return candidates
}

func TestB4DeclarationRemovalAndBuilderRemoval(t *testing.T) {
	registry := map[string]int64{"notice_email_sent": 1, "notice_email_failed": 2, "notice_email_unrelated": 3}
	for _, tc := range []struct {
		name, source string
		want         int
	}{
		{"live", noticeDeclaration + "\n" + noticeBuilder, 2},
		{"declaration removed", noticeBuilder, 0},
		{"declaration inside block-comment example", "/*\n" + noticeDeclaration + "\n*/\n" + noticeBuilder, 0},
		{"builder removed", noticeDeclaration, 0},
		{"builder commented", noticeDeclaration + "\n// " + noticeBuilder, 0},
		{"prefix removed", noticeDeclaration + "\n" + strings.ReplaceAll(noticeBuilder, "notice_email_", "old_email_"), 0},
		{"prefix assigned to unrelated variable", noticeDeclaration + "\nother := \"notice_email_\"; return prefix + status", 0},
		{"declaration inside raw string", "const example = `\n" + noticeDeclaration + "\n`;\n" + noticeBuilder, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			found := resolveLangKeyCodeSources(declaredSources(t, "private/backend/owner.go", tc.source), registry)
			if len(found) != tc.want {
				t.Fatalf("sources=%v want %d", found, tc.want)
			}
			for _, entry := range found {
				if entry.sourceType != "" || entry.filePath != "private/backend/owner.go" || entry.langKey == "notice_email_unrelated" {
					t.Fatal(entry)
				}
			}
		})
	}
	// Proposed names absent from the registry can never create keys.
	if got := resolveLangKeyCodeSources(declaredSources(t, "owner.go", noticeDeclaration+"\n"+noticeBuilder), map[string]int64{}); len(got) != 0 {
		t.Fatal(got)
	}
}

func TestB4RealScanAcrossPublicAndCompositionRoots(t *testing.T) {
	scanTrustFixture(t)
	paths := currentLangKeyRuntimePaths()
	private := filepath.Join(paths.InstallationRoot, "private")
	createLangKeySourceRoot(t, private, false)
	old := configuredAdditionalLangKeySourceRoots()
	if err := ConfigureAdditionalLangKeySourceRoots([]string{private}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ConfigureAdditionalLangKeySourceRoots(old) })
	for _, root := range []string{paths.ApplicationRoot, private} {
		if err := os.WriteFile(filepath.Join(root, "backend", "owner.go"), []byte(noticeDeclaration+"\n"+noticeBuilder), 0600); err != nil {
			t.Fatal(err)
		}
	}
	candidates, err := scanCodebaseForLangKeySources()
	if err != nil {
		t.Fatal(err)
	}
	sources := resolveLangKeyCodeSources(candidates, map[string]int64{"notice_email_sent": 1})
	owners := map[string]bool{}
	for _, source := range sources {
		if source.sourceType == "" {
			owners[filepath.ToSlash(source.filePath)] = true
		}
	}
	if !owners["app/backend/owner.go"] || !owners["private/backend/owner.go"] {
		t.Fatal(owners)
	}
	// Removing the public declaration leaves evidence only in the composition.
	if err := os.WriteFile(filepath.Join(paths.ApplicationRoot, "backend", "owner.go"), []byte(noticeBuilder), 0600); err != nil {
		t.Fatal(err)
	}
	candidates, err = scanCodebaseForLangKeySources()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range resolveLangKeyCodeSources(candidates, map[string]int64{"notice_email_sent": 1}) {
		if source.sourceType == "" && strings.HasPrefix(source.filePath, "app/") {
			t.Fatal(source)
		}
	}
}

func TestB4MalformedDeclarationFailsCodeScan(t *testing.T) {
	scanTrustFixture(t)
	path := filepath.Join(currentLangKeyRuntimePaths().ApplicationRoot, "backend", "broken.go")
	if err := os.WriteFile(path, []byte(`// lang-key-declaration: {"build":"x","prefix":"all_"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := scanCodebaseForLangKeySources(); err == nil {
		t.Fatal("invalid declaration counted as successful scan")
	}
}

func TestB4SchemaEvidenceRequiresColumnAndLiveProducer(t *testing.T) {
	for _, live := range []bool{true, false} {
		t.Run(map[bool]string{true: "live", false: "removed"}[live], func(t *testing.T) {
			scanTrustFixture(t)
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"column_name", "table_name"}, rows: [][]driver.Value{{"owner_uid", "tasks"}}})
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"table_name"}})
			sources := []sourceEntry{}
			if live {
				sources = append(sources, sourceEntry{schemaAlias: true, schemaBuilder: `return alias + " (ln)"`, filePath: "app/backend/alias.go"})
				queueB4LinkedMetadata("owner_uid", false, true)
				pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			}
			registry := map[string]int64{"search_for_owner_name (ln)_asc": 1, "missing_name (ln)": 2}
			codeKeys := map[int64]bool{}
			_, err := immediateSourceWriter().scanSchemaLangKeySources(registry, sources, codeKeys)
			if err != nil {
				t.Fatal(err)
			}
			if codeKeys[1] != live || codeKeys[2] {
				t.Fatal(codeKeys)
			}
			calls := strings.Join(snapshotOrphanCalls(), "\n")
			if strings.Contains(calls, "INSERT INTO system_lang_key_sources") != live {
				t.Fatal(calls)
			}
		})
	}
}

func TestB4DeclaredExistingKeysAndOwners(t *testing.T) {
	paths := []string{
		"frontend/reusable_components/media_library_picker/media_library_picker.js",
		"frontend/core_components/admin_tools/dataset_alias_management_copy.js",
		"frontend/core_components/admin_tools/row_group_assignment_editor.js",
		"backend/core_components/email/account_email.go",
		"backend/core_components/application_updates/admission_handler.go",
		"backend/core_components/dynamic_table_tools/dtt_triggers/notification_triggers.go",
		"backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/build_joins_1m.go",
		"backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/related_items_query.go",
	}
	app := filepath.Join("..", "..", "..")
	var seed strings.Builder
	for _, folder := range []string{"server_tools/migrations", "server_tools/public_bootstrap/source"} {
		files, err := filepath.Glob(filepath.Join(app, folder, "*.sql"))
		if err != nil {
			t.Fatal(err)
		}
		for _, file := range files {
			name := strings.ToLower(filepath.Base(file))
			skip := false
			for _, word := range []string{"secret", "token", "password", "credential"} {
				skip = skip || strings.Contains(name, word)
			}
			if skip {
				continue
			}
			raw, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			seed.Write(raw)
		}
	}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(app, path))
			if err != nil {
				t.Fatal(err)
			}
			found := declaredSources(t, "app/"+path, string(raw))
			if len(found) == 0 {
				t.Fatal("declaration lost its actual builder")
			}
			for _, source := range found {
				if !source.schemaAlias && !strings.Contains(seed.String(), "'"+source.langKey+"'") {
					t.Errorf("declared key has no seed: %s", source.langKey)
				}
			}
			// A declaration cannot protect itself after the owner loses its prefix.
			for _, line := range strings.Split(string(raw), "\n") {
				if !strings.HasPrefix(line, lang_key_naming.DeclarationMarker) {
					continue
				}
				d, err := lang_key_naming.ParseDeclaration(path, line)
				if err != nil {
					t.Fatal(err)
				}
				if d.Prefix == "" {
					continue
				}
				without := strings.ReplaceAll(strings.ReplaceAll(string(raw), line, ""), d.Prefix, "removed_") + "\n" + line
				if entries := declaredSources(t, path, without); len(entries) != 0 && len(found) == len(entries) {
					t.Fatal("declaration survived loss of owner prefix")
				}
			}
		})
	}
}

func TestB4DeclaredKeyCountsInPopulationFloor(t *testing.T) {
	for _, live := range []bool{true, false} {
		t.Run(map[bool]string{true: "declared", false: "removed"}[live], func(t *testing.T) {
			scanTrustFixture(t)
			source := noticeBuilder
			if live {
				source = noticeDeclaration + "\n" + source
			}
			path := filepath.Join(currentLangKeyRuntimePaths().ApplicationRoot, "backend", "owner.go")
			if err := os.WriteFile(path, []byte(source), 0600); err != nil {
				t.Fatal(err)
			}
			queries := emptySourceScanQueries()
			queries[0].rows = [][]driver.Value{{int64(1), "notice_email_sent"}}
			for _, q := range queries {
				pushOrphanQuery(q)
			}
			if live {
				pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			}
			queueCodeSourceHistory([]codeSourceSample{{RuleVersion: langKeyScannerRuleVersion, At: timeNowUTC(), Count: 1}})
			if live {
				pushOrphanExec(orphanQueuedExec{})
			}
			count, err := PopulateLangKeySources()
			if err != nil {
				t.Fatal(err)
			}
			if SourceScanIsFresh() != live {
				t.Fatalf("declaration must be code evidence in the floor, live=%v count=%d", live, count)
			}
		})
	}
}

func TestB4RealApplicationScanAcceptsAllDeclarations(t *testing.T) {
	app, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	replaceLangKeyRuntimePathsForTest(t, langKeyRuntimePaths(filepath.Dir(app), app))
	replaceAdditionalLangKeySourceRootsForTest(t, nil)
	candidates, err := scanCodebaseForLangKeySources()
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int64{
		"notice_email_not_configured":                    1,
		"notice_email_failed":                            2,
		"notice_email_sent":                              3,
		"registration_email_not_configured":              4,
		"registration_email_failed":                      5,
		"registration_email_sent":                        6,
		"error_application_update_admission_unavailable": 7,
		"error_trigger_target_dataset_missing":           8,
		"dataset_alias_saved":                            9,
		"row_group_window_name_en":                       10,
		"media_library_choose":                           11,
	}
	found := map[string]bool{}
	for _, source := range resolveLangKeyCodeSources(candidates, want) {
		if source.sourceType == "" {
			found[source.langKey] = true
		}
	}
	for key := range want {
		if !found[key] {
			t.Errorf("actual source scan missed %s", key)
		}
	}
}
