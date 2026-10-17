// ui_literal_evidence_test.go
// Proves translation trust and evidence have no limited-runtime write grant.
// Gives ordinary and guest groups every generic data route on both tables.
// Product classification must still deny writes, including column grants.
package runtime_grants

import "testing"

func TestUILiteralEvidenceTablesRejectNonAdminWrites(t *testing.T) {
	for _, name := range []string{"system_config", "system_lang_key_sources"} {
		s := policyFixture()
		object := s.Objects[10]
		object.Name = name
		s.Objects[10] = object
		class, err := ClassifyTable(object)
		if err != nil || class != Product {
			t.Fatal(class, err)
		}
		for group := int64(2); group <= 3; group++ {
			for function := int64(1); function <= 4; function++ {
				s.Rights = append(s.Rights, Right{GroupID: group, FunctionID: function, DatasetUID: 1})
			}
		}
		for _, grant := range grantsFor(t, s) {
			if grant.ObjectOID == 10 && grant.Privilege != "SELECT" {
				t.Fatalf("%s writable through limited role: %+v", name, grant)
			}
		}
	}
}
