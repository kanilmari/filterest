// new_mutation_blockers.go
// Refuses newly invalid metadata in HTTP mutations, independently of dataset scope.
// Compares stable metadata row or catalogue identities in the before/after policy.
// Existing blockers retain the local rule; CSV and restore retain their scoped boundary.
package runtime_grants

import "fmt"

// NewMutationBlockers returns blockers whose metadata identity was valid or absent
// before the request. Changed diagnostic wording on an old blocker is immaterial.
func NewMutationBlockers(before, after GrantSnapshot) ([]Finding, error) {
	_, old, err := mutationPolicyChecks(before)
	if err != nil {
		return nil, err
	}
	_, current, err := mutationPolicyChecks(after)
	if err != nil {
		return nil, err
	}
	identities := map[string]bool{}
	for _, f := range old {
		if f.Finding == "blocker" {
			identities[blockerMetadataIdentity(f)] = true
		}
	}
	var introduced []Finding
	for _, f := range current {
		if f.Finding == "blocker" && !identities[blockerMetadataIdentity(f)] {
			introduced = append(introduced, f)
		}
	}
	return normalizedFindings(introduced), nil
}

func blockerMetadataIdentity(f Finding) string {
	if row := metadataRowID.FindStringSubmatch(f.Reason); len(row) != 0 {
		return fmt.Sprintf("row/%s/%s", f.Object, row[1])
	}
	if f.FunctionID != 0 {
		return fmt.Sprintf("route/%d", f.FunctionID)
	}
	if f.ObjectOID != 0 {
		return fmt.Sprintf("catalogue/%s/%d/%s", f.Kind, f.ObjectOID, f.Column)
	}
	return fmt.Sprintf("catalogue/%s/%s/%s", f.Kind, f.Object, f.Column)
}
