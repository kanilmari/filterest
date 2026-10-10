// related_dataset_appearance.go
// Supplies current appearance only to readers authorized for ordinary dataset results.
// Connects incoming, outgoing and lazy related results to the shared snapshot reader.
// Pins each authorized name to its UID and never uses the schema metadata cache.
package dtt_1_row_read

import (
	"os"
	"strconv"

	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dataset_visibility"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/permissions"
)

// populateRelatedAppearance reuses get-results' route grant, UI visibility and
// snapshot shape. Related-route authorization alone cannot disclose appearance.
// A duplicate relation reads once per response; every reload reads anew.
func populateRelatedAppearance(results []RelatedTableResult, q dbutils.Querier, userID int) error {
	byName := make(map[string]*store.AppearanceResponse)
	for index := range results {
		name := results[index].Table_name
		snapshot, found := byName[name]
		if !found {
			var err error
			snapshot, err = readAuthorizedRelatedAppearance(q, name, userID)
			if err != nil {
				return err
			}
			byName[name] = snapshot
		}
		if snapshot != nil {
			results[index].DatasetUID = snapshot.DatasetUID
			results[index].DatasetAppearance = snapshot
		}
	}
	return nil
}

func readAuthorizedRelatedAppearance(q dbutils.Querier, name string, userID int) (*store.AppearanceResponse, error) {
	uid, err := store.UIDForName(q, name)
	if err != nil {
		return nil, err
	}
	allowed, err := permissions.CheckRouteTablePermission(q, "/api/get-results", userID,
		permissions.RouteTableScope{TableUID: strconv.Itoa(uid)}, permissions.AccessControlRouteTableOptions(false))
	if err != nil || !allowed {
		return nil, err
	}
	hidden, err := dataset_visibility.HiddenForUser(q, name, userID)
	if err != nil || hidden {
		return nil, err
	}
	snapshot, err := store.ReadAppearanceForName(q, uid, name, os.Getenv("ENVIRONMENT_TYPE") == "dev")
	if err != nil {
		return nil, err
	}
	return &snapshot, nil
}
