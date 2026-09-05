// add_row_existing_links_test.go
// Verifies fail-closed relation resolution and exact-count existing-row linking.
// Bridges stable relation IDs with the dynamic SQL helpers without a production database.
// Exists to prevent client-supplied table names or partial relation writes from returning.
package dtt_1_row_create

import (
	"database/sql/driver"
	"testing"
)

func TestResolveOneToManyExistingLinkUsesRegisteredRelation(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	pushQuery(queuedQuery{
		cols: []string{"id", "source_table_uid", "table_name", "source_column_name", "target_insert_specs"},
		rows: [][]driver.Value{{int64(41), "10", "tickets", "documentation_id", `{}`}},
	})
	relation, err := resolveOneToManyExistingLink(tx, "9", ExistingRelationLinkPayload{
		RelationKind: existingRelationOneToMany,
		RelationID:   41,
		RowIDs:       []int64{7, 8},
	})
	if err != nil {
		t.Fatalf("resolveOneToManyExistingLink() error = %v", err)
	}
	if relation.RelatedTableName != "tickets" || relation.RelatedForeignKey != "documentation_id" {
		t.Fatalf("resolved relation = %#v", relation)
	}
	if len(relation.RowIDs) != 2 || relation.RowIDs[1] != 8 {
		t.Fatalf("resolved row IDs = %#v", relation.RowIDs)
	}
}

func TestResolveOneToManyExistingLinkRejectsAssetRelation(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	pushQuery(queuedQuery{
		cols: []string{"id", "source_table_uid", "table_name", "source_column_name", "target_insert_specs"},
		rows: [][]driver.Value{{int64(42), "302", "documentation_assets", "documentation_id", `{"file_upload":{"enabled":true}}`}},
	})
	_, err = resolveOneToManyExistingLink(tx, "9", ExistingRelationLinkPayload{
		RelationKind: existingRelationOneToMany,
		RelationID:   42,
		RowIDs:       []int64{7},
	})
	if err == nil {
		t.Fatal("asset relation unexpectedly accepted as link-existing")
	}
}

func TestApplyExistingLinksRequiresExactOneToManyCount(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	pushExec(queuedExec{rowsAffected: 1})
	err = applyExistingLinks(tx, 100, []resolvedExistingLink{{
		Kind:              existingRelationOneToMany,
		RelatedTableName:  "tickets",
		RelatedForeignKey: "documentation_id",
		RowIDs:            []int64{7, 8},
	}})
	if err == nil {
		t.Fatal("partial one-to-many update unexpectedly accepted")
	}
}

func TestApplyExistingLinksCreatesEveryManyToManyBridge(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	pushExec(queuedExec{rowsAffected: 1})
	pushExec(queuedExec{rowsAffected: 1})
	err = applyExistingLinks(tx, 100, []resolvedExistingLink{{
		Kind:                  existingRelationManyToMany,
		BridgeTableName:       "documentation_services_relation",
		BridgeMainForeignKey:  "documentation_id",
		BridgeOtherForeignKey: "service_id",
		RowIDs:                []int64{7, 8},
	}})
	if err != nil {
		t.Fatalf("applyExistingLinks() error = %v", err)
	}
}

func TestUniquePositiveRowIDsDeduplicatesAndFiltersInvalidValues(t *testing.T) {
	got := uniquePositiveRowIDs([]int64{7, 0, -1, 7, 9})
	if len(got) != 2 || got[0] != 7 || got[1] != 9 {
		t.Fatalf("uniquePositiveRowIDs() = %#v", got)
	}
}

func TestResolveAndAuthorizeExistingLinksRejectsInvalidRowIDBeforeDatabaseAccess(t *testing.T) {
	_, err := resolveAndAuthorizeExistingLinks(nil, "9", []ExistingRelationLinkPayload{{
		RelationKind: existingRelationManyToMany,
		RelationID:   12,
		RowIDs:       []int64{7, 0},
	}}, 1, "admin")
	if err == nil {
		t.Fatal("invalid relation row identifier unexpectedly accepted")
	}
}
