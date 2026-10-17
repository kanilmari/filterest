// lang_key_declared_regression_test.go
// Exercises ordinary-column, cross-function and unmodelled-mutation counterexamples.
// Connects scoped prefix flow and actual row-label metadata to persisted evidence.
// Uses disposable in-memory SQL queues and leaves no database artifacts.
package system_table_tools

import (
	"database/sql/driver"
	"testing"
)

func TestB4PrefixMustReachBuilderInItsOwnScope(t *testing.T) {
	gate := `package example
// lang-key-declaration: {"build":"return prefix +","prefix":"notice_email_","values":["sent"]}
func example() string {
    prefix := "notice_email_"
    return prefix
}
func producer() string {
    prefix := "registration_email_"
    return prefix + "sent"
}`
	if got := declaredSources(t, "owner.go", gate); len(got) != 0 {
		t.Fatalf("gate counterexample produced evidence: %v", got)
	}
	for _, tc := range []struct {
		name, body string
		want       bool
	}{
		{"live", `prefix := "notice_email_"; return prefix + "sent"`, true},
		{"copied value", `value := "notice_email_"; prefix := value; return prefix + "sent"`, true},
		{"unrelated captured write", `prefix := "notice_email_"; other := ""; func() { other = "changed" }(); _ = other; return prefix + "sent"`, true},
		{"shadowed closure write", `prefix := "notice_email_"; func() { prefix := "other_"; prefix = "changed_"; _ = prefix }(); return prefix + "sent"`, true},
		{"read-only capture", `prefix := "notice_email_"; _ = func() { _ = prefix }; return prefix + "sent"`, true},
		{"overwritten", `prefix := "notice_email_"; prefix = "registration_email_"; return prefix + "sent"`, false},
		{"assigned after return", `prefix := "registration_email_"; return prefix + "sent"; prefix = "notice_email_"`, false},
		{"inner shadow", `prefix := "notice_email_"; { prefix := "registration_email_"; return prefix + "sent" }`, false},
		{"sibling scope", `{ prefix := "notice_email_"; _ = prefix }; prefix := "registration_email_"; return prefix + "sent"`, false},
		{"closure assignment", `prefix := "registration_email_"; _ = func() { prefix := "notice_email_"; _ = prefix }; return prefix + "sent"`, false},
		{"closure captured value", `prefix := "notice_email_"; _ = func() string { return prefix + "sent" }; return ""`, false},
		{"closure local value", `_ = func() string { prefix := "notice_email_"; return prefix + "sent" }; return ""`, true},
		{"branch value", `prefix := "registration_email_"; if welcome { prefix = "notice_email_" }; return prefix + "sent"`, true},
		{"dead branch value", `prefix := "registration_email_"; if welcome { prefix = "notice_email_"; return prefix }; return prefix + "sent"`, false},
		{"shadowed branch value", `prefix := "registration_email_"; if welcome { prefix := "notice_email_"; _ = prefix }; return prefix + "sent"`, false},
		{"branch overwrite", `prefix := "notice_email_"; if welcome { prefix = "registration_email_" } else { prefix = "other_" }; return prefix + "sent"`, false},
		{"constant false branch", `prefix := "registration_email_"; if false { prefix = "notice_email_" }; return prefix + "sent"`, false},
		{"constant true overwrite", `prefix := "notice_email_"; if true { prefix = "registration_email_" }; return prefix + "sent"`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "package example\n" + noticeDeclaration + "\nfunc producer(welcome bool) string { " + tc.body + " }"
			got := len(declaredSources(t, "owner.go", source)) > 0
			if got != tc.want {
				t.Fatalf("evidence=%v want %v", got, tc.want)
			}
		})
	}
	multipleResults := "package example\n" + noticeDeclaration + `
func producer() (string, string) {
    prefix := "registration_email_"
    other := "notice_email_"
    return prefix + "sent", other + "sent"
}`
	if got := declaredSources(t, "owner.go", multipleResults); len(got) != 0 {
		t.Fatalf("another returned value supplied the builder prefix: %v", got)
	}
}

