// row_actor_columns.go
// Reads the authoritative creator and owner marks for a dataset.
// Connects schema protections, row writers and name projections to table_uid.
// Keeps the mutable registry owner setting out of actor-column decisions.
package row_mutation_policy

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

// RowActorColumns maps a physical column name to its creator or owner role.
type RowActorColumns map[string]string

// ReadRowActorColumns uses the caller's connection so mutation checks see
// the same marks as the write. An unmarked dataset returns an empty map.
func ReadRowActorColumns(q dbutils.Querier, tableName string) (RowActorColumns, error) {
	rows, err := q.Query(`
		SELECT public.app_row_actor_column(to_regclass(format('public.%I', $1::text)), actor_role), actor_role
		FROM (VALUES ('creator'), ('owner')) AS roles(actor_role)
	`, tableName)
	if err != nil {
		return nil, fmt.Errorf("read actor columns for %s: %w", tableName, err)
	}
	defer rows.Close()
	marks := make(RowActorColumns)
	for rows.Next() {
		var column sql.NullString
		var role string
		if err := rows.Scan(&column, &role); err != nil {
			return nil, fmt.Errorf("read actor column: %w", err)
		}
		if column.Valid {
			marks[column.String] = role
		}
	}
	return marks, rows.Err()
}

// Protect refuses a schema change to a marked column, independent of its
// metadata permissions and of the registry's compatibility owner setting.
func (marks RowActorColumns) Protect(column string) error {
	if marks[strings.ToLower(column)] == "" {
		return nil
	}
	return &httpresponse.Refusal{Status: http.StatusBadRequest,
		LangKey: "error_owner_column_protected",
		Message: fmt.Sprintf("actor column %s is protected", column)}
}

// RefuseValue prevents clients from choosing the creator or owner through
// ordinary row writes, even if somebody opened its metadata for editing.
func (marks RowActorColumns) RefuseValue(column string) error {
	role := marks[column]
	if role == "" {
		return nil
	}
	return &httpresponse.Refusal{Status: http.StatusBadRequest,
		LangKey: "error_" + role + "_column_not_editable",
		Message: fmt.Sprintf("the row %s column %s cannot be supplied or edited", role, column)}
}

// ValidateCardRoles keeps the creator informational and reserves the username
// card role for the marked owner. Empty roles leave existing metadata alone.
func (marks RowActorColumns) ValidateCardRoles(roles map[string]string) error {
	if len(marks) == 0 {
		return nil // Unmarked datasets keep their existing presentation choices.
	}
	for column, role := range roles {
		actor := marks[strings.ToLower(column)]
		valid := role != "username" || actor == "owner"
		if actor == "creator" {
			valid = role == "" || role == "hidden" || role == "details"
		} else if actor == "owner" {
			valid = role == "" || role == "hidden" || role == "username"
		}
		if !valid {
			return &httpresponse.Refusal{Status: http.StatusBadRequest,
				LangKey: "error_reserved_owner_column",
				Message: fmt.Sprintf("card role %q is not allowed for column %s", role, column)}
		}
	}
	return nil
}
