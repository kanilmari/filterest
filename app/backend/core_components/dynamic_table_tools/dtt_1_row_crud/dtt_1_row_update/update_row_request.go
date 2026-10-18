// update_row_request.go
// Parses ordinary row values and the mutually exclusive image-use operation.
// Shares the explicit-null boundary with UpdateRowHandler.
// Keeps the HTTP handler focused on its transaction and mutation policy.
package dtt_1_row_update

import (
	"encoding/json"
	"errors"
	"strings"
)

type updateRowFieldUpdate struct {
	Column string      `json:"column"`
	Value  interface{} `json:"value"`
}

type updateRowRequest struct {
	Dataset       string                 `json:"dataset"`
	CardImage     *cardImageUpdate       `json:"card_image"`
	Version       string                 `json:"version"`
	SharedVersion string                 `json:"shared_version"`
	ID            int64                  `json:"id"`
	Column        string                 `json:"column"`
	Value         interface{}            `json:"value"`
	Updates       []updateRowFieldUpdate `json:"updates"`
}

// UnmarshalJSON distinguishes an explicit SQL NULL request from a missing value.
func (update *updateRowFieldUpdate) UnmarshalJSON(data []byte) error {
	type plainUpdate updateRowFieldUpdate
	var decoded plainUpdate
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if _, present := fields["value"]; !present {
		return errors.New("Value is required; use explicit null to clear a nullable field")
	}
	*update = updateRowFieldUpdate(decoded)
	return nil
}

// UnmarshalJSON keeps the same explicit-value boundary for the legacy single-field shape.
func (request *updateRowRequest) UnmarshalJSON(data []byte) error {
	type plainRequest updateRowRequest
	var decoded plainRequest
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if strings.TrimSpace(decoded.Column) != "" {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil {
			return err
		}
		if _, present := fields["value"]; !present {
			return errors.New("Value is required; use explicit null to clear a nullable field")
		}
	}
	*request = updateRowRequest(decoded)
	return nil
}

func normalizeUpdateOperations(request updateRowRequest) ([]updateRowFieldUpdate, error) {
	if request.ID == 0 {
		return nil, errors.New("ID is required")
	}
	if request.CardImage != nil {
		if request.Column != "" || len(request.Updates) > 0 {
			return nil, errors.New("image settings must be a separate row-update operation")
		}
		return nil, nil
	}

	normalized := make([]updateRowFieldUpdate, 0, len(request.Updates)+1)
	if trimmedColumn := strings.TrimSpace(request.Column); trimmedColumn != "" {
		normalized = append(normalized, updateRowFieldUpdate{
			Column: trimmedColumn,
			Value:  request.Value,
		})
	}

	for _, update := range request.Updates {
		trimmedColumn := strings.TrimSpace(update.Column)
		if trimmedColumn == "" {
			return nil, errors.New("Column is required")
		}
		normalized = append(normalized, updateRowFieldUpdate{
			Column: trimmedColumn,
			Value:  update.Value,
		})
	}

	if len(normalized) == 0 {
		return nil, errors.New("at least one update is required")
	}
	for _, update := range normalized {
		if strings.HasPrefix(update.Column, "card_image_") {
			return nil, errors.New("use the card_image row-update operation")
		}
	}
	return normalized, nil
}
