// request_finding_filter.go
// Separates request diagnostics from the retained whole-catalogue audit findings.
// Uses the same old/new dependency closure and metadata identities as refusals.
// Unrelated catalogue findings remain available without repeating them at INFO.
package runtime_grants

import "errors"

func requestGrantFindings(snapshot GrantSnapshot, before *GrantSnapshot, scope []int64, findings []Finding, err error) []Finding {
	closure := dependencyClosure(mutationDependencyGraph(snapshot, before), scope)
	var relevant []Finding
	for _, finding := range findings {
		if finding.Finding != "blocker" && finding.Finding != "excess_read_reported" {
			continue
		}
		affected := scope == nil || finding.Kind == "" && finding.Object == ""
		// Effective/direct read findings already carry their physical target.
		// Avoid resolving it against every object in a large catalogue again.
		if finding.Finding == "excess_read_reported" && finding.ObjectOID != 0 {
			affected = affected || closure[finding.ObjectOID]
		} else if !affected {
			for _, oid := range findingObjects(snapshot, finding) {
				affected = affected || closure[oid]
			}
			if before != nil && !affected {
				for _, oid := range findingObjects(*before, finding) {
					affected = affected || closure[oid]
				}
			}
		}
		if affected {
			relevant = append(relevant, finding)
		}
	}
	// A new blocker refuses HTTP mutations even outside their dependency closure.
	// Required-grant postchecks also carry the exact refusal through this path.
	var refusal *ScopeBlocker
	if errors.As(err, &refusal) {
		relevant = append(relevant, refusal.Findings...)
	}
	return normalizedFindings(relevant)
}
