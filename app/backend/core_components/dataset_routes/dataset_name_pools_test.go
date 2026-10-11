// dataset_name_pools_test.go
// Verifies alias ownership and preferred addresses by stable dataset identity.
// Connects cross-schema collisions with the shared server naming policy.
// Prevents iteration order and failed reads from reinstating rejected aliases.
package dataset_routes

import (
	"errors"
	"fmt"
	"reflect"
	"testing"
)

func TestDatasetNamePoolsDistinguishSameNamesAndAmbiguousUIDOwners(t *testing.T) {
	for _, privateFirst := range []bool{false, true} {
		t.Run(fmt.Sprintf("private_first_%t", privateFirst), func(t *testing.T) {
			tables := []datasetNamePoolTable{{11, "app_orders", "public"}, {12, "app_orders", "audit"}, {13, "app_invoices", "public"}}
			if privateFirst {
				tables[0], tables[1] = tables[1], tables[0]
			}
			pools := buildDatasetNamePools(tables, map[int][]datasetNamePoolAlias{
				11: {{"shop-orders", true}, {"shared-orders", false}, {"old-orders", false}},
				12: {{"private-audit-orders", true}, {"shared-orders", false}},
				13: {{"shared-orders", true}},
			})
			if len(pools) != 3 || pools[11].SchemaName != "public" || pools[12].SchemaName != "audit" ||
				!reflect.DeepEqual(pools[11].Names, []string{"app_orders", "old-orders", "shop-orders"}) ||
				!reflect.DeepEqual(pools[12].Names, []string{"app_orders", "private-audit-orders"}) ||
				pools[11].PreferredName != "shop-orders" || pools[12].PreferredName != "private-audit-orders" ||
				!reflect.DeepEqual(pools[13].Names, []string{"app_invoices"}) || pools[13].PreferredName != "app_invoices" {
				t.Fatalf("UID ownership depends on names or order: %#v", pools)
			}
		})
	}
}

func TestDatasetNamePoolsRejectAmbiguousAutomaticNamesAcrossSchemas(t *testing.T) {
	pools := buildDatasetNamePools([]datasetNamePoolTable{{11, "app_orders", "public"}, {12, "app_orders", "audit"}}, nil)
	for _, uid := range []int{11, 12} {
		if !reflect.DeepEqual(pools[uid].Names, []string{"app_orders"}) || pools[uid].PreferredName != "app_orders" {
			t.Fatalf("same-name UIDs share an automatic alias: %#v", pools)
		}
	}
}

func TestGeneratedDatasetNamesRejectReservedPrimaryAlias(t *testing.T) {
	db := openDatasetRouteTestDB(t, nil, map[string]string{"app_orders": "api"})
	defer db.Close()
	if got := ResolvePublicDatasetNameWithQuerier(db, "app_orders"); got != "app_orders" {
		t.Fatalf("generated address reinstated reserved alias: %s", got)
	}
	if got := ResolveRawDatasetNameWithQuerier(db, "api"); got != "api" {
		t.Fatalf("incoming address accepted reserved alias: %s", got)
	}
}

func TestDatasetAddressResolversFailClosedOnPoolReadFailure(t *testing.T) {
	db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{
		tables: []datasetAliasTableMetadata{{11, "app_service_catalog"}}, aliasQueryError: fmt.Errorf("unavailable"),
	})
	defer db.Close()
	if got := ResolvePublicDatasetNameWithQuerier(db, "app_service_catalog"); got != "app_service_catalog" {
		t.Fatalf("failed pool read reinstated a fallback alias: %s", got)
	}
	if got := ResolveRawDatasetNameWithQuerier(db, "service_catalog"); got != "service_catalog" {
		t.Fatalf("failed pool read reinstated a fallback owner: %s", got)
	}
}

func TestDatasetNamePoolResolverKeepsUIDAndAmbiguityInPermissionSubsets(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		tables := []datasetNamePoolTable{{81, "Reports", "public"}, {82, "reports", "public"}}
		if reverse {
			tables[0], tables[1] = tables[1], tables[0]
		}
		global := buildDatasetNamePools(tables, nil)
		for _, allowed := range [][]int{{81, 82}, {81}, {82}} {
			t.Run(fmt.Sprintf("reverse_%t/allowed_%v", reverse, allowed), func(t *testing.T) {
				subset := make(map[int]DatasetNamePool)
				for _, uid := range allowed {
					subset[uid] = global[uid]
				}
				for _, name := range []string{"Reports", "reports", "REPORTS", " Reports "} {
					pool, err := ResolveDatasetNamePool(subset, name)
					if name == "REPORTS" || name == " Reports " {
						if !errors.Is(err, ErrDatasetNameAmbiguous) {
							t.Fatalf("subset accepted ambiguous %q: %+v %v", name, pool, err)
						}
						continue
					}
					uid := 81
					if name == "reports" {
						uid = 82
					}
					if _, present := subset[uid]; present {
						if err != nil || pool.TableUID != uid {
							t.Fatalf("exact name %q changed UID: %+v %v", name, pool, err)
						}
					} else if !errors.Is(err, ErrDatasetNameAmbiguous) {
						t.Fatalf("hidden exact name %q rebound: %+v %v", name, pool, err)
					}
				}
			})
		}
	}
}
