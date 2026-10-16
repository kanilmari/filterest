// fk_label_authorization_test.go
// Proves denied labels retain source keys, and row predicates use target aliases.
// Exercises the shared builder used by listing, intelligent and vector reads.
// Keeps policy and permission resolution bounded by referenced dataset count.
package dtt_1_row_read

import (
	"fmt"
	"net/url"
	"strings"
	"testing"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

func allowForeignLabelsForTest() *foreignLabelAuthorization {
	return &foreignLabelAuthorization{userRole: "admin", canReadDataset: func(string) (bool, error) { return true, nil }}
}

func TestForeignLabelAuthorization(t *testing.T) {
	for _, allowed := range []bool{false, true} {
		t.Run(fmt.Sprint(allowed), func(t *testing.T) {
			resetJoinMetadataCacheForTests()
			t.Cleanup(resetJoinMetadataCacheForTests)
			db := openBuildJoinsMockDB(t, &buildJoinsQueryCounter{counts: map[string]int{}})
			setCachedJoinMetadata("sources", joinMetadataCacheEntry{tableUID: "42", foreignKeys: map[string]dtt_utils.ForeignKey{
				"target_id": {ReferencedTable: "targets", ReferencedColumn: "id", NameColumn: "title"},
			}})
			auth := &foreignLabelAuthorization{userID: 7, userRole: "user", policies: map[string]ReadRowPolicy{},
				canReadDataset: func(string) (bool, error) { return allowed, nil },
				loadPolicy:     func(string) (ReadRowPolicy, error) { return legacyMustTrueReadPolicy([]string{"published"}, ""), nil },
			}
			selected, joins, expressions, args, err := buildJoinsWith1MRelations(db, "sources", map[int]dtt_models.ColumnInfo{1: {ColumnName: "target_id"}}, []int{1}, auth, 3)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(selected, `"sources"."target_id" AS "target_id"`) {
				t.Fatal("source key lost", selected)
			}
			if !allowed {
				if joins != "" || expressions["target_name (ln)"] != "NULL::text" || !strings.Contains(selected, `NULL::text AS "target_name (ln)"`) {
					t.Fatal(selected, joins, expressions)
				}
				return
			}
			for _, fragment := range []string{`LEFT JOIN "targets"`, `"target_id_alias1"."published" = TRUE`, `resolve_effective_row_access($4, "target_id_alias1"."id", $5, 'read'`} {
				if !strings.Contains(joins, fragment) {
					t.Fatalf("missing %s: %s", fragment, joins)
				}
			}
			if len(args) != 2 || args[0] != "targets" || args[1] != 7 {
				t.Fatal(args)
			}
		})
	}
}

func TestForeignLabelCachedNameIsSourceData(t *testing.T) {
	resetJoinMetadataCacheForTests()
	t.Cleanup(resetJoinMetadataCacheForTests)
	db := openBuildJoinsMockDB(t, &buildJoinsQueryCounter{counts: map[string]int{}})
	setCachedJoinMetadata("sources", joinMetadataCacheEntry{tableUID: "42",
		foreignKeys: map[string]dtt_utils.ForeignKey{"target_id": {ReferencedTable: "targets", ReferencedColumn: "id", NameColumn: "title"}},
		fkRelations: map[string]OneMRelation{"target_id": {CachedNameColInSrc: "cached_title"}},
	})
	selected, joins, _, _, err := buildJoinsWith1MRelations(db, "sources", map[int]dtt_models.ColumnInfo{1: {ColumnName: "target_id"}, 2: {ColumnName: "cached_title"}}, []int{1, 2}, nil, 0)
	if err != nil || joins != "" || !strings.Contains(selected, `"sources"."cached_title" AS "cached_title"`) {
		t.Fatal(selected, joins, err)
	}
}

func TestForeignLabelPermissionCacheIsRequestScoped(t *testing.T) {
	counter := &buildJoinsQueryCounter{counts: map[string]int{}}
	db := openBuildJoinsMockDB(t, counter)
	auth := newForeignLabelAuthorization(db, "user", 7)
	for i := 0; i < 16; i++ {
		if _, _, _, err := auth.targetCondition("targets", "target", 1); err != nil {
			t.Fatal(err)
		}
	}
	if counter.get("label_permission") != 1 || counter.get("label_policy") != 1 {
		t.Fatal(counter.counts)
	}
	auth = newForeignLabelAuthorization(db, "user", 7)
	if _, _, _, err := auth.targetCondition("targets", "target", 1); err != nil {
		t.Fatal(err)
	}
	if counter.get("label_permission") != 2 {
		t.Fatal("authorization escaped request", counter.counts)
	}
}

func TestForeignLabelFilterParameterOffsets(t *testing.T) {
	resetJoinMetadataCacheForTests()
	t.Cleanup(resetJoinMetadataCacheForTests)
	db := openBuildJoinsMockDB(t, &buildJoinsQueryCounter{counts: map[string]int{}})
	setCachedJoinMetadata("sources", joinMetadataCacheEntry{tableUID: "42", foreignKeys: map[string]dtt_utils.ForeignKey{
		"target_id": {ReferencedTable: "targets", ReferencedColumn: "id", NameColumn: "title"},
	}})
	query, args, _, _, _, err := BuildSelectQuery(QueryBuilderContext{DB: db, TableName: "sources",
		ColumnsMap: map[int]dtt_models.ColumnInfo{1: {ColumnName: "target_id"}}, VisibleColUIDs: []int{1},
		QueryParams: url.Values{"target_id_from": {"1"}}, UserID: 7, UserRole: "user", ClientRowCount: 1, ResultsPerLoad: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(args) != 5 || args[0] != "targets" || args[1] != 7 || args[2] != "1" || args[3] != "sources" || args[4] != 7 {
		t.Fatal(args)
	}
	if !strings.Contains(query, `"sources"."target_id" >= $3`) || !strings.Contains(query, `resolve_effective_row_access($4, "sources"."id", $5`) {
		t.Fatal(query)
	}
}

func TestForeignLabelAuthorizationFailsClosed(t *testing.T) {
	for _, permissionFailure := range []bool{false, true} {
		auth := &foreignLabelAuthorization{userID: 7, userRole: "user", policies: map[string]ReadRowPolicy{},
			canReadDataset: func(string) (bool, error) {
				if permissionFailure {
					return false, fmt.Errorf("permission lookup failed")
				}
				return true, nil
			},
			loadPolicy: func(string) (ReadRowPolicy, error) { return ReadRowPolicy{}, fmt.Errorf("policy lookup failed") },
		}
		allowed, _, _, err := auth.targetCondition("targets", "target", 1)
		if err == nil || allowed {
			t.Fatal("failed lookup enabled label join")
		}
	}
}
