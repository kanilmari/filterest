// storage_relation_parent_reader.go
// Reads visible parent row IDs through configured file-upload relations.
// Bridges storage asset requests with child-table read policies and relation metadata.
// Exists to keep relation-scoped authorization separate from the main storage decision flow.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"easelect/backend/core_components/dbutils"

	"github.com/lib/pq"
)

func visibleStorageRelationParentIDs(
	ctx context.Context,
	permissionDB dbutils.Querier,
	roleDB *sql.DB,
	actor dbutils.RequestActorContext,
	relation storageFileUploadRelation,
	defaultParentUID string,
	request StorageReadRequest,
	expectedParentID int64,
) ([]int64, error) {
	canReadChild, err := storageActorCanReadTable(permissionDB, actor.UserID, relation.ChildTable)
	if err != nil {
		return nil, err
	}
	if !canReadChild {
		return nil, nil
	}

	filenameColumn := strings.TrimSpace(relation.UploadConfig.FilenameColumn)
	foreignKeyColumn := strings.TrimSpace(relation.ForeignKeyColumn)
	if filenameColumn == "" || foreignKeyColumn == "" || strings.TrimSpace(relation.ChildTable) == "" {
		return nil, fmt.Errorf("incomplete file_upload relation %d", relation.RelationID)
	}

	childRead, err := prepareStorageRowRead(ctx, roleDB, relation.ChildTable)
	if err != nil {
		return nil, err
	}
	selectable, err := storageSelectableColumns(childRead.querier, relation.ChildTable)
	if err != nil {
		return nil, err
	}
	if !selectable[filenameColumn] || !selectable[foreignKeyColumn] {
		return nil, nil
	}

	quotedTable := pq.QuoteIdentifier(relation.ChildTable)
	quotedFK := pq.QuoteIdentifier(foreignKeyColumn)
	quotedFilename := pq.QuoteIdentifier(filenameColumn)
	args := make([]interface{}, 0, 2)
	whereClause := ""
	if expectedParentID > 0 {
		args = append(args, expectedParentID)
		whereClause = fmt.Sprintf(" WHERE %s.%s = $1", quotedTable, quotedFK)
	} else {
		args = append(args, request.Filename)
		whereClause = fmt.Sprintf(
			" WHERE (TRIM(%s.%s::text) = $1 OR RIGHT(TRIM(%s.%s::text), LENGTH($1) + 1) = '/' || $1)",
			quotedTable,
			quotedFilename,
			quotedTable,
			quotedFilename,
		)
	}
	whereClause, args = appendReadPolicyToWhereClause(
		relation.ChildTable,
		actor.UserRole,
		actor.UserID,
		childRead.policy,
		whereClause,
		args,
	)
	query := fmt.Sprintf(
		"SELECT %s, %s::text FROM %s%s",
		quotedFK,
		quotedFilename,
		quotedTable,
		whereClause,
	)

	rows, err := childRead.querier.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("read storage relation %d: %w", relation.RelationID, err)
	}
	defer rows.Close()

	parentIDs := make([]int64, 0)
	seen := make(map[int64]bool)
	for rows.Next() {
		var parentID int64
		var storedReference sql.NullString
		if err := rows.Scan(&parentID, &storedReference); err != nil {
			return nil, err
		}
		if parentID <= 0 || !storedReference.Valid {
			continue
		}
		if expectedParentID > 0 && parentID != expectedParentID {
			continue
		}
		if !storageReferenceMatches(storedReference.String, defaultParentUID, parentID, request) {
			continue
		}
		if !seen[parentID] {
			seen[parentID] = true
			parentIDs = append(parentIDs, parentID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return parentIDs, nil
}
