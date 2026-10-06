// policy_diagnostics.go
// Isolates invalid requirements for read-only comparisons and stable reporting.
// Shares validation with the public pure policy, which still refuses partial grants.
// Keeps one bad destination from hiding independent missing or excess privileges.
package runtime_grants

import (
	"encoding/json"
	"fmt"
	"sort"
)

func sortedObjectOIDs(snapshot GrantSnapshot) []int64 {
	keys := make([]int64, 0, len(snapshot.Objects))
	for oid := range snapshot.Objects {
		keys = append(keys, oid)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	return keys
}

func sortedDependencies(dependencies []Dependency) []Dependency {
	result := append([]Dependency{}, dependencies...)
	sort.Slice(result, func(i, j int) bool {
		a, _ := json.Marshal(result[i])
		b, _ := json.Marshal(result[j])
		return string(a) < string(b)
	})
	return result
}

func policyProblem(diagnostics *[]Finding, object Object, err error) error {
	if diagnostics == nil {
		return err
	}
	*diagnostics = append(*diagnostics, Finding{Role: "policy", Kind: object.Kind,
		ObjectOID: object.OID, Object: object.Identifier(), Finding: "blocker", Reason: err.Error()})
	return nil
}

func classifiedSequenceOIDs(snapshot GrantSnapshot) map[int64]bool {
	classified := map[int64]bool{}
	for oid, object := range snapshot.Objects {
		if object.Kind == "sequence" && (object.Protected || object.Extension) {
			classified[oid] = true
		}
	}
	for _, use := range snapshot.Sequences {
		classified[use.SequenceOID] = true
	}
	return classified
}

// Unknown ordinary sequences block the pure policy individually. Diagnostic
// checks omit only their OIDs; unrelated effective and direct ACLs remain known.
func unclassifiedSequenceFindings(snapshot GrantSnapshot) []Finding {
	classified := classifiedSequenceOIDs(snapshot)
	var findings []Finding
	for _, oid := range sortedObjectOIDs(snapshot) {
		object := snapshot.Objects[oid]
		if object.Kind == "sequence" && !classified[oid] {
			findings = append(findings, Finding{Role: "policy", Kind: "sequence", ObjectOID: oid,
				Object: object.Identifier(), Finding: "blocker", Reason: "unclassified sequence " + object.Identifier()})
		}
	}
	return findings
}

func reviewedDependencies(snapshot GrantSnapshot, classes map[int64]TableClass, diagnostics *[]Finding) ([]Dependency, error) {
	if diagnostics == nil {
		if err := validateDependencyGraph(snapshot, classes); err != nil {
			return nil, err
		}
		return sortedDependencies(snapshot.Dependencies), nil
	}
	var valid []Dependency
	for _, dependency := range sortedDependencies(snapshot.Dependencies) {
		if err := validateDependency(snapshot, classes, dependency); err != nil {
			object := snapshot.Objects[dependency.TargetOID]
			policyProblem(diagnostics, object, fmt.Errorf("dependency %s from %s: %w", dependency.Kind, snapshot.Objects[dependency.SourceOID].Identifier(), err))
			continue
		}
		valid = append(valid, dependency)
	}
	return valid, nil
}

func validateDependency(snapshot GrantSnapshot, classes map[int64]TableClass, dependency Dependency) error {
	if classes[dependency.SourceOID] == "" || classes[dependency.TargetOID] == "" {
		return fmt.Errorf("unclassified dependency")
	}
	switch dependency.Kind {
	case "label", "embedding", "child", "bridge", "lock", "gallery_read":
	case "gallery", "gallery_insert":
		// The real gallery can have a product/dedicated parent. Its dormant
		// metadata is valid; add() refuses writes when a runtime consumer runs.
		if class := classes[dependency.TargetOID]; class != Content && class != Product && class != Dedicated {
			return fmt.Errorf("forbidden operational destination %s", snapshot.Objects[dependency.TargetOID].Identifier())
		}
	case "cache", "automation":
		if classes[dependency.TargetOID] != Content {
			return fmt.Errorf("forbidden operational destination %s", snapshot.Objects[dependency.TargetOID].Identifier())
		}
	default:
		return fmt.Errorf("unknown dependency kind")
	}
	for _, column := range append(append([]string{}, dependency.Columns...), dependency.ReadColumns...) {
		if !snapshot.Objects[dependency.TargetOID].hasColumn(column) {
			return fmt.Errorf("missing dependency column %s on %s", column, snapshot.Objects[dependency.TargetOID].Identifier())
		}
	}
	return nil
}

// Normalize even early failure results. Loader and ACL passes can report the
// same SQL path, so deduplicate only identical metadata findings after sorting.
func normalizedFindings(findings []Finding) []Finding {
	sort.Slice(findings, func(i, j int) bool {
		a, _ := json.Marshal(findings[i])
		b, _ := json.Marshal(findings[j])
		return string(a) < string(b)
	})
	unique := findings[:0]
	for _, finding := range findings {
		if len(unique) == 0 || unique[len(unique)-1] != finding {
			unique = append(unique, finding)
		}
	}
	return unique
}
