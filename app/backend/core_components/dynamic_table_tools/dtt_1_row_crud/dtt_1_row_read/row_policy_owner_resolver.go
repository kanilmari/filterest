// row_policy_owner_resolver.go
// Resolves dataset ownership metadata and must-be-true fields for row-read policies.
// Bridges table and column metadata with ReadRowPolicy ownership decisions.
// Exists to preserve legacy ownership fallbacks while explicit metadata is adopted.
package dtt_1_row_read

import (
	"database/sql"
	"log"
	"strings"

	"easelect/backend/core_components/dbutils"
)

const (
	rowPolicyOwnerColumnMetadataColumn = "row_policy_owner_column"
	ownerColumnSourceExplicitMetadata  = "explicit_metadata"
	ownerColumnSourceLegacyFallback    = "legacy_fallback"
)

type ownerColumnResolution struct {
	Column                     string
	Source                     string
	LegacyFallbackColumn       string
	MatchesLegacyFallback      bool
	ComparedWithLegacyFallback bool
}

// resolveOwnerColumn resolves the ownership column used by legacy row-visibility policies.
// It exists as the compatibility wrapper for older call sites that only need the column name.
func resolveOwnerColumn(db dbutils.Querier, tableName string) (string, error) {
	resolution, err := resolveOwnerColumnWithSource(db, tableName)
	if err != nil {
		return "", err
	}
	return resolution.Column, nil
}

// resolveOwnerColumnWithSource prefers explicit row-policy metadata and records when legacy fallback was used.
// It exists between table metadata and ReadRowPolicy so the migration can move away from inferred ownership safely.
func resolveOwnerColumnWithSource(db dbutils.Querier, tableName string) (ownerColumnResolution, error) {
	explicitOwnerColumn, err := fetchExplicitRowPolicyOwnerColumn(db, tableName)
	if err != nil {
		return ownerColumnResolution{}, err
	}

	columnNames, err := fetchTableColumnNameSet(db, tableName)
	if err != nil {
		return ownerColumnResolution{}, err
	}

	resolution := resolveOwnerColumnWithLegacyShadow(explicitOwnerColumn, columnNames)
	if strings.TrimSpace(explicitOwnerColumn) != "" && resolution.Source != ownerColumnSourceExplicitMetadata {
		log.Printf("\033[33mwarning: row policy owner column %q for table %s does not exist; using legacy owner fallback %q\033[0m", explicitOwnerColumn, tableName, resolution.Column)
	}
	if resolution.Source == ownerColumnSourceExplicitMetadata &&
		resolution.ComparedWithLegacyFallback &&
		!resolution.MatchesLegacyFallback {
		log.Printf("[row-policy-owner-shadow] table %s uses explicit owner column %q; legacy fallback would use %q",
			tableName,
			resolution.Column,
			resolution.LegacyFallbackColumn,
		)
	}
	return resolution, nil
}

// fetchExplicitRowPolicyOwnerColumn reads the optional table-level owner-column metadata when the schema supports it.
// It exists so databases that have not run the migration still use the exact legacy fallback behavior.
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

// fetchTableColumnNameSet returns public column names for owner-column validation.
// It exists so explicit metadata can only become active when it names a real column on the dataset table.
func fetchTableColumnNameSet(db dbutils.Querier, tableName string) (map[string]bool, error) {
	rows, err := db.Query(`
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = $1
	`, tableName)
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

// resolveOwnerColumnFromMetadata chooses the explicit owner column first, then the legacy fallback order.
// It exists as a pure selection helper so tests can lock down migration behavior without a live database.
func resolveOwnerColumnFromMetadata(explicitOwnerColumn string, columnNames map[string]bool) ownerColumnResolution {
	explicitOwnerColumn = strings.TrimSpace(explicitOwnerColumn)
	if explicitOwnerColumn != "" && columnNames[explicitOwnerColumn] {
		return ownerColumnResolution{
			Column: explicitOwnerColumn,
			Source: ownerColumnSourceExplicitMetadata,
		}
	}

	ownerCandidates := []string{"created_by", "user_id", "id"}
	for _, candidate := range ownerCandidates {
		if columnNames[candidate] {
			return ownerColumnResolution{
				Column: candidate,
				Source: ownerColumnSourceLegacyFallback,
			}
		}
	}
	return ownerColumnResolution{}
}

// resolveOwnerColumnWithLegacyShadow records the old inferred owner column next to the active resolution.
// It lets all_flags_true_unless_owner compare explicit metadata with legacy behavior without changing SQL predicates.
func resolveOwnerColumnWithLegacyShadow(explicitOwnerColumn string, columnNames map[string]bool) ownerColumnResolution {
	resolution := resolveOwnerColumnFromMetadata(explicitOwnerColumn, columnNames)
	legacyResolution := resolveOwnerColumnFromMetadata("", columnNames)

	resolution.LegacyFallbackColumn = legacyResolution.Column
	resolution.MatchesLegacyFallback = resolution.Column == legacyResolution.Column
	resolution.ComparedWithLegacyFallback = resolution.Column != "" || legacyResolution.Column != ""
	return resolution
}

// getMustBeTrueColumns returns legacy must_be_true_unless_own columns and the resolved owner column.
// It exists as a compatibility wrapper for callers that do not need owner metadata provenance.
func getMustBeTrueColumns(db dbutils.Querier, tableName string) ([]string, string, error) {
	mustTrueCols, ownerResolution, err := getMustBeTrueColumnsWithOwnerResolution(db, tableName)
	if err != nil {
		return nil, "", err
	}
	return mustTrueCols, ownerResolution.Column, nil
}

// getMustBeTrueColumnsWithOwnerResolution returns legacy flag columns plus explicit/fallback owner provenance.
// It exists so ReadRowPolicy can prefer explicit owner metadata while preserving old table behavior.
func getMustBeTrueColumnsWithOwnerResolution(db dbutils.Querier, tableName string) ([]string, ownerColumnResolution, error) {
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
		return nil, ownerColumnResolution{}, err
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
		return nil, ownerColumnResolution{}, err
	}

	if len(mustTrueCols) == 0 {
		return mustTrueCols, ownerColumnResolution{}, nil
	}

	ownerResolution, err := resolveOwnerColumnWithSource(db, tableName)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, ownerColumnResolution{}, err
	}

	return mustTrueCols, ownerResolution, nil
}
