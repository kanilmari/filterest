// mutation_snapshot.go
// Adds request-scope identities to the audit's metadata-only findings.
// Resolves registry row keys through bound values in the same mutation transaction.
// Keeps dangling relations from hiding their valid source dataset from refusal.
package runtime_grants

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strconv"

	"github.com/lib/pq"
)

var metadataRowID = regexp.MustCompile(`^row id ([0-9]+):`)

// LoadMutationSnapshot preserves LoadGrantSnapshot's public audit contract.
// Request callers also need the valid endpoints of an invalid metadata row,
// which the read-only diagnostic text intentionally does not always include.
func LoadMutationSnapshot(ctx context.Context, tx *sql.Tx, roles RoleConfiguration) (GrantSnapshot, error) {
	snapshot, err := LoadGrantSnapshot(ctx, tx, roles)
	if err != nil {
		return snapshot, err
	}
	for i := range snapshot.Blockers {
		finding := &snapshot.Blockers[i]
		match := metadataRowID.FindStringSubmatch(finding.Reason)
		if len(match) == 0 {
			continue
		}
		id, _ := strconv.ParseInt(match[1], 10, 64)
		object := snapshot.Objects[finding.ObjectOID]
		var columns []string
		switch object.Name {
		case "system_db_tables":
			columns = []string{"table_uid"}
		case "system_group_table_func_rights":
			columns = []string{"target_table_uid"}
		case "system_foreign_key_relations_1_m":
			columns = []string{"source_table_uid", "target_table_uid"}
		case "system_foreign_key_relations_m_m":
			columns = []string{"table_a_uid", "table_b_uid", "bridging_table_uid"}
		case "system_row_actor_columns":
			if object.hasColumn("table_uid") {
				columns = []string{"table_uid"}
			}
		}
		for _, column := range columns {
			var uid sql.NullInt64
			query := "SELECT " + pq.QuoteIdentifier(column) + " FROM " + object.Identifier() + " WHERE " + pq.QuoteIdentifier("id") + "=$1"
			// Actor marks need not have an id column; their diagnostic row key
			// is their table UID, already carried explicitly in the finding.
			if object.Name == "system_row_actor_columns" {
				continue
			}
			if err := tx.QueryRowContext(ctx, query, id).Scan(&uid); err != nil {
				return snapshot, fmt.Errorf("resolve mutation blocker row: %w", err)
			}
			if uid.Valid {
				if oid := oidByUID(&snapshot, uid.Int64); oid != 0 {
					setFindingScope(finding, oid)
				}
			}
		}
		if object.Name == "system_triggers" {
			var source, target sql.NullString
			if err := tx.QueryRowContext(ctx, `SELECT source_table,target_table FROM public.system_triggers WHERE id=$1`, id).Scan(&source, &target); err != nil {
				return snapshot, err
			}
			for _, name := range []string{source.String, target.String} {
				if oid := oidByName(&snapshot, name); oid != 0 {
					setFindingScope(finding, oid)
				}
			}
		}
	}
	return snapshot, nil
}

func setFindingScope(finding *Finding, oid int64) {
	for i, current := range finding.ScopeOIDs {
		if current == oid {
			return
		}
		if current == 0 {
			finding.ScopeOIDs[i] = oid
			return
		}
	}
}
