// dataset_grant_policy.go
// Computes runtime privileges from declared capabilities and operation dependencies.
// Connects the snapshot to the audit and future transactional reconciler.
// Never reads old ACLs, performs SQL, or mutates application rights.
package runtime_grants

import (
	"fmt"
	"strings"
)

var routeOperations = map[string]Operation{
	"/api/get-results":             Read,
	"/api/get-intelligent-results": Read,
	"/api/get-row-count":           Read,
	"/api/get-filter-options":      Read,
	"/api/get-results-vector":      Read,
	"/api/fetch-dynamic-children":  Read,
	"/api/add-row-multipart":       Insert,
	"/api/update-row":              Update,
	"/api/delete-rows":             Delete,
}

type capabilities struct{ ordinary, strict Operation }

// DesiredDatasetRuntimeGrants returns a target's grants including inbound
// dependencies from every dataset, with independent copied child rights.
func DesiredDatasetRuntimeGrants(snapshot GrantSnapshot, datasetUID int64) (GrantSet, error) {
	var targetOID int64
	for oid, object := range snapshot.Objects {
		if object.DatasetUID == datasetUID && datasetUID > 0 {
			targetOID = oid
			break
		}
	}
	if targetOID == 0 {
		return nil, fmt.Errorf("dataset UID %d is missing", datasetUID)
	}
	all, err := DesiredRuntimeGrants(snapshot)
	if err != nil {
		return nil, err
	}
	var result GrantSet
	for _, grant := range all {
		if grant.ObjectOID == targetOID {
			result = append(result, grant)
		}
		if grant.Kind == "sequence" {
			for _, use := range snapshot.Sequences {
				if use.TableOID == targetOID && use.SequenceOID == grant.ObjectOID {
					result = append(result, grant)
					break
				}
			}
		}
	}
	return result, nil
}

// DesiredRuntimeGrants evaluates the complete union once. Both per-dataset
// callers and the exhaustive audit use this authority; reads are additive.
func DesiredRuntimeGrants(snapshot GrantSnapshot) (GrantSet, error) {
	return evaluateRuntimeGrants(snapshot, nil)
}

