// modified_col.go
// Handles column modification requests for dynamic tables. Receives column update payloads
// from the frontend and applies schema and metadata changes.
// Exists to share one typed payload shape across column edit handlers.
package dtt_2_column_crud

type ModifiedCol struct {
	OriginalName string `json:"original_name"`
	NewName      string `json:"new_name"`
	DataType     string `json:"data_type"`
	Length       *int   `json:"length,omitempty"`
}
