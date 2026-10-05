// row_policy_owner_resolver.go
// Resolves the column that names a row's owner for "must be true unless own" rules.
// Bridges dataset metadata, the PostgreSQL system catalog, and ReadRowPolicy.
// Exists so the own-row exception applies only where ownership is proven; any
// other dataset fails closed instead of guessing an owner from column names.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"sync"

	"easelect/backend/core_components/dbutils"
)

const (
	rowPolicyOwnerColumnMetadataColumn = "row_policy_owner_column"

	// A row is "own" when its owner column equals the actor's system_users.id,
	// so that key is the only one an owner column may reference.
	rowOwnerUsersTableName = "system_users"
	rowOwnerUsersKeyColumn = "id"

	// rowOwnerColumnDescriptionField marks the resolved owner in the column
	// descriptions of a results response. buildColumnDescription declares it.
	rowOwnerColumnDescriptionField = "is_row_owner"

	rowOwnerRefusalNoneNamed = "no owner column is named in system_db_tables.row_policy_owner_column"
)

// systemUsersForeignKeyColumnsQuery lists a table's columns that are a
// validated single-column foreign key to system_users(id). It reads the system
// catalog, never information_schema: the constraint views there show a foreign
// key only to the owner of its table, and row policies are read on the guest
// and basic connections, which own no table.
const systemUsersForeignKeyColumnsQuery = `
	SELECT source_column.attname
	FROM pg_catalog.pg_constraint AS foreign_key
	JOIN pg_catalog.pg_class AS source_table
	  ON source_table.oid = foreign_key.conrelid
	JOIN pg_catalog.pg_namespace AS source_schema
	  ON source_schema.oid = source_table.relnamespace
	JOIN pg_catalog.pg_attribute AS source_column
	  ON source_column.attrelid = foreign_key.conrelid
	 AND source_column.attnum = foreign_key.conkey[1]
	JOIN pg_catalog.pg_class AS target_table
	  ON target_table.oid = foreign_key.confrelid
	JOIN pg_catalog.pg_namespace AS target_schema
	  ON target_schema.oid = target_table.relnamespace
	JOIN pg_catalog.pg_attribute AS target_column
	  ON target_column.attrelid = foreign_key.confrelid
	 AND target_column.attnum = foreign_key.confkey[1]
	WHERE foreign_key.contype = 'f'
	  AND foreign_key.convalidated
	  AND cardinality(foreign_key.conkey) = 1
	  AND source_schema.nspname = 'public'
	  AND source_table.relname = $1
	  AND NOT source_column.attisdropped
	  AND target_schema.nspname = 'public'
	  AND target_table.relname = $2
	  AND target_column.attname = $3
`

// builtInRowOwnerColumn returns an owner that code fixes for a dataset, so no
// setting can move or copy it. system_users is the only table that may own
// itself: each of its rows is the user. The app_service_catalog pilot enforces
// user_id as its owner in its database policies, its create preset, and its
// write rule (appendMutationRowPolicyForAction). WL58 also marks that owner
// and gives it a SET NULL foreign key; the pilot's read and write rules still
// use their fixed column and never consult this resolver.
func builtInRowOwnerColumn(tableName string) (string, bool) {
	switch tableName {
	case rowOwnerUsersTableName:
		return rowOwnerUsersKeyColumn, true
	case rlsPilotTableName:
		return rlsPilotOwnerColumn, true
	default:
		return "", false
	}
}

