// saveUserGroupRight.go
// Receives user group permission update requests over HTTP and persists them to the
// database after validation. Accepts POST requests from the permissions management UI
// and writes the updated group-route access right to the permissions table.
package backend

import (
	"easelect/backend/core_components/logging"
	"encoding/json"
	"net/http"
	"easelect/backend/core_components/httpresponse"
)

func SaveUserGroupRight(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Vain POST-pyynnöt sallitaan")
		return
	}

	var data struct {
		UserGroupID      int    `json:"usergroup_id"`
		RightID          int    `json:"right_id"`
		TableUID         int    `json:"table_uid"`
		TargetSchemaName string `json:"target_schema_name"`
	}

	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		logging.Errorf("error reading data: %v", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Virhe datan lukemisessa")
		return
	}

	perm := Permission{
		AuthUserGroupID:  data.UserGroupID,
		FunctionID:       data.RightID,
		TargetSchemaName: data.TargetSchemaName,
		TargetTableUID:   data.TableUID,
	}

	if _, err := insertPermission(perm); err != nil {
		logging.Errorf("error inserting permission: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Virhe tallennettaessa oikeutta")
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Oikeus tallennettu onnistuneesti",
	})
}