// Only the read-only audit requests partial diagnostics. Public policy callers
// receive no grants when any requirement is blocked.
func evaluateRuntimeGrants(snapshot GrantSnapshot, diagnostics *[]Finding) (GrantSet, error) {
	if len(snapshot.Blockers) != 0 {
		return nil, fmt.Errorf("snapshot has %d blocker(s)", len(snapshot.Blockers))
	}
	if err := validateSnapshotIdentities(snapshot); err != nil {
		return nil, err
	}
	if findings := unclassifiedSequenceFindings(snapshot); len(findings) != 0 {
		if diagnostics == nil {
			return nil, fmt.Errorf("%s", findings[0].Reason)
		}
		*diagnostics = append(*diagnostics, findings...)
	}
	if findings := unclassifiedRouteFindings(snapshot); len(findings) != 0 {
		return nil, fmt.Errorf("snapshot has %d unclassified active data route(s)", len(findings))
	}
	classes := map[int64]TableClass{}
	byUID := map[int64]int64{}
	for _, oid := range sortedObjectOIDs(snapshot) {
		object := snapshot.Objects[oid]
		if object.Kind != "table" {
			continue
		}
		class, err := ClassifyTable(object)
		if err != nil {
			if err := policyProblem(diagnostics, object, err); err != nil {
				return nil, err
			}
			continue
		}
		classes[oid] = class
		if object.DatasetUID > 0 {
			if byUID[object.DatasetUID] != 0 {
				return nil, fmt.Errorf("duplicate dataset UID %d", object.DatasetUID)
			}
			byUID[object.DatasetUID] = oid
		}
	}
	dependencies, err := reviewedDependencies(snapshot, classes, diagnostics)
	if err != nil {
		return nil, err
	}
	snapshot.Dependencies = dependencies
	caps := map[string]map[int64]capabilities{"basic": {}, "guest": {}}
	adminCaps := map[int64]capabilities{}
	for _, right := range snapshot.Rights {
		function, ok := snapshot.Functions[right.FunctionID]
		if !ok || !snapshot.Groups[right.GroupID] {
			return nil, fmt.Errorf("dangling capability metadata")
		}
		if function.Disabled != nil && *function.Disabled {
			continue
		}
		if function.UIOnly || !function.TableRelated || right.DatasetUID == 0 {
			continue
		}
		oid := byUID[right.DatasetUID]
		if oid == 0 {
			if diagnostics != nil {
				// Classification already identifies the blocked physical object.
				continue
			}
			return nil, fmt.Errorf("dangling dataset UID %d", right.DatasetUID)
		}
		op, known := routeOperations[function.Route]
		if !known {
			// Administrator-only delegates need runtime reads solely where the
			// pilot routes administrators onto the basic request pool. An
			// administrator can hold the route right through any declared group.
			if snapshot.Objects[oid].Schema == "public" && snapshot.Objects[oid].Name == "app_service_catalog" {
				op = adminPilotRouteOperations[function.Route]
			}
			if op == 0 {
				continue // reviewed metadata or administrator-pool route
			}
		}
		if object := snapshot.Objects[oid]; object.Schema == "public" && retiredProductTables[strings.ToLower(object.Name)] {
			continue // dormant product rights cannot contribute dependencies either
		}
		if classes[oid] != Content {
			op &= Read // generic writes never create operational dependencies
		}
		if right.GroupID == 1 {
			entry := adminCaps[oid]
			entry.ordinary |= op
			if function.Disabled != nil && !*function.Disabled && (op != Read || function.Route == "/api/get-results") {
				entry.strict |= op
			}
			adminCaps[oid] = entry
		}
		for _, label := range []string{"basic", "guest"} {
			eligible := right.GroupID != 1
			if label == "basic" && snapshot.Objects[oid].Name == "app_service_catalog" {
				eligible = true
			}
			if label == "guest" {
				eligible = snapshot.GuestGroups[right.GroupID]
				if adminPilotRouteOperations[function.Route] != 0 {
					eligible = false // AdminProfile never uses the guest pool.
				}
				op &= Read
			}
			if !eligible {
				continue
			}
			entry := caps[label][oid]
			entry.ordinary |= op
			if function.Disabled != nil && !*function.Disabled && (op != Read || function.Route == "/api/get-results") {
				entry.strict |= op
			}
			caps[label][oid] = entry
		}
	}
	if snapshot.AdminRecovery {
		for oid, object := range snapshot.Objects {
			if object.Name == "app_service_catalog" {
				for _, function := range snapshot.Functions {
					if function.UIOnly || !function.TableRelated || (function.Disabled != nil && *function.Disabled) {
						continue
					}
					entry := caps["basic"][oid]
					entry.ordinary |= routeOperations[function.Route] | adminPilotRouteOperations[function.Route]
					caps["basic"][oid] = entry
					admin := adminCaps[oid]
					admin.ordinary |= routeOperations[function.Route] | adminPilotRouteOperations[function.Route]
					adminCaps[oid] = admin
				}
			}
		}
	}
	includePilotDependencyCapabilities(snapshot, caps["basic"], adminCaps)
	entries := map[string]Grant{}
	add := func(label string, oid int64, column, privilege, reason string) error {
		object, ok := snapshot.Objects[oid]
		if !ok {
			return policyProblem(diagnostics, object, fmt.Errorf("missing dependency object OID %d", oid))
		}
		if column != "" && !object.hasColumn(column) {
			return policyProblem(diagnostics, object, fmt.Errorf("missing dependency column on %s", object.Identifier()))
		}
		// Dormant development objects cannot turn stale rights or label joins
		// into new limited-pool grants. Keep V1's public readonly contract.
		if object.Schema == "public" && retiredProductTables[strings.ToLower(object.Name)] && label != "readonly" {
			return policyProblem(diagnostics, object, fmt.Errorf("forbidden runtime dependency on dormant product object %s", object.Identifier()))
		}
		write := privilege != "SELECT" && privilege != "USAGE" || object.Kind == "sequence" && privilege == "USAGE"
		class := classes[oid]
		if label == "PUBLIC" || label == "guest" && write || label == "readonly" && (write || object.Schema == "restricted") {
			return nil
		}
		if label == "confidential" && object.Schema != "restricted" && !(object.Schema == "public" && object.Name == "system_users" && privilege == "SELECT" && (column == "id" || column == "enabled")) && object.Kind != "schema" {
			return nil
		}
		if write && (object.Protected || class == Protected || class == Embedding || object.Name == "system_row_actor_columns" || object.Name == "system_data_repair_records") {
			return nil
		}
		if write && (class == Product || class == Dedicated) && reason != "operational contract" {
			return policyProblem(diagnostics, object, fmt.Errorf("forbidden active %s on %s: %s", privilege, object.Identifier(), reason))
		}
		if label != "confidential" && object.Schema == "restricted" {
			return nil
		}
		kind := object.Kind
		if column != "" {
			kind = "column"
		}
		grant := Grant{Role: label, Kind: kind, ObjectOID: oid, Column: column, Privilege: privilege, Reason: reason}
		key := grantKey(grant)
		if existing, ok := entries[key]; !ok || reason < existing.Reason {
			entries[key] = grant
		}
		return nil
	}
	for _, oid := range sortedObjectOIDs(snapshot) {
		object := snapshot.Objects[oid]
		if object.Kind == "schema" {
			// Public/restricted are approved pool contracts. Other namespaces
			// follow required objects below, never mere catalogue presence.
			if object.Name != "public" && object.Name != "restricted" {
				continue
			}
			for _, label := range []string{"basic", "guest", "readonly", "confidential"} {
				if object.Name == "restricted" && label != "confidential" {
					continue
				}
				if label == "readonly" && object.Name != "public" || label == "confidential" && object.Name != "public" && object.Name != "restricted" {
					continue
				}
				if err := add(label, oid, "", "USAGE", "runtime schema access"); err != nil {
					return nil, err
				}
			}
			continue
		}
		if object.Kind != "table" || classes[oid] == "" {
			continue
		}
		if object.Schema == "public" {
			if err := add("readonly", oid, "", "SELECT", "readonly public contract"); err != nil {
				return nil, err
			}
		}
		if object.Schema == "restricted" {
			for _, privilege := range []string{"SELECT", "INSERT", "UPDATE", "DELETE"} {
				if err := add("confidential", oid, "", privilege, "confidential restricted contract"); err != nil {
					return nil, err
				}
			}
		}
		if object.Schema == "public" && object.Name == "system_users" {
			for _, column := range []string{"id", "enabled"} {
				if err := add("confidential", oid, column, "SELECT", "confidential account availability"); err != nil {
					return nil, err
				}
			}
		}
		if object.Schema == "public" {
			for _, privilege := range operationalPrivileges[object.Name] {
				if err := add("basic", oid, "", privilege, "operational contract"); err != nil {
					return nil, err
				}
			}
			if object.Name == "system_media_asset_usages" {
				if err := add("basic", oid, "created", "UPDATE", "operational contract"); err != nil {
					return nil, err
				}
			}
			if object.Name == "system_row_groups" || object.Name == "system_row_group_memberships" || object.Name == "system_row_actor_columns" {
				for _, label := range []string{"basic", "guest"} {
					if err := add(label, oid, "", "SELECT", "row visibility metadata"); err != nil {
						return nil, err
					}
				}
			}
		}
		for _, label := range []string{"basic", "guest"} {
			op := caps[label][oid].ordinary
			if op != 0 {
				if err := add(label, oid, "", "SELECT", "declared route readback"); err != nil {
					return nil, err
				}
			}
			for operation, privilege := range map[Operation]string{Insert: "INSERT", Update: "UPDATE", Delete: "DELETE"} {
				if op&operation != 0 {
					if err := add(label, oid, "", privilege, "declared route"); err != nil {
						return nil, err
					}
				}
			}
			if op&(Insert|Update) != 0 && object.hasColumn("search_vector_simple") {
				if err := add(label, oid, "search_vector_simple", "UPDATE", "search vector refresh"); err != nil {
					return nil, err
				}
			}
		}
	}
	// Automation inserts settle galleries (notification_triggers.go:459), but
	// adoption inserts only a row (asset_linking_preview_adoption.go:150).
	// Adoption must never activate settlement, nested galleries or dispatch.
	// Cache/automation callbacks stay on real route executions.
	active := map[int64]Operation{}
	for oid, capability := range caps["basic"] {
		if classes[oid] == Content {
			active[oid] = capability.ordinary
		}
	}
	for _, dependency := range snapshot.Dependencies {
		if dependency.Kind == "automation" && caps["basic"][dependency.SourceOID].ordinary&dependency.When != 0 {
			active[dependency.TargetOID] |= Insert
		}
	}
	for _, dependency := range snapshot.Dependencies {
		for _, label := range []string{"basic", "guest"} {
			op := caps[label][dependency.SourceOID].ordinary
			if label == "basic" && (dependency.Kind == "gallery" || dependency.Kind == "gallery_insert" || dependency.Kind == "gallery_read") {
				op |= active[dependency.SourceOID]
			}
			if op != 0 {
				op |= Read
			} // write routes require current readback/labels
			if op&dependency.When == 0 {
				continue
			}
			if dependency.Requires != 0 && caps[label][dependency.TargetOID].strict&dependency.Requires != dependency.Requires {
				continue
			}
			if dependency.Kind == "bridge" && caps[label][dependency.RelatedOID].strict&Read == 0 {
				continue
			}
			if dependency.Kind == "lock" && dependency.RelatedOID != 0 && caps[label][dependency.RelatedOID].strict&Insert == 0 {
				continue
			}
			privilege := "SELECT"
			switch dependency.Kind {
			case "lock", "cache", "gallery":
				privilege = "UPDATE"
			case "automation", "gallery_insert":
				privilege = "INSERT"
			case "child", "bridge":
				continue // independently declared target rights supply DML
			}
			if len(dependency.Columns) == 0 {
				if err := add(label, dependency.TargetOID, "", privilege, "dependency "+dependency.Kind); err != nil {
					return nil, err
				}
			} else {
				for _, column := range dependency.Columns {
					if err := add(label, dependency.TargetOID, column, privilege, "dependency "+dependency.Kind); err != nil {
						return nil, err
					}
				}
			}
			for _, column := range dependency.ReadColumns {
				if err := add(label, dependency.TargetOID, column, "SELECT", "dependency "+dependency.Kind+" predicate/readback"); err != nil {
					return nil, err
				}
			}
			if dependency.Kind == "automation" {
				if err := add(label, dependency.TargetOID, "", "SELECT", "automation readback"); err != nil {
					return nil, err
				}
			}
			if dependency.Kind == "gallery" {
				for _, column := range append([]string{"id"}, dependency.Columns...) {
					if err := add(label, dependency.TargetOID, column, "SELECT", "gallery read dependency"); err != nil {
						return nil, err
					}
				}
			}
		}
	}
	for _, use := range snapshot.Sequences {
		for _, label := range []string{"basic", "confidential"} {
			insertGrant := Grant{Role: label, Kind: "table", ObjectOID: use.TableOID, Privilege: "INSERT"}
			if _, ok := entries[grantKey(insertGrant)]; !ok || !use.NextValue {
				continue
			}
			if err := add(label, use.SequenceOID, "", "USAGE", "insert default sequence"); err != nil {
				return nil, err
			}
		}
		if snapshot.Objects[use.TableOID].Schema == "restricted" {
			for _, privilege := range []string{"USAGE", "SELECT"} {
				if err := add("confidential", use.SequenceOID, "", privilege, "confidential restricted sequence contract"); err != nil {
					return nil, err
				}
			}
		}
	}
	// Narrow label/gallery/sequence dependencies need their namespace too.
	// Derive only basic/guest extra-schema access from an actual desired object.
	requiredSchemas := map[string]map[string]bool{"basic": {}, "guest": {}}
	for _, grant := range entries {
		if schemas, ok := requiredSchemas[grant.Role]; ok && grant.Kind != "schema" {
			schemas[snapshot.Objects[grant.ObjectOID].Schema] = true
		}
	}
	for _, oid := range sortedObjectOIDs(snapshot) {
		object := snapshot.Objects[oid]
		if object.Kind != "schema" || object.Name == "public" || object.Name == "restricted" {
			continue
		}
		for _, label := range []string{"basic", "guest"} {
			if requiredSchemas[label][object.Name] {
				if err := add(label, oid, "", "USAGE", "required object schema access"); err != nil {
					return nil, err
				}
			}
		}
	}
	return sortedGrants(entries), nil
}

