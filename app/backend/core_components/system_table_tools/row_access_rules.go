// row_access_rules.go
// Provides the administrator endpoint and response contracts for exact-row access rules.
// Bridges normalized row-access request, readback, and mutation helpers into one HTTP surface.
// Exists so every supported dataset view can manage the same deny-wins read/update/delete rules safely.
package system_table_tools

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/event_bus"
	"easelect/backend/core_components/httpresponse"
)

const (
	maxRowAccessRequestBytes = 64 * 1024
	maxRowAccessRows         = 200
	maxRowAccessPrincipals   = 50
	maxRowAccessAssignments  = 5000
	maxRowAccessReasonRunes  = 1000
)

var (
	errRowAccessDataset   = errors.New("dataset does not exist or cannot use exact-row rules")
	errRowAccessRows      = errors.New("one or more selected rows do not exist")
	errRowAccessPrincipal = errors.New("selected user or group does not exist")
	errRowAccessAction    = errors.New("unsupported row access action")
	errRowAccessBatch     = errors.New("row access batch is too large")
)

type rowAccessPrincipal struct {
	ID       int64  `json:"id"`
	Type     string `json:"type"`
	Name     string `json:"name"`
	FullName string `json:"full_name,omitempty"`
}

type rowAccessPrincipalRef struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}

type rowAccessAction struct {
	ID           int64  `json:"id"`
	Key          string `json:"key"`
	LabelLangKey string `json:"label_lang_key"`
	CategoryKey  string `json:"category_key"`
	SortOrder    int    `json:"sort_order"`
}

type rowAccessActionState struct {
	State          string `json:"state"`
	AllowCount     int    `json:"allow_count"`
	DenyCount      int    `json:"deny_count"`
	InheritedCount int    `json:"inherited_count"`
}

type rowAccessResponse struct {
	Dataset            string                          `json:"dataset"`
	TableUID           int64                           `json:"table_uid"`
	RowIDs             []int64                         `json:"row_ids"`
	Actions            []rowAccessAction               `json:"actions"`
	Principals         []rowAccessPrincipal            `json:"principals"`
	SelectedPrincipals []rowAccessPrincipalRef         `json:"selected_principals"`
	StateTargetCount   int                             `json:"state_target_count"`
	States             map[string]rowAccessActionState `json:"states"`
	ChangeSetID        string                          `json:"change_set_id,omitempty"`
	AffectedRuleCount  int64                           `json:"affected_rule_count,omitempty"`
}

type rowAccessMutationRequest struct {
	Dataset    string                  `json:"dataset"`
	RowIDs     []int64                 `json:"row_ids"`
	Principals []rowAccessPrincipalRef `json:"principals"`
	Changes    map[string]string       `json:"changes"`
	Reason     string                  `json:"reason,omitempty"`
}

type rowAccessTarget struct {
	TableUID   int64
	SchemaName string
	TableName  string
}

// AdminRowAccessRulesHandler returns direct-rule readback or applies one bulk change set.
// GET|POST /api/admin/row-access-rules
func AdminRowAccessRulesHandler(w http.ResponseWriter, r *http.Request) {
	actor := dbutils.RequestActorContextFromRequest(r)
	if actor.UserRole != "admin" || actor.UserID <= 1 {
		httpresponse.RespondWithError(w, http.StatusForbidden, "administrator access required")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction unavailable")
		return
	}

	switch r.Method {
	case http.MethodGet:
		response, err := getRowAccessResponse(r.Context(), tx, r)
		if err != nil {
			respondWithRowAccessError(w, err)
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, response)
	case http.MethodPost:
		request, err := decodeRowAccessMutationRequest(r.Body)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		response, err := applyRowAccessMutation(r.Context(), tx, actor.UserID, request)
		if err != nil {
			respondWithRowAccessError(w, err)
			return
		}
		publish := func() {
			for _, rowID := range response.RowIDs {
				event_bus.Bus.Publish(response.Dataset, event_bus.Event{
					Table:  response.Dataset,
					RowID:  rowID,
					Action: "permissions",
				})
			}
		}
		if !dbutils.RegisterAfterCommitHook(r.Context(), publish) {
			publish()
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, response)
	}
}

func respondWithRowAccessError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errRowAccessDataset),
		errors.Is(err, errRowAccessRows),
		errors.Is(err, errRowAccessPrincipal),
		errors.Is(err, errRowAccessAction),
		errors.Is(err, errRowAccessBatch):
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
	default:
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "row access rules unavailable")
	}
}

func getRowAccessResponse(ctx context.Context, tx *sql.Tx, r *http.Request) (rowAccessResponse, error) {
	dataset := strings.TrimSpace(r.URL.Query().Get("dataset"))
	rowIDs, err := parseRowAccessRowIDs(r.URL.Query().Get("row_ids"))
	if err != nil {
		return rowAccessResponse{}, err
	}
	target, err := resolveRowAccessTarget(ctx, tx, dataset)
	if err != nil {
		return rowAccessResponse{}, err
	}
	if err := validateRowAccessRows(ctx, tx, target, rowIDs, false); err != nil {
		return rowAccessResponse{}, err
	}
	actions, err := listRowAccessActions(ctx, tx)
	if err != nil {
		return rowAccessResponse{}, err
	}
	principals, err := listRowAccessPrincipals(ctx, tx)
	if err != nil {
		return rowAccessResponse{}, err
	}
	selectedPrincipals, err := parseRowAccessPrincipalRefs(
		r.URL.Query().Get("principals"),
	)
	if err != nil {
		return rowAccessResponse{}, err
	}
	if err := validateRowAccessAssignmentSize(rowIDs, selectedPrincipals); err != nil {
		return rowAccessResponse{}, err
	}
	stateTargetCount := len(rowIDs)
	states := make(map[string]rowAccessActionState, len(actions))
	if len(selectedPrincipals) == 0 {
		for _, action := range actions {
			states[action.Key] = uniformRowAccessState("inherited", len(rowIDs))
		}
	} else {
		if err := validateRowAccessPrincipals(ctx, tx, selectedPrincipals); err != nil {
			return rowAccessResponse{}, err
		}
		stateTargetCount = len(rowIDs) * len(selectedPrincipals)
		states, err = readRowAccessStates(
			ctx,
			tx,
			target.TableUID,
			rowIDs,
			selectedPrincipals,
			actions,
		)
		if err != nil {
			return rowAccessResponse{}, err
		}
	}

	return rowAccessResponse{
		Dataset:            target.TableName,
		TableUID:           target.TableUID,
		RowIDs:             rowIDs,
		Actions:            actions,
		Principals:         principals,
		SelectedPrincipals: selectedPrincipals,
		StateTargetCount:   stateTargetCount,
		States:             states,
	}, nil
}
