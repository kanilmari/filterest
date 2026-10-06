// relation_reference_refusal.go
// Refuses links whose stored referenced column has no value.
// Connects both stored-row readers with the translated request refusal contract.
// Exists so a missing key rolls back earlier writes and explains why linking failed.
package dtt_1_row_create

import (
	"easelect/backend/core_components/httpresponse"
	"fmt"
	"net/http"
)

func missingRelationReference(tableName, columnName string) error {
	return &httpresponse.Refusal{
		Status:  http.StatusBadRequest,
		LangKey: "error_relation_reference_missing",
		Message: fmt.Sprintf("referenced value is missing or NULL for %s.%s; no rows were saved", tableName, columnName),
	}
}
