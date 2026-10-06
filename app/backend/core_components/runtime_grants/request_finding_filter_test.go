// request_finding_filter_test.go
// Proves catalogue size cannot amplify an unrelated request's INFO findings.
// Covers old/new closures, sequence targets and refusals outside the request.
package runtime_grants

import (
	"fmt"
	"testing"
)

func TestRequestFindingsStayBoundedBesideLargeCatalogue(t *testing.T) {
	s := policyFixture()
	old := policyFixture()
	old.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 11}}
	s.Sequences = []SequenceUse{{TableOID: 11, SequenceOID: 91}}
	s.Objects[91] = Object{OID: 91, Kind: "sequence", Schema: "public", Name: "old_target_seq"}
	var findings []Finding
	for i := int64(1000); i < 11000; i++ {
		s.Objects[i] = Object{OID: i, Kind: "table", Schema: "public", Name: fmt.Sprintf("outside_%d", i)}
		findings = append(findings, Finding{ObjectOID: i, Object: s.Objects[i].Identifier(), Kind: "table", Finding: "excess_read_reported"})
	}
	for _, oid := range []int64{10, 11, 91} {
		findings = append(findings, Finding{ObjectOID: oid, Object: s.Objects[oid].Identifier(), Kind: s.Objects[oid].Kind, Finding: "excess_read_reported"})
	}
	got := requestGrantFindings(s, &old, []int64{10}, findings, nil)
	if len(got) != 3 {
		t.Fatal("catalogue findings escaped the request closure", len(got))
	}
	outsideRefusal := Finding{ObjectOID: 1000, Object: s.Objects[1000].Identifier(), Kind: "table", Finding: "blocker"}
	got = requestGrantFindings(s, &old, []int64{10}, findings, &ScopeBlocker{Findings: []Finding{outsideRefusal}})
	if len(got) != 4 {
		t.Fatal("outside refusing blocker was hidden", got)
	}
}
