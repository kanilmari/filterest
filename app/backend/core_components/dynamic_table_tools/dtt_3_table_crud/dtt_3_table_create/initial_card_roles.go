// initial_card_roles.go
// Chooses and writes card metadata for a dataset that has just been created.
// Connects ordinary creation and managed asset factories to Card visibility roles.
// Callers invoke defaults only inside their successful new-relation branch.
package dtt_3_table_create

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"easelect/backend/core_components/dbutils"
)

var nameLikeCardColumn = regexp.MustCompile(`(^|_)(display_name|name|title|key|label|nimi|otsikko)$`)
var unsafeCardTitleColumn = regexp.MustCompile(`(?i)password|passwd|token|secret|credential|private.?key|api.?key|description|kuvaus|content|body`)

// InitialCardRoles fills omitted roles in stable creation order. Explicit roles
// win, including hidden fields and multiple headings. No existing dataset is read
// or repaired here; the creation transaction owns this one-time decision.
func InitialCardRoles(columns []ColumnDefinition, explicit map[string]string) map[string]string {
	roles := make(map[string]string, len(columns)+len(explicit))
	hasHeader, hasDescription := false, false
	for column, role := range explicit {
		if role = strings.TrimSpace(role); role != "" {
			roles[strings.ToLower(column)] = role
			for _, part := range strings.Split(role, ",") {
				base := strings.TrimSpace(strings.Split(part, "+")[0])
				hasHeader = hasHeader || base == "header"
				hasDescription = hasDescription || strings.HasPrefix(base, "description")
			}
		}
	}
	for _, column := range columns {
		name := strings.ToLower(column.Name)
		if roles[name] != "" {
			continue
		}
		role := "details"
		kind := strings.ToUpper(strings.TrimSpace(column.DataType))
		isText := strings.HasPrefix(kind, "TEXT") || strings.HasPrefix(kind, "VARCHAR") ||
			strings.HasPrefix(kind, "CHARACTER") || strings.HasPrefix(kind, "CHAR(") || kind == "CHAR"
		switch {
		case name == "created_by" || name == "owner_id":
			role = "hidden"
		case isText && !hasHeader && nameLikeCardColumn.MatchString(name) && !unsafeCardTitleColumn.MatchString(name):
			role, hasHeader = "header", true
		case isText && !hasDescription && (name == "content" || name == "description" || name == "kuvaus"):
			role, hasDescription = "description", true
		}
		roles[name] = role
	}
	return roles
}

// ApplyColumnCardRoles is also used by metadata editing. It writes only roles,
// preserving visibility and raw label overrides; a missing target aborts the tx.
func ApplyColumnCardRoles(q dbutils.Querier, tableName string, roles map[string]string) error {
	columns := make([]string, 0, len(roles))
	for column := range roles {
		columns = append(columns, column)
	}
	sort.Strings(columns)
	for _, column := range columns {
		role := strings.TrimSpace(roles[column])
		if role == "" {
			continue
		}
		result, err := q.Exec(`
            UPDATE system_column_details AS cd
            SET card_element = $1, updated = NOW()
            FROM system_db_tables AS dt
            WHERE cd.table_uid = dt.table_uid
              AND dt.schema_name = current_schema()
              AND dt.table_name = $2 AND cd.column_name = $3
        `, role, strings.ToLower(tableName), strings.ToLower(column))
		if err != nil {
			return fmt.Errorf("assign card role: %w", err)
		}
		count, err := result.RowsAffected()
		if err != nil || count != 1 {
			return fmt.Errorf("card role assignment must match one column: %q", column)
		}
	}
	return nil
}
