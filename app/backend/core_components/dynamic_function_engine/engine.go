// engine.go
// Core execution engine for dynamic CRUD operations. Dispatches requests to the
// appropriate handler based on metadata definitions (ActionType, TargetTable).
// Receives DynamicOperation structs from callers and routes them through the pipeline.
package dynamic_function_engine

import (
	"database/sql"
	"fmt"
)

// DynamicOperation defines parameters for a generic CRUD request.
type DynamicOperation struct {
	ActionType  string
	TargetTable string
	Conditions  map[string]any
	Values      map[string]any
}

// DispatchOperation interprets the DynamicOperation and routes to helpers.
func DispatchOperation(tx *sql.Tx, op DynamicOperation) error {
	switch op.ActionType {
	case "row_update":
		return fmt.Errorf("action type %q is not yet implemented", op.ActionType)
	case "column_delete":
		return fmt.Errorf("action type %q is not yet implemented", op.ActionType)
	default:
		return fmt.Errorf("unknown action type: %s", op.ActionType)
	}
	// TODO: Should this rather be just a CRUD for TCR (tables, columns and rows)?
}
