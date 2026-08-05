// add_row_types.go
// Defines shared data structures for the add-row process.
// Bridges the handler, db, and helper layers with common payload and result types.
// Exists to provide type-safe structs shared across the dtt_1_row_create package.
package dtt_1_row_create

import (
	"database/sql"
)

// ChildRowPayload sisältää lapsirivin tiedot
// Between: Frontend JSON payload -> insertDataAccordingToPayload
// Why: Defines structure for child row data in the add-row request.
type ChildRowPayload struct {
	TableName         string                 `json:"datasetName"`
	ReferencingColumn string                 `json:"referencingColumn"`
	Data              map[string]interface{} `json:"data"`
}

// ManyToManyPayload sisältää m2m-liitosta koskevat tiedot
// Between: Frontend JSON payload -> insertDataAccordingToPayload
// Why: Defines structure for many-to-many relationship data in the add-row request.
type ManyToManyPayload struct {
	LinkTableName      string                 `json:"linkDatasetName"`
	MainTableFkColumn  string                 `json:"mainDatasetFkColumn"`
	ThirdTableName     string                 `json:"thirdDatasetName"`
	ThirdTableFkColumn string                 `json:"thirdDatasetFkColumn"`
	SelectedValue      interface{}            `json:"selectedValue"`
	IsNewRow           bool                   `json:"isNewRow"`
	NewRowData         map[string]interface{} `json:"newRowData,omitempty"`
}

// ChildInsertResult kantaa tiedot yhdestä lapsirivistä, jotta tiedämme
// tallennusvaiheessa (saveUploadedFiles) mm. lapsirivin ID, taulun nimen jne.
// Between: insertDataAccordingToPayload -> saveUploadedFiles
// Why: Passes information about created child rows to the file saving logic.
type ChildInsertResult struct {
	FieldKey          string // esim. "file_child_0"
	TableName         string
	ReferencingColumn string
	ChildRowID        int64
	MainRowID         int64
}

// queryExecer rajapinta, jota sekä *sql.DB että *sql.Tx toteuttavat.
// Näin voimme kutsua samaa funktiota sekä transaktion sisällä (tx) että ulkopuolella (db).
// Between: Database functions
// Why: Allows functions to accept either a transaction or a DB connection.
type queryExecer interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
	QueryRow(query string, args ...interface{}) *sql.Row
	Query(query string, args ...interface{}) (*sql.Rows, error)
}

// rowQueryer is a subset of queryExecer for functions that only need QueryRow.
// Between: Database functions
// Why: Interface for functions that only need to query a single row.
type rowQueryer interface {
	QueryRow(query string, args ...interface{}) *sql.Row
}