// selectRowPolicyOwnerColumn applies the ownership rule to metadata that has
// already been read: a built-in owner, or the named column when it is a
// validated foreign key to system_users(id). Nothing is inferred from column
// names. Guessing id once turned the rule into "flag OR row id = my user id",
// which let a user whose number matched a row read and change it. The second
// result explains an empty owner. It is pure so the rule is testable without a
// database.
func selectRowPolicyOwnerColumn(tableName, explicitOwnerColumn string, userForeignKeyColumns map[string]bool) (string, string) {
	if ownerColumn, builtIn := builtInRowOwnerColumn(tableName); builtIn {
		return ownerColumn, ""
	}
	explicitOwnerColumn = strings.TrimSpace(explicitOwnerColumn)
	if explicitOwnerColumn == "" {
		return "", rowOwnerRefusalNoneNamed
	}
	if !userForeignKeyColumns[explicitOwnerColumn] {
		return "", fmt.Sprintf("owner column %q is not a validated single-column foreign key to system_users(id)", explicitOwnerColumn)
	}
	return explicitOwnerColumn, ""
}

// resolveRowPolicyOwnerColumn returns the column holding the id of the user who
// owns a row, or "" when the dataset has no proven owner. An empty owner turns
// the own-row exception off: must_be_true_unless_own fields must then be true
// for every non-administrator, and an administrator is told why in the server
// log. Nothing is cached here; GetResults keeps the answer in its schema cache.
func resolveRowPolicyOwnerColumn(db dbutils.Querier, tableName string) (string, error) {
	if ownerColumn, builtIn := builtInRowOwnerColumn(tableName); builtIn {
		return ownerColumn, nil
	}

	explicitOwnerColumn, err := fetchExplicitRowPolicyOwnerColumn(db, tableName)
	if err != nil {
		return "", err
	}

	var userForeignKeyColumns map[string]bool
	if explicitOwnerColumn != "" {
		userForeignKeyColumns, err = fetchSystemUsersForeignKeyColumns(db, tableName)
		if err != nil {
			return "", err
		}
	}

	ownerColumn, refusal := selectRowPolicyOwnerColumn(tableName, explicitOwnerColumn, userForeignKeyColumns)
	if refusal != "" {
		warnRowPolicyOwnerUnresolved(tableName, explicitOwnerColumn, refusal)
	}
	return ownerColumn, nil
}

// reportedRowPolicyOwnerRefusals remembers which refusals have been logged so a
// busy dataset warns once per configuration instead of on every request.
var reportedRowPolicyOwnerRefusals sync.Map

// warnRowPolicyOwnerUnresolved tells an administrator that a dataset's own-row
// exception is off. Dataset metadata has no administrator-visible warning
// channel yet, so the server log carries it. A changed setting warns again.
func warnRowPolicyOwnerUnresolved(tableName, explicitOwnerColumn, refusal string) {
	reportKey := tableName + "\x00" + explicitOwnerColumn + "\x00" + refusal
	if _, alreadyReported := reportedRowPolicyOwnerRefusals.LoadOrStore(reportKey, struct{}{}); alreadyReported {
		return
	}
	log.Printf("\033[33mwarning: dataset %s has no proven row owner: %s. The own-row exception is off: non-administrators see a row only when every must_be_true_unless_own field is true, and hide_on_bg_crd_if_not_own fields stay hidden. Name a column that is a validated foreign key to system_users(id) to enable it.\033[0m", tableName, refusal)
}

// fetchExplicitRowPolicyOwnerColumn reads the optional table-level owner-column metadata when the schema supports it.
// A database that predates the setting names no owner, so its own-row exception stays off.
func fetchExplicitRowPolicyOwnerColumn(db dbutils.Querier, tableName string) (string, error) {
	hasOwnerColumnMetadata, err := columnExistsInTable(db, "system_db_tables", rowPolicyOwnerColumnMetadataColumn)
	if err != nil {
		return "", err
	}
	if !hasOwnerColumnMetadata {
		return "", nil
	}

	var ownerColumn sql.NullString
	err = db.QueryRow(`
		SELECT row_policy_owner_column
		FROM system_db_tables
		WHERE table_name = $1
		LIMIT 1
	`, tableName).Scan(&ownerColumn)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !ownerColumn.Valid {
		return "", nil
	}
	return strings.TrimSpace(ownerColumn.String), nil
}