// Pilot administrators use the basic transaction for related SQL too. Their
// independent target rights contribute only along an actually reachable pilot
// operation; unrelated administrator capabilities never enter the basic union.
func includePilotDependencyCapabilities(snapshot GrantSnapshot, basic, admin map[int64]capabilities) {
	reachable := map[int64]Operation{}
	for oid, object := range snapshot.Objects {
		if object.Schema == "public" && object.Name == "app_service_catalog" {
			reachable[oid] = admin[oid].ordinary
		}
	}
	include := func(oid int64, operation Operation) bool {
		before := basic[oid]
		entry := before
		entry.ordinary |= operation
		entry.strict |= operation
		basic[oid] = entry
		old := reachable[oid]
		reachable[oid] |= operation
		return entry != before || reachable[oid] != old
	}
	for changed := true; changed; {
		changed = false
		for _, dependency := range snapshot.Dependencies {
			if reachable[dependency.SourceOID]&dependency.When == 0 || dependency.Requires == 0 {
				continue
			}
			available := basic[dependency.TargetOID].strict | admin[dependency.TargetOID].strict
			if available&dependency.Requires != dependency.Requires {
				continue
			}
			if dependency.Kind == "bridge" && (basic[dependency.RelatedOID].strict|admin[dependency.RelatedOID].strict)&Read == 0 {
				continue
			}
			if dependency.Kind == "lock" && dependency.RelatedOID != 0 && (basic[dependency.RelatedOID].strict|admin[dependency.RelatedOID].strict)&Insert == 0 {
				continue
			}
			if include(dependency.TargetOID, dependency.Requires) {
				changed = true
			}
			if dependency.Kind == "bridge" && include(dependency.RelatedOID, Read) {
				changed = true
			}
			if dependency.Kind == "lock" && dependency.RelatedOID != 0 && include(dependency.RelatedOID, Insert) {
				changed = true
			}
		}
	}
}

