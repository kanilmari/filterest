// fk_label_authorization.go
// Applies the existing dataset and row read boundaries to FK display joins.
// Resolves target permissions and policy metadata once per dataset per query.
// Decisions belong to this request and never enter the shared schema cache.
package dtt_1_row_read

import "easelect/backend/core_components/dbutils"

type foreignLabelAuthorization struct {
	userID         int
	userRole       string
	canReadDataset relatedDatasetPermissionChecker
	loadPolicy     relatedReadPolicyLoader
	policies       map[string]ReadRowPolicy
}

func newForeignLabelAuthorization(db dbutils.Querier, userRole string, userID int) *foreignLabelAuthorization {
	return &foreignLabelAuthorization{
		userID: userID, userRole: userRole,
		canReadDataset: newDatasetPermissionChecker(db, userID, "/api/get-results"),
		loadPolicy:     func(table string) (ReadRowPolicy, error) { return getLegacyMustTrueReadPolicy(db, table) },
		policies:       map[string]ReadRowPolicy{},
	}
}

func (auth *foreignLabelAuthorization) targetCondition(table, alias string, argStart int) (bool, string, []interface{}, error) {
	if auth == nil {
		return false, "", nil, nil
	}
	allowed, err := auth.canReadDataset(table)
	if err != nil || !allowed {
		return false, "", nil, err
	}
	if auth.userRole == "admin" {
		return true, "", nil, nil
	}
	policy, found := auth.policies[table]
	if !found {
		policy, err = auth.loadPolicy(table)
		if err != nil {
			return false, "", nil, err
		}
		auth.policies[table] = policy
	}
	condition, args := buildReadRowPolicyConditionForReference(table, alias, auth.userRole, auth.userID, policy, argStart)
	return true, condition, args, nil
}
