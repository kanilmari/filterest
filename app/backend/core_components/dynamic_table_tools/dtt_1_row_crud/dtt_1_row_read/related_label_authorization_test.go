// related_label_authorization_test.go
// Proves related labels share primary-label row policies and parameter ordering.
// Covers the projection used by both incoming and outgoing related readers.
// Keeps layout-only legacy tests explicit about their administrator context.
package dtt_1_row_read

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

// Existing layout and actor tests exercise administrator projections; runtime
// callers must supply authorization and retain the returned policy arguments.
func buildRelatedSelectColumnsWithFKLabels(table string, columns []string, keys map[string]dtt_utils.ForeignKey, actors row_mutation_policy.RowActorColumns) (string, string) {
	selected, joins, _ := buildRelatedLabelProjection(table, columns, keys, actors, allowForeignLabelsForTest(), 0)
	return selected, joins
}

func TestRelatedLabelReadPolicyOffsets(t *testing.T) {
	keys := map[string]dtt_utils.ForeignKey{
		"target_id": {ReferencedTable: "targets", ReferencedColumn: "id", NameColumn: "title"},
		"other_id":  {ReferencedTable: "other_targets", ReferencedColumn: "id", NameColumn: "title"},
	}
	policyLoads := map[string]int{}
	auth := &foreignLabelAuthorization{userRole: "user", userID: 4,
		canReadDataset: func(string) (bool, error) { return true, nil }, policies: map[string]ReadRowPolicy{},
		loadPolicy: func(table string) (ReadRowPolicy, error) {
			policyLoads[table]++
			if table == "other_targets" {
				return legacyMustTrueReadPolicy([]string{"published"}, "owner_id"), nil
			}
			return ReadRowPolicy{}, nil // The gate's target has no mandatory flags.
		},
	}
	query, args := buildRelatedItemsQueryWithFKLabels("children", []string{"id", "target_id", "other_id"}, keys, nil,
		"parent_id", 1, "user", 4, legacyMustTrueReadPolicy([]string{"visible"}, "user_id"), "", auth)
	wantArgs := []interface{}{1, 4, "children", 4, "targets", 4, 4, "other_targets", 4}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("args = %#v, want %#v", args, wantArgs)
	}
	for _, fragment := range []string{
		`"children"."parent_id" = $1`, `"children"."user_id" = $2`,
		`resolve_effective_row_access($3, "children"."id", $4, 'read'`,
		`resolve_effective_row_access($5, "target_id_related_fk_alias1"."id", $6, 'read'`,
		`"other_id_related_fk_alias1"."published" = TRUE OR "other_id_related_fk_alias1"."owner_id" = $7`,
		`resolve_effective_row_access($8, "other_id_related_fk_alias1"."id", $9, 'read'`,
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("missing %s: %s", fragment, query)
		}
	}
	// Target predicates belong to ON, preserving readable source rows on deny.
	joinSQL, _, _ := strings.Cut(query, " WHERE ")
	if strings.Count(joinSQL, "resolve_effective_row_access") != 2 {
		t.Fatal("target policy escaped the LEFT JOIN", query)
	}
	_, _, _ = buildRelatedLabelProjection("children", []string{"target_id", "other_id"}, keys, nil, auth, 0)
	if policyLoads["targets"] != 1 || policyLoads["other_targets"] != 1 {
		t.Fatal("policy lookup repeated within request", policyLoads)
	}
}

func TestRelatedLabelAuthorizationFailsClosed(t *testing.T) {
	for _, failure := range []string{"missing authorization", "dataset denied", "permission failure", "policy failure"} {
		t.Run(failure, func(t *testing.T) {
			var auth *foreignLabelAuthorization
			if failure != "missing authorization" {
				auth = &foreignLabelAuthorization{userRole: "user", userID: 4, policies: map[string]ReadRowPolicy{},
					canReadDataset: func(string) (bool, error) {
						if failure == "permission failure" {
							return false, fmt.Errorf("unavailable")
						}
						return failure != "dataset denied", nil
					},
					loadPolicy: func(string) (ReadRowPolicy, error) { return ReadRowPolicy{}, fmt.Errorf("unavailable") },
				}
			}
			keys := map[string]dtt_utils.ForeignKey{"target_id": {ReferencedTable: "targets", ReferencedColumn: "id", NameColumn: "title"}}
			selected, joins, args := buildRelatedLabelProjection("children", []string{"target_id"}, keys, nil, auth, 3)
			if joins != "" || len(args) != 0 || !strings.Contains(selected, `NULL::text AS "target_name"`) || !strings.Contains(selected, `"children"."target_id" AS "target_id"`) {
				t.Fatalf("unsafe label projection: %s %s %#v", selected, joins, args)
			}
		})
	}
}

func TestRelatedLabelAdminBypassesRowPolicy(t *testing.T) {
	auth := allowForeignLabelsForTest()
	auth.loadPolicy = func(string) (ReadRowPolicy, error) {
		t.Fatal("administrator loaded a row policy")
		return ReadRowPolicy{}, nil
	}
	keys := map[string]dtt_utils.ForeignKey{"target_id": {ReferencedTable: "targets", ReferencedColumn: "id", NameColumn: "title"}}
	selected, joins, args := buildRelatedLabelProjection("children", []string{"target_id"}, keys, nil, auth, 3)
	if len(args) != 0 || strings.Contains(joins, "resolve_effective_row_access") || !strings.Contains(joins, `LEFT JOIN "targets"`) || !strings.Contains(selected, `"target_id_related_fk_alias1"."title" AS "target_name"`) {
		t.Fatalf("administrator projection changed: %s %s %#v", selected, joins, args)
	}
}