func validateSnapshotIdentities(snapshot GrantSnapshot) error {
	labels, identities := map[string]bool{}, map[int64]bool{}
	for _, role := range snapshot.Roles {
		if role.Label != "basic" && role.Label != "guest" && role.Label != "readonly" && role.Label != "confidential" {
			return fmt.Errorf("unclassified runtime role label")
		}
		if role.OID <= 0 || labels[role.Label] || identities[role.OID] {
			return fmt.Errorf("missing or duplicate runtime identity")
		}
		labels[role.Label], identities[role.OID] = true, true
	}
	if len(labels) != 4 {
		return fmt.Errorf("four separate runtime identities are required")
	}
	for _, use := range snapshot.Sequences {
		if snapshot.Objects[use.TableOID].Kind != "table" || snapshot.Objects[use.SequenceOID].Kind != "sequence" || !snapshot.Objects[use.TableOID].hasColumn(use.Column) {
			return fmt.Errorf("dangling sequence dependency")
		}
	}
	for _, oid := range sortedObjectOIDs(snapshot) {
		object := snapshot.Objects[oid]
		if object.OID != oid || oid <= 0 {
			return fmt.Errorf("object identity differs from catalogue key")
		}
		switch object.Kind {
		case "table", "schema", "function", "sequence":
		default:
			return fmt.Errorf("unclassified object kind")
		}
	}
	return nil
}

// Physical automation inserts do not dispatch again, so a metadata cycle is
// not an execution cycle. Validate each actual operation without inventing one.
func validateDependencyGraph(snapshot GrantSnapshot, classes map[int64]TableClass) error {
	for _, dependency := range sortedDependencies(snapshot.Dependencies) {
		if err := validateDependency(snapshot, classes, dependency); err != nil {
			return err
		}
	}
	return nil
}
