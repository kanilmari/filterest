// create_table_column_list.go
// Reads a dataset creation request strictly and carries its ordered column
// list through creation: the table, card roles, languages and the column
// settings (visibility gate, sort menu, filter bar), then the caches.
// Bridges CreateTableHandler with dtt_3_table_create and system_column_details.
// Exists because the columns used to travel as a map, which has no order, so a
// new dataset's columns were created in a random order.
package dtt_crud_workflows

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_create"
	"easelect/backend/core_components/security"
	"easelect/frontend/shared/card_roles"
)

// CreateColumnDef is one column of a new dataset as the creation request lists
// it: the physical definition and the settings its metadata takes. A required
// value or a default is part of the type (TEXT NOT NULL, BOOLEAN NOT NULL
// DEFAULT FALSE), which isAllowedDataType already accepts.
type CreateColumnDef struct {
	Name     string `json:"name"`
	DataType string `json:"data_type"`
	// CardRole is how a card shows the column; empty keeps the metadata
	// default (details).
	CardRole string `json:"card_role,omitempty"`
	// IsMultilingual is this text column's own language choice; omitted, the
	// column follows the dataset's default.
	IsMultilingual *bool `json:"is_multilingual,omitempty"`
	// VisibilityGate makes this yes/no column decide whether a row is shown
	// to non-administrators (must_be_true_unless_own).
	VisibilityGate bool `json:"visibility_gate,omitempty"`
	// Sortable offers the column in the sort menu, in list order (sco_number).
	Sortable bool `json:"sortable,omitempty"`
	// HideInFilterPanel keeps the column out of the filter bar.
	HideInFilterPanel bool `json:"hide_in_filter_panel,omitempty"`
}

// decodeCreateTableRequest reads exactly one creation request and refuses any
// field the request does not define, so a caller still sending the retired
// columns and column_card_roles maps gets a 400 instead of a dataset built
// from half its request.
// Between: CreateTableHandler -> request body
// Why: The same strict reading as the symbol registry's assignment route.
func decodeCreateTableRequest(body io.Reader) (CreateTableRequest, error) {
	var req CreateTableRequest
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		return CreateTableRequest{}, err
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return CreateTableRequest{}, errors.New("the request body must hold exactly one JSON object")
	}
	return req, nil
}

// validateCreateColumnList checks a creation request's columns before any
// transaction opens and returns them with sanitized names, in the request's
// order. One column that breaks a rule refuses the whole request.
// Between: CreateTableHandler -> column type, card role and language rules
// Why: Everything after this works from the one ordered list.
func validateCreateColumnList(list []CreateColumnDef) ([]CreateColumnDef, error) {
	if len(list) == 0 {
		return nil, errors.New("at least one column is required")
	}
	validated := make([]CreateColumnDef, 0, len(list))
	seen := make(map[string]bool, len(list))
	for _, column := range list {
		name, err := security.SanitizeIdentifier(column.Name)
		if err != nil {
			return nil, fmt.Errorf("invalid column name: %s", column.Name)
		}
		// PostgreSQL folds unquoted names to lower case, so Title and title
		// would be one column.
		if seen[strings.ToLower(name)] {
			return nil, fmt.Errorf("column %q is listed more than once", name)
		}
		seen[strings.ToLower(name)] = true
		if !isAllowedDataType(column.DataType) {
			return nil, fmt.Errorf("column '%s' uses a forbidden data type '%s'", name, column.DataType)
		}
		if len(column.CardRole) > 255 || !card_roles.IsValid(column.CardRole) {
			return nil, fmt.Errorf("unsupported card role for column %q", name)
		}
		if column.IsMultilingual != nil && *column.IsMultilingual && !supportsColumnLanguages(column.DataType) {
			return nil, fmt.Errorf("column %q: multilingual values require a text column", name)
		}
		kind, _, _ := splitAllowedBaseType(column.DataType)
		if column.VisibilityGate && kind != "BOOLEAN" {
			return nil, fmt.Errorf("column %q: only a yes/no (BOOLEAN) column can decide whether a row is shown", name)
		}
		if column.Sortable && (kind == "JSON" || kind == "JSONB") {
			return nil, fmt.Errorf("column %q: a JSON column cannot be a sort option", name)
		}
		// The sort menu offers created and updated as newest, oldest and
		// recently updated already (sort_dropdown_builder_helpers.js).
		if column.Sortable && (strings.EqualFold(name, "created") || strings.EqualFold(name, "updated")) {
			return nil, fmt.Errorf("column %q already has its own sort options", name)
		}
		column.Name = name
		validated = append(validated, column)
	}
	return validated, nil
}