func TestB4UnmodelledWritesCannotSupplyEvidence(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"gate invoked closure", `prefix := "notice_email_"; func() { prefix = "registration_email_" }(); return prefix + "sent"`},
		{"deferred closure", `prefix := "notice_email_"; defer func() { prefix = "registration_email_" }(); return prefix + "sent"`},
		{"goroutine closure", `prefix := "notice_email_"; go func() { prefix = "registration_email_" }(); return prefix + "sent"`},
		{"uninvoked captured write", `prefix := "notice_email_"; _ = func() { prefix = "registration_email_" }; return prefix + "sent"`},
		{"nested closure capture", `_ = func() string { prefix := "notice_email_"; func() { prefix = "registration_email_" }(); return prefix + "sent" }; return ""`},
		{"closure write in condition", `prefix := "notice_email_"; if func() bool { prefix = "registration_email_"; return false }() {}; return prefix + "sent"`},
		{"address and pointer write", `prefix := "notice_email_"; pointer := &prefix; *pointer = "registration_email_"; return prefix + "sent"`},
		{"address passed to call", `prefix := "notice_email_"; replace(&prefix); return prefix + "sent"`},
		{"address passed to defer", `prefix := "notice_email_"; defer replace(&prefix); return prefix + "sent"`},
		{"address passed to goroutine", `prefix := "notice_email_"; go replace(&prefix); return prefix + "sent"`},
		{"parenthesized address", `prefix := "notice_email_"; pointer := &(prefix); *pointer = "registration_email_"; return prefix + "sent"`},
		{"escaped then reassigned", `prefix := "notice_email_"; replace(&prefix); prefix = "notice_email_"; return prefix + "sent"`},
		{"copied unsafe value", `value := "notice_email_"; prefix := value; _ = func() { value = "registration_email_" }; return prefix + "sent"`},
		{"multiple assignment from call", `prefix := "notice_email_"; if welcome { prefix, _ = values() }; return prefix + "sent"`},
		{"declaration from call", `prefix := "notice_email_"; if welcome { var value, other = values(); prefix = value; _ = other }; return prefix + "sent"`},
		{"unknown branch assignment", `prefix := "notice_email_"; if welcome { prefix = value() }; return prefix + "sent"`},
		{"unknown identifier branch", `prefix := "notice_email_"; if welcome { prefix = unknown }; return prefix + "sent"`},
		{"unknown identifier else branch", `prefix := "notice_email_"; if welcome {} else { prefix = unknown }; return prefix + "sent"`},
		{"compound branch assignment", `prefix := "notice_email_"; if welcome { prefix += "changed_" }; return prefix + "sent"`},
		{"parenthesized assignment", `prefix := "notice_email_"; if welcome { (prefix) = "registration_email_" }; return prefix + "sent"`},
		{"label write", `prefix := "notice_email_"; if welcome { changed: prefix = "registration_email_"; goto changed }; return prefix + "sent"`},
		{"switch fallthrough write", `prefix := "notice_email_"; if welcome { switch { case welcome: prefix = "registration_email_"; fallthrough; default: } }; return prefix + "sent"`},
		{"select write", `prefix := "notice_email_"; if welcome { select { default: prefix = "registration_email_" } }; return prefix + "sent"`},
		{"channel range write", `prefix := "notice_email_"; if welcome { for prefix = range messages {} }; return prefix + "sent"`},
		{"loop write", `prefix := "notice_email_"; if welcome { for welcome { prefix = "registration_email_" } }; return prefix + "sent"`},
		{"unreachable capture still unsafe", `prefix := "notice_email_"; return prefix + "sent"; _ = func() { prefix = "registration_email_" }`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "package example\n" + noticeDeclaration + "\nfunc producer(welcome bool) string { " + tc.body + " }"
			if got := declaredSources(t, "owner.go", source); len(got) != 0 {
				t.Fatalf("unmodelled mutation produced evidence: %v", got)
			}
		})
	}
}

func TestB4ExactInvokedClosureGateReproducer(t *testing.T) {
	source := `package example
// lang-key-declaration: {"build":"return prefix +","prefix":"notice_email_","values":["sent"]}
func producer() string {
    prefix := "notice_email_"
    func() { prefix = "registration_email_" }()
    return prefix + "sent"
}`
	if got := declaredSources(t, "owner.go", source); len(got) != 0 {
		t.Fatalf("gate closure reproducer produced evidence: %v", got)
	}
}

func TestB4PrefixPointerReceiverMutationFailsClosed(t *testing.T) {
	for _, call := range []string{"prefix.replace()", "(prefix).replace()", "change := prefix.replace; change()"} {
		t.Run(call, func(t *testing.T) {
			source := "package example\n" + noticeDeclaration + `
type mutablePrefix string
func (p *mutablePrefix) replace() { *p = "registration_email_" }
func producer() mutablePrefix {
    var prefix mutablePrefix = "notice_email_"
    ` + call + `
    return prefix + "sent"
}`
			if got := declaredSources(t, "owner.go", source); len(got) != 0 {
				t.Fatalf("pointer receiver mutation produced evidence: %v", got)
			}
		})
	}
}

func queueB4LinkedMetadata(column string, foreign, actor bool) {
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"table_uid"}, rows: [][]driver.Value{{"tasks-uid"}}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"source_table", "source_column", "target_table", "target_column", "cached", "name"}})
	fk := orphanQueuedQuery{cols: []string{"referencing_column", "referenced_table", "referenced_column"}}
	if foreign {
		fk.rows = [][]driver.Value{{column, "system_user_groups", "id"}}
	}
	pushOrphanQuery(fk)
	if foreign {
		// No explicit display override: the same runtime resolver chooses the
		// established system_user_groups.name column.
		pushOrphanQuery(orphanQueuedQuery{cols: []string{"fk_display_column"}})
	}
	marks := orphanQueuedQuery{cols: []string{"column_name", "actor_role"}}
	if actor {
		marks.rows = [][]driver.Value{{column, "owner"}}
	}
	pushOrphanQuery(marks)
}

func TestB4LinkedEvidenceRequiresActualRelation(t *testing.T) {
	for _, tc := range []struct {
		name, column         string
		foreign, actor, want bool
	}{
		{"gate ordinary owner_name", "owner_name", false, false, false},
		{"ordinary owner_id", "owner_id", false, false, false},
		{"actual FK", "owner_id", true, false, true},
		{"actual actor", "owner_id", false, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			scanTrustFixture(t)
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"column_name", "table_name"}, rows: [][]driver.Value{{tc.column, "tasks"}}})
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"table_name"}})
			queueB4LinkedMetadata(tc.column, tc.foreign, tc.actor)
			if tc.want {
				pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			}
			keys := map[int64]bool{}
			count, err := scanSchemaLangKeySources(map[string]int64{"owner_name (ln)": 1}, []sourceEntry{{
				schemaAlias: true, schemaBuilder: `return alias + " (ln)"`, filePath: "app/backend/build_joins_1m.go",
			}, {
				schemaAlias: true, schemaBuilder: `candidate = baseAlias + " (ln)"`, filePath: "app/backend/related_items_query.go",
			}}, keys)
			if err != nil || keys[1] != tc.want || count != map[bool]int{false: 0, true: 1}[tc.want] {
				t.Fatalf("count=%d keys=%v err=%v", count, keys, err)
			}
		})
	}
}
