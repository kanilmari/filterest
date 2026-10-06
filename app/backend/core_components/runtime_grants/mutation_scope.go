// mutation_scope.go
// Keeps blockers local to a request while preserving unclassified objects' ACLs.
// Compares old and new policy inputs so removal of the last consumer is visible.
// Reuses the policy's diagnostic evaluator rather than inventing grant rules.
package runtime_grants

import (
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

func reconciliationChecks(snapshot GrantSnapshot, before *GrantSnapshot, scope []int64) ([]Check, []Finding, error) {
	checks, findings, err := mutationPolicyChecks(snapshot)
	if err != nil {
		return nil, findings, err
	}
	if before != nil {
		// A shared metadata refresh may incidentally register an unknown table.
		// Its old uncertainty still protects its ACLs for this request.
		_, previous, err := mutationPolicyChecks(*before)
		if err != nil {
			return nil, findings, err
		}
		for _, finding := range previous {
			if finding.Finding == "blocker" {
				findings = append(findings, finding)
			}
		}
	}
	checks, err = excludeBlockedChecks(snapshot, before, scope, checks, findings)
	return checks, normalizedFindings(findings), err
}

func mutationPolicyChecks(snapshot GrantSnapshot) ([]Check, []Finding, error) {
	findings := append([]Finding{}, snapshot.Findings...)
	findings = append(findings, snapshot.Blockers...)
	comparison := snapshot
	comparison.Blockers = nil
	comparison.Functions = map[int64]Function{}
	unknown := map[int64]bool{}
	for _, finding := range unclassifiedRouteFindings(snapshot) {
		unknown[finding.FunctionID] = true
	}
	for id, function := range snapshot.Functions {
		if !unknown[id] {
			comparison.Functions[id] = function
		}
	}
	comparison.Rights = nil
	for _, right := range snapshot.Rights {
		if !unknown[right.FunctionID] {
			comparison.Rights = append(comparison.Rights, right)
		}
	}
	desired, err := evaluateRuntimeGrants(comparison, &findings)
	if err != nil {
		return nil, findings, err
	}
	checks, err := BuildGrantChecks(comparison, desired)
	if err != nil {
		return nil, findings, err
	}
	return checks, findings, nil
}

func dependencyClosure(snapshot GrantSnapshot, initial []int64) map[int64]bool {
	closure := map[int64]bool{}
	for _, oid := range initial {
		if oid != 0 {
			closure[oid] = true
		}
	}
	for changed := true; changed; {
		changed = false
		include := func(oid int64) {
			if oid != 0 && !closure[oid] {
				closure[oid] = true
				changed = true
			}
		}
		for _, dependency := range snapshot.Dependencies {
			if closure[dependency.SourceOID] {
				include(dependency.TargetOID)
				include(dependency.RelatedOID)
			}
		}
		for _, use := range snapshot.Sequences {
			if closure[use.TableOID] {
				include(use.SequenceOID)
			}
		}
	}
	return closure
}

var findingUIDPattern = regexp.MustCompile(`(?:target_table_uid|source_table_uid|table_uid|table_a_uid|table_b_uid|bridging_table_uid)=([0-9]+)`)

// DatasetScopeIdentity also keeps missing datasets addressable by a request.
// PostgreSQL OIDs are positive; a negative UID is a scope-only identity with no
// physical grant checks. Unrelated dangling rows therefore remain distinguishable.
func DatasetScopeIdentity(snapshot GrantSnapshot, uid int64) int64 {
	if uid <= 0 {
		return 0
	}
	if oid := oidByUID(&snapshot, uid); oid != 0 {
		return oid
	}
	return -uid
}

// Old audit findings include row keys and identifiers rather than row values.
// Resolve their explicit metadata identities; never guess from a table prefix.
func findingObjects(snapshot GrantSnapshot, finding Finding) []int64 {
	if strings.HasPrefix(finding.Kind, "default_") {
		return nil
	}
	oids := append([]int64{}, finding.ScopeOIDs[:]...)
	metadataRow := strings.HasPrefix(finding.Reason, "row ")
	// A row diagnostic names its storage registry for the audit. That registry
	// is not the row's dataset: one dangling entry must not block every request
	// that registers a different dataset or references registry metadata.
	if !metadataRow {
		if _, ok := snapshot.Objects[finding.ObjectOID]; ok {
			oids = append(oids, finding.ObjectOID)
		}
	}
	for oid, object := range snapshot.Objects {
		if (!metadataRow && finding.Object == object.Identifier()) || strings.Contains(finding.Reason, object.Identifier()) {
			oids = append(oids, oid)
		}
	}
	for _, match := range findingUIDPattern.FindAllStringSubmatch(finding.Reason, -1) {
		uid, _ := strconv.ParseInt(match[1], 10, 64)
		oids = append(oids, DatasetScopeIdentity(snapshot, uid))
	}
	if finding.FunctionID != 0 {
		for _, right := range snapshot.Rights {
			if right.FunctionID == finding.FunctionID {
				oids = append(oids, oidByUID(&snapshot, right.DatasetUID))
			}
		}
	}
	return oids
}

func excludeBlockedChecks(snapshot GrantSnapshot, before *GrantSnapshot, scope []int64, checks []Check, findings []Finding) ([]Check, error) {
	return filterBlockedChecks(snapshot, before, scope, checks, findings, false)
}

// Startup keeps every known positive requirement, even on a blocked object.
// Legacy uncertainty protects revocations, while only structural findings refuse boot.
func filterBlockedChecks(snapshot GrantSnapshot, before *GrantSnapshot, scope []int64, checks []Check, findings []Finding, startup bool) ([]Check, error) {
	graph := mutationDependencyGraph(snapshot, before)
	closure := dependencyClosure(graph, scope)
	blocked := map[int64]bool{}
	var refusal []Finding
	for _, finding := range findings {
		if finding.Finding != "blocker" {
			continue
		}
		oids := findingObjects(snapshot, finding)
		if before != nil {
			oids = append(oids, findingObjects(*before, finding)...)
		}
		affected := scope == nil && !startup
		for _, oid := range oids {
			if oid != 0 {
				blocked[oid] = true
				affected = affected || (!startup && closure[oid])
			}
		}
		// Role preconditions and absent principal registries are structural;
		// their union cannot be computed safely for any request.
		if finding.Kind == "" && finding.Object == "" {
			affected = true
		}
		if finding.Kind == "event_trigger" && len(closure) != 0 && !startup {
			affected = true
		}
		if affected {
			refusal = append(refusal, finding)
		}
	}
	if len(refusal) != 0 {
		return nil, &ScopeBlocker{Findings: normalizedFindings(refusal)}
	}
	// Directly unknown objects keep their ACLs. Consumers and downstream targets
	// still need the known application grants: uncertainty can require more
	// privileges, never fewer. Suppress only revocation checks on those objects.
	directlyBlocked := map[int64]bool{}
	for oid := range blocked {
		directlyBlocked[oid] = true
	}
	for changed := true; changed; {
		changed = false
		for _, dependency := range graph.Dependencies {
			if (blocked[dependency.TargetOID] || blocked[dependency.RelatedOID]) && !blocked[dependency.SourceOID] {
				blocked[dependency.SourceOID] = true
				changed = true
			}
		}
	}
	var seeds []int64
	for oid := range blocked {
		seeds = append(seeds, oid)
	}
	blocked = dependencyClosure(graph, seeds)
	var safe []Check
	globalSQLBlocker := startup && hasGlobalSQLBlocker(findings)
	for _, check := range checks {
		if !startup && (check.Role != "basic" && check.Role != "guest" || directlyBlocked[check.ObjectOID]) {
			continue
		}
		if blocked[check.ObjectOID] || globalSQLBlocker {
			check.Managed = false
		}
		safe = append(safe, check)
	}
	return safe, requireRequestGrantChecks(snapshot, closure, checks, safe)
}

// Both removed and current dependencies protect grants. Combining their edges
// also handles paths that alternate between the old and new graphs.
func mutationDependencyGraph(snapshot GrantSnapshot, before *GrantSnapshot) GrantSnapshot {
	graph := snapshot
	if before != nil {
		graph.Dependencies = append(append([]Dependency{}, snapshot.Dependencies...), before.Dependencies...)
		graph.Sequences = append(append([]SequenceUse{}, snapshot.Sequences...), before.Sequences...)
	}
	return graph
}

// A success must never result from dropping the request's positive checks.
func requireRequestGrantChecks(snapshot GrantSnapshot, closure map[int64]bool, required, retained []Check) error {
	present := map[string]bool{}
	for _, check := range retained {
		if check.Wanted {
			present[grantKey(check.Grant)] = true
		}
	}
	var missing []Finding
	for _, check := range required {
		if check.Wanted && (check.Role == "basic" || check.Role == "guest") && closure[check.ObjectOID] && !present[grantKey(check.Grant)] {
			missing = append(missing, Finding{Role: check.Role, Kind: check.Kind, ObjectOID: check.ObjectOID,
				Object: snapshot.Objects[check.ObjectOID].Identifier(), Column: check.Column, Privilege: check.Privilege,
				Finding: "blocker", Reason: "required runtime grant check was excluded"})
		}
	}
	if len(missing) != 0 {
		return &ScopeBlocker{Findings: normalizedFindings(missing)}
	}
	return nil
}

// ChangedDatasetOIDs includes old targets, changed route identities, groups,
// guest membership, physical identities and dependency endpoints.
func ChangedDatasetOIDs(before, after GrantSnapshot) []int64 {
	changed := map[int64]bool{}
	addUID := func(s GrantSnapshot, uid int64) {
		if oid := DatasetScopeIdentity(s, uid); oid != 0 {
			changed[oid] = true
		}
	}
	for _, pair := range []struct{ a, b GrantSnapshot }{{before, after}, {after, before}} {
		otherBlockers := map[string]bool{}
		for _, finding := range pair.b.Blockers {
			otherBlockers[blockerScopeIdentity(pair.b, finding)] = true
		}
		for _, finding := range pair.a.Blockers {
			if !otherBlockers[blockerScopeIdentity(pair.a, finding)] {
				for _, oid := range findingObjects(pair.a, finding) {
					changed[oid] = true
				}
			}
		}
		for oid, object := range pair.a.Objects {
			if !reflect.DeepEqual(object, pair.b.Objects[oid]) {
				changed[oid] = true
			}
		}
		otherRights := map[Right]bool{}
		for _, right := range pair.b.Rights {
			otherRights[right] = true
		}
		for _, right := range pair.a.Rights {
			if !otherRights[right] || !reflect.DeepEqual(pair.a.Functions[right.FunctionID], pair.b.Functions[right.FunctionID]) || pair.a.Groups[right.GroupID] != pair.b.Groups[right.GroupID] || pair.a.GuestGroups[right.GroupID] != pair.b.GuestGroups[right.GroupID] || (right.GroupID == pair.a.GuestGroupID) != (right.GroupID == pair.b.GuestGroupID) {
				addUID(pair.a, right.DatasetUID)
			}
		}
		otherDeps := map[string]bool{}
		for _, dependency := range pair.b.Dependencies {
			otherDeps[fmt.Sprintf("%#v", dependency)] = true
		}
		for _, dependency := range pair.a.Dependencies {
			if !otherDeps[fmt.Sprintf("%#v", dependency)] {
				changed[dependency.SourceOID] = true
				changed[dependency.TargetOID] = true
				changed[dependency.RelatedOID] = true
			}
		}
	}
	var result []int64
	for oid := range changed {
		if oid != 0 {
			result = append(result, oid)
		}
	}
	return result
}

// A diagnostic is not a policy input. Preserve the HTTP gate's stable row or
// catalogue identity and compare only its resolved, canonical endpoint set.
func blockerScopeIdentity(snapshot GrantSnapshot, finding Finding) string {
	seen := map[int64]bool{}
	var endpoints []int64
	for _, oid := range findingObjects(snapshot, finding) {
		if oid != 0 && !seen[oid] {
			seen[oid] = true
			endpoints = append(endpoints, oid)
		}
	}
	sort.Slice(endpoints, func(i, j int) bool { return endpoints[i] < endpoints[j] })
	return fmt.Sprintf("%s/%v", blockerMetadataIdentity(finding), endpoints)
}
