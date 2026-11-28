// linked_label_evidence_test.go
// Holds evidence enumeration to the existing projection alias rules.
// Covers ordinary columns, actor marks, FK labels, collisions and cached names.
// Does not need PostgreSQL or change any row-query behavior.
package dtt_1_row_read

import (
	"testing"

	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

func TestLinkedLabelEvidenceUsesProjectionRules(t *testing.T) {
	for _, tc := range []struct {
		name             string
		columns          []string
		fk               map[string]dtt_utils.ForeignKey
		actors           row_mutation_policy.RowActorColumns
		cached           bool
		primary, related string
	}{
		{name: "ordinary", columns: []string{"owner_name"}},
		{name: "unlabelled FK", columns: []string{"owner_id"}, fk: map[string]dtt_utils.ForeignKey{"owner_id": {}}},
		{name: "labelled FK", columns: []string{"owner_id"}, fk: map[string]dtt_utils.ForeignKey{"owner_id": {NameColumn: "name"}}, primary: "owner_name (ln)", related: "owner_name"},
		{name: "actor", columns: []string{"owner_uid"}, actors: row_mutation_policy.RowActorColumns{"owner_uid": "owner"}, primary: "owner_name (ln)", related: "owner_name"},
		{name: "actor without suffix", columns: []string{"owner"}, actors: row_mutation_policy.RowActorColumns{"owner": "owner"}, primary: "owner_name", related: "owner_name"},
		{name: "related collision", columns: []string{"owner_id", "owner_name"}, fk: map[string]dtt_utils.ForeignKey{"owner_id": {NameColumn: "name"}}, primary: "owner_name (ln)", related: "owner_name (ln)"},
		{name: "cached primary", columns: []string{"owner_id", "owner_name"}, fk: map[string]dtt_utils.ForeignKey{"owner_id": {NameColumn: "name"}}, cached: true, related: "owner_name (ln)"},
		{name: "numbered collision", columns: []string{"owner_id", "owner_name", "owner_name (ln)"}, fk: map[string]dtt_utils.ForeignKey{"owner_id": {NameColumn: "name"}}, primary: "owner_name (ln)", related: "owner_name (ln 2)"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			relations := map[string]OneMRelation{}
			if tc.cached {
				relations["owner_id"] = OneMRelation{CachedNameColInSrc: "owner_name"}
			}
			aliases := linkedLabelEvidenceAliases(tc.columns, relations, tc.fk, visibleLabelTargetsForTest(tc.fk), tc.actors)
			for builder, want := range map[string]string{`return alias + " (ln)"`: tc.primary, `candidate = baseAlias + " (ln)"`: tc.related} {
				labels := aliases[builder]
				if want == "" && len(labels) != 0 || want != "" && (len(labels) != 1 || !labels[want]) {
					t.Fatalf("%s: %v want %q", builder, labels, want)
				}
			}
		})
	}
}

func TestLinkedLabelEvidenceNamesEachAliasSourceColumn(t *testing.T) {
	fk := map[string]dtt_utils.ForeignKey{"owner_id": {NameColumn: "name"}}
	actors := row_mutation_policy.RowActorColumns{"created_by": "creator"}
	evidence := linkedLabelEvidenceFrom(linkedLabelProjections(
		[]string{"created_by", "owner_id", "title"}, map[string]OneMRelation{}, fk, visibleLabelTargetsForTest(fk), actors))
	for alias, want := range map[string]string{
		"created_by_name": "created_by", // an actor column without an _id ending
		"owner_name (ln)": "owner_id",
		"owner_name":      "owner_id",
	} {
		if got := evidence.SourceColumns[alias]; len(got) != 1 || got[0] != want {
			t.Fatalf("%s: %v want %s", alias, got, want)
		}
	}
	if _, ok := evidence.SourceColumns["title_name"]; ok {
		t.Fatal("an ordinary column produced a linked label")
	}
}
