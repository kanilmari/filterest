// search_id_first_test.go
// Checks shared identifier matching in listing and assisted-search compilers.
// Connects in-memory query doubles to real parameter and authorization assembly.
// Guards marker normalization and non-integer keys without a database service.
package dtt_1_row_read

import (
	"database/sql/driver"
	"fmt"
	"net/url"
	"strings"
	"testing"
)

func TestIDSearchListingAndAssistedCompilers(t *testing.T) {
	for _, stored := range []bool{false, true} {
		for _, raw := range []string{"843", "#843", " 843 ", "#00843"} {
			t.Run(fmt.Sprintf("stored=%t/%s", stored, raw), func(t *testing.T) {
				db, state := openIntelligentFetcherTestDB(t, intelligentFetcherTestState{
					headerExists: true, vectorExists: stored,
					queryableColumns: []string{"id", "header"},
					finalRows:        [][]driver.Value{{int64(843), "no digits", float64(1)}},
				})
				t.Cleanup(func() { _ = db.Close() })
				where, args, search, err := appendDatasetTextSearchToWhereClause(db,
					url.Values{"search": {raw}}, "items", ` WHERE "items".status = $1`, []interface{}{"open"})
				if err != nil {
					t.Fatal(err)
				}
				if !strings.HasPrefix(where, ` WHERE "items".status = $1 AND (`) ||
					!strings.Contains(where, `OR "items"."id" = $3::bigint)`) ||
					!strings.HasPrefix(search.OrderBy, ` ORDER BY ("items"."id" = $3::bigint) DESC, `) ||
					len(args) != 3 || args[0] != "open" || args[2] != 843 {
					t.Fatalf("listing: %s %s %#v", where, search.OrderBy, args)
				}
				if _, err := fetchFullTextRows(db, "items", raw, intelligentSearchAuthorization{}); err != nil {
					t.Fatal(err)
				}
				if len(state.finalArgs) != 4 || fmt.Sprint(state.finalArgs[1].Value) != "843" ||
					!strings.Contains(state.finalQuery, `= $2::bigint) DESC`) {
					t.Fatalf("assisted: %s %#v", state.finalQuery, state.finalArgs)
				}
				if strings.Contains(fmt.Sprint(args[1]), "#") || strings.Contains(fmt.Sprint(state.finalArgs[0].Value), "#") {
					t.Fatal("identifier marker reached text matching")
				}
			})
		}
	}
}

func TestIDSearchLeavesNonIntegerKeysAsText(t *testing.T) {
	for _, stored := range []bool{false, true} {
		db, state := openIntelligentFetcherTestDB(t, intelligentFetcherTestState{
			nonIntegerID: true, headerExists: true, vectorExists: stored,
			queryableColumns: []string{"id", "header"},
		})
		t.Cleanup(func() { _ = db.Close() })
		_, args, search, err := appendDatasetTextSearchToWhereClause(db,
			url.Values{"search": {"#843"}}, "items", "", nil)
		if err != nil || len(args) != 1 || strings.Contains(search.OrderBy, "bigint") {
			t.Fatalf("non-integer listing: %s %#v %v", search.OrderBy, args, err)
		}
		if _, err := fetchFullTextRows(db, "items", "#843", intelligentSearchAuthorization{}); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(state.finalQuery, "bigint") || len(state.finalArgs) != 3 ||
			!strings.Contains(fmt.Sprint(state.finalArgs[0].Value), "#843") {
			t.Fatalf("non-integer assisted query changed: %s %#v", state.finalQuery, state.finalArgs)
		}
	}
}

func TestIDSearchAssistedKeepsAuthorizationOutsideIDAlternative(t *testing.T) {
	db, state := openIntelligentFetcherTestDB(t, intelligentFetcherTestState{
		headerExists: true, vectorExists: true, queryableColumns: []string{"id", "header"},
	})
	t.Cleanup(func() { _ = db.Close() })
	authorization := intelligentSearchAuthorization{
		userRole: "basic", userID: 8,
		readPolicy: ReadRowPolicy{Name: rowPolicyAllFlagsTrueUnlessOwner,
			FlagColumns: []string{"published"}, OwnerColumn: "user_id"},
		tableUID: 104, rowGroupSelection: testRowGroupSelection("security"),
	}
	if _, err := fetchFullTextRows(db, "items", "#843", authorization); err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{
		`OR "src"."id" = $2::bigint)) AND`, `"src"."published" = TRUE`,
		`"src"."user_id" = $3`, `public.resolve_effective_row_access($4`,
		`jsonb_to_recordset($7::jsonb)`,
	} {
		if !strings.Contains(state.finalQuery, fragment) {
			t.Fatalf("missing authorized numeric scope %q: %s", fragment, state.finalQuery)
		}
	}
}