// fetchSystemUsersForeignKeyColumns returns the columns of a dataset table that
// are a validated single-column foreign key to system_users(id).
// It exists so a named owner column becomes active only when the database itself vouches for it.
func fetchSystemUsersForeignKeyColumns(db dbutils.Querier, tableName string) (map[string]bool, error) {
	rows, err := db.Query(systemUsersForeignKeyColumnsQuery, tableName, rowOwnerUsersTableName, rowOwnerUsersKeyColumn)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columnNames := make(map[string]bool)
	for rows.Next() {
		var columnName string
		if err := rows.Scan(&columnName); err != nil {
			return nil, err
		}
		columnNames[columnName] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return columnNames, nil
}

// getMustBeTrueColumnsWithOwner returns legacy must_be_true_unless_own flag columns and the proven owner column.
// Datasets without flags skip every owner query; an empty owner means the flags apply to everyone but administrators.
func getMustBeTrueColumnsWithOwner(db dbutils.Querier, tableName string) ([]string, string, error) {
	query := `
        SELECT scd.column_name
        FROM system_db_tables sdt
        JOIN system_column_details scd ON sdt.table_uid = scd.table_uid
        WHERE sdt.table_name = $1
          AND scd.must_be_true_unless_own = true
    `
	rows, err := db.Query(query, tableName)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, "", err
	}
	defer rows.Close()

	var mustTrueCols []string
	for rows.Next() {
		var colName string
		if err := rows.Scan(&colName); err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			continue
		}
		mustTrueCols = append(mustTrueCols, colName)
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, "", err
	}

	if len(mustTrueCols) == 0 {
		return mustTrueCols, "", nil
	}

	ownerColumn, err := resolveRowPolicyOwnerColumn(db, tableName)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, "", err
	}

	return mustTrueCols, ownerColumn, nil
}

// resolveResultsRowOwnerColumn returns the owner column a results response
// marks for the browser. A read policy with flags has already resolved it;
// any other dataset resolves it only when some field is hidden on the article
// unless the row is the viewer's own, so ordinary datasets add no queries.
func resolveResultsRowOwnerColumn(db dbutils.Querier, tableName string, readPolicy ReadRowPolicy, columnDataTypes map[string]interface{}) (string, error) {
	if readPolicy.hasFlagColumns() {
		return readPolicy.OwnerColumn, nil
	}
	if !columnDescriptionsHideUnlessOwn(columnDataTypes) {
		return "", nil
	}
	return resolveRowPolicyOwnerColumn(db, tableName)
}

// columnDescriptionsHideUnlessOwn reports whether any delivered column is set to
// hide on the article unless the row is the viewer's own.
func columnDescriptionsHideUnlessOwn(columnDataTypes map[string]interface{}) bool {
	for _, rawDescription := range columnDataTypes {
		description, ok := rawDescription.(map[string]interface{})
		if !ok {
			continue
		}
		if hideUnlessOwn, _ := description["hide_on_bg_crd_if_not_own"].(bool); hideUnlessOwn {
			return true
		}
	}
	return false
}

// markRowOwnerColumnDescription returns the column descriptions with the owner
// column marked is_row_owner, leaving the input untouched. Without a resolved
// owner, or when the owner column is not delivered, nothing is marked and the
// browser treats every row as someone else's. The mark only decides what the
// article shows: the values are already in the response, so it is
// presentation, not authorization.
func markRowOwnerColumnDescription(columnDataTypes map[string]interface{}, ownerColumn string) map[string]interface{} {
	description, delivered := columnDataTypes[ownerColumn].(map[string]interface{})
	if ownerColumn == "" || !delivered {
		return columnDataTypes
	}

	markedDescription := make(map[string]interface{}, len(description)+1)
	for fieldName, value := range description {
		markedDescription[fieldName] = value
	}
	markedDescription[rowOwnerColumnDescriptionField] = true

	marked := make(map[string]interface{}, len(columnDataTypes))
	for columnName, columnDescription := range columnDataTypes {
		marked[columnName] = columnDescription
	}
	marked[ownerColumn] = markedDescription
	return marked
}