// tableColumnsOf is the list's physical part, in the same order.
func tableColumnsOf(list []CreateColumnDef) []dtt_3_table_create.ColumnDefinition {
	tableColumns := make([]dtt_3_table_create.ColumnDefinition, 0, len(list))
	for _, column := range list {
		tableColumns = append(tableColumns, dtt_3_table_create.ColumnDefinition{Name: column.Name, DataType: column.DataType})
	}
	return tableColumns
}

// cardRolesOf collects the roles the list sets into the map
// applyColumnCardRoles writes. A column without a role keeps the default.
func cardRolesOf(list []CreateColumnDef) map[string]string {
	roles := make(map[string]string, len(list))
	for _, column := range list {
		if strings.TrimSpace(column.CardRole) != "" {
			roles[column.Name] = column.CardRole
		}
	}
	return roles
}

// choosesColumnLanguages tells whether a creation request says anything about
// text languages: the dataset's default or a column's own choice.
func choosesColumnLanguages(req CreateTableRequest, list []CreateColumnDef) bool {
	if req.NewColumnsMultilingual != nil {
		return true
	}
	for _, column := range list {
		if column.IsMultilingual != nil {
			return true
		}
	}
	return false
}

// applyCreateColumnSettings writes the column settings a creation request
// carries besides card roles and languages: the visibility gate
// (must_be_true_unless_own), a sortable column's place in the sort menu
// (sco_number, 1…n in list order) and hiding from the filter bar
// (hide_in_filter_panel). A column without settings is not written, so a
// request that sets none keeps every metadata default.
// Between: CreateTableHandler -> system_column_details
// Why: The metadata already has these columns; creation is where a dataset's
// definition is made, in the same transaction as the table.
func applyCreateColumnSettings(q dbutils.Querier, tableName string, list []CreateColumnDef) error {
	sortPosition := 0
	for _, column := range list {
		if !column.VisibilityGate && !column.Sortable && !column.HideInFilterPanel {
			continue
		}
		// An unset value travels as NULL and keeps the column's default.
		var visibilityGate, hideInFilterPanel sql.NullBool
		var sortNumber sql.NullInt64
		if column.VisibilityGate {
			visibilityGate = sql.NullBool{Bool: true, Valid: true}
		}
		if column.HideInFilterPanel {
			hideInFilterPanel = sql.NullBool{Bool: true, Valid: true}
		}
		if column.Sortable {
			sortPosition++
			sortNumber = sql.NullInt64{Int64: int64(sortPosition), Valid: true}
		}
		result, err := q.Exec(`
            UPDATE system_column_details AS cd
            SET must_be_true_unless_own = COALESCE($1, cd.must_be_true_unless_own),
                sco_number = COALESCE($2, cd.sco_number),
                hide_in_filter_panel = COALESCE($3, cd.hide_in_filter_panel),
                updated = NOW()
            FROM system_db_tables AS dt
            WHERE cd.table_uid = dt.table_uid
              AND dt.schema_name = current_schema()
              AND dt.table_name = $4 AND cd.column_name = $5
        `, visibilityGate, sortNumber, hideInFilterPanel, strings.ToLower(tableName), strings.ToLower(column.Name))
		if err != nil {
			return fmt.Errorf("save column settings: %w", err)
		}
		count, err := result.RowsAffected()
		if err != nil || count != 1 {
			return fmt.Errorf("column settings must match one column: %q", column.Name)
		}
	}
	return nil
}

// scheduleCreatedDatasetCacheInvalidation drops the new dataset's cached read
// state only once the creation commits. Dropped before the commit, a read in
// between could cache the state without the dataset again, and the dataset
// would look missing until that cache expired.
// Between: CreateTableHandler -> dbutils after-commit hooks
// Why: The same order ModifyColumnsHandler keeps for its schema changes.
func scheduleCreatedDatasetCacheInvalidation(ctx context.Context, tableName string, invalidate func(string)) {
	hook := func() { invalidate(tableName) }
	if !dbutils.RegisterAfterCommitHook(ctx, hook) {
		hook()
	}
}

// invalidateDatasetReadCaches drops every cached read of one dataset: its
// schema, its existence, the column settings and the permission columns.
func invalidateDatasetReadCaches(tableName string) {
	dtt_1_row_read.InvalidateSchemaCache(tableName)
	dtt_1_row_read.InvalidateDatasetExistsCache(tableName)
	dtt_1_row_read.InvalidateUserColumnSettingsCache(tableName, "")
	dtt_1_row_read.InvalidatePermissionsCache(tableName)
}
