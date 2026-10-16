// components_reserved_segment_test.go
// Refuses the static component namespace for new datasets and explicit aliases.
// Connects the existing database-name check to the additional Go route reservation.
// Proves validation order without connecting to an application database.
package dataset_routes

import (
	"errors"
	"strings"
	"testing"
)

func TestDatasetCreationReservesComponentsAfterNameCheck(t *testing.T) {
	for _, name := range []string{"components", "app_components", "Components"} {
		var calls []string
		db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{execCalls: &calls})
		err := ValidateDatasetRouteAvailability(db, name, 0)
		db.Close()
		var conflict *RouteConflictError
		if !errors.As(err, &conflict) || len(calls) != 2 || !strings.Contains(calls[1], "app_validate_dataset_name") {
			t.Fatalf("%s: refusal=%v, validation=%v", name, err, calls)
		}
	}
	first := errors.New("existing name check failed")
	db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{namespaceError: first})
	defer db.Close()
	if err := ValidateDatasetRouteAvailability(db, "components", 0); err == nil || err.Error() != first.Error() {
		t.Fatalf("existing name refusal lost: %v", err)
	}
}

func TestAliasCreationReservesComponentsAfterNameCheck(t *testing.T) {
	var calls []string
	db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{execCalls: &calls})
	defer db.Close()
	err := ValidateExplicitDatasetAliasAvailability(db, "app_orders", "components")
	var conflict *RouteConflictError
	if !errors.As(err, &conflict) || len(calls) != 1 || !strings.Contains(calls[0], "app_validate_dataset_alias") {
		t.Fatalf("refusal=%v, validation=%v", err, calls)
	}
}
