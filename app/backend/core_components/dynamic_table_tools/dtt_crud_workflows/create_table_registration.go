// create_table_registration.go
// Registers a new dataset's folder, identity and requested read permissions.
// Connects creation transactions with application rights and runtime SQL roles.
// Keeps successful dataset creation usable through the selected reader pools.
package dtt_crud_workflows

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	dtt_system_table_folders "easelect/backend/core_components/dynamic_table_tools/dtt_table_folders"
	"easelect/backend/core_components/security"
	"github.com/lib/pq"
)

func resolveCreateTableFolderID(q dbutils.Querier, req CreateTableRequest) (int, error) {
	if req.CreateFolder != nil && strings.TrimSpace(req.CreateFolder.FolderName) != "" {
		return dtt_system_table_folders.CreateFolderWithQuerier(q, dtt_system_table_folders.CreateFolderRequest{
			FolderName: req.CreateFolder.FolderName,
			ParentID:   req.CreateFolder.ParentID,
		})
	}

	if req.FolderID != nil && *req.FolderID > 0 {
		if err := dtt_system_table_folders.EnsureFolderExists(q, *req.FolderID); err != nil {
			return 0, err
		}
		return *req.FolderID, nil
	}

	return dtt_system_table_folders.EnsureDatabaseOtherTablesFolder(q)
}

func ensureTablePermissions(q dbutils.Querier, tableName string, grantUsersRead, grantGuestsRead bool) error {
	// 1. Hae taulun UID
	tableUID, err := ensureRegisteredTableUID(q, tableName)
	if err != nil {
		return err
	}

	// 2. Määrittele tarvittavat funktiot ja ryhmät

	// Funktiot, jotka annetaan Adminille — kaikki table-specific handlerit
	adminFuncNames := []string{
		// dtt_1_row_read
		"dtt_1_row_read.GetResultsHandlerWrapper",
		"dtt_1_row_read.GetIntelligentResultsHandlerWrapper",
		"dtt_1_row_read.GetRowCountHandlerWrapper",
		"dtt_1_row_read.GetFilterOptionsHandler",
		"dtt_1_row_read.GetDynamicChildItemsHandler",
		"dtt_1_row_read.GetResultsVector",
		// dtt_1_row_create
		"dtt_1_row_create.AddRowMultipartHandlerWrapper",
		"dtt_1_row_create.GetAddRowColumnsHandlerWrapper",
		"dtt_1_row_create.GetAddRowMetadataHandlerWrapper",
		"dtt_1_row_create.GetOneToManyRelationsHandlerWrapper",
		"dtt_1_row_create.GetManyToManyTablesHandlerWrapper",
		"dtt_1_row_create.GetReferencedTableData",
		"dtt_1_row_create.GeocodeAddressHandler",
		// dtt_1_row_update
		"dtt_1_row_update.UpdateRowHandlerWrapper",
		// dtt_1_row_delete
		"dtt_1_row_delete.DeleteRowsHandlerWrapper",
		// dtt_2_column_crud
		"dtt_2_column_crud.GetTableColumnsHandler",
		// dtt_crud_workflows
		"dtt_crud_workflows.ModifyColumnsHandler",
		"dtt_crud_workflows.SetCommentsHandler",
		"dtt_crud_workflows.CreateIndexesHandler",
		// dtt_3_table_read / dtt_3_table_delete
		"dtt_3_table_read.GetTableViewHandlerWrapper",
		"dtt_3_table_delete.DropTableHandler",
		// dtt_foreign_keys
		"dtt_foreign_keys.GetForeignKeys",
		"dtt_foreign_keys.AddForeignKeyHandler",
		"dtt_foreign_keys.DeleteForeignKeyHandler",
		// dtt_triggers
		"dtt_triggers.CreateTriggerHandler",
		"dtt_triggers.GetTriggersHandler",
	}

	// Funktiot, jotka annetaan Users/Guests (vain luku)
	readFuncNames := []string{
		"dtt_1_row_read.GetResultsHandlerWrapper",
		"dtt_1_row_read.GetIntelligentResultsHandlerWrapper",
		"dtt_1_row_read.GetRowCountHandlerWrapper",
		"dtt_1_row_read.GetFilterOptionsHandler",
		"dtt_1_row_read.GetDynamicChildItemsHandler",
		"dtt_1_row_read.GetResultsVector",
		"dtt_2_column_crud.GetTableColumnsHandler",
		"dtt_3_table_read.GetTableViewHandlerWrapper",
	}

	// Hae funktioiden ID:t
	getFuncID := func(name string) (int, error) {
		var id int
		err := q.QueryRow("SELECT id FROM system_functions WHERE name = $1", name).Scan(&id)
		return id, err
	}

	// Hae ryhmien ID:t
	getGroupID := func(name string) (int, error) {
		var id int
		err := q.QueryRow("SELECT id FROM system_user_groups WHERE name = $1", name).Scan(&id)
		return id, err
	}

	adminGroupID, err := getGroupID("admins")
	if err != nil {
		return err
	}

	// Lisää Admin-oikeudet
	for _, fnName := range adminFuncNames {
		fid, err := getFuncID(fnName)
		if err != nil {
			log.Printf("warning: function %q not found, skipping admin permission", fnName)
			continue
		}
		if err := insertPerm(q, adminGroupID, fid, tableUID); err != nil {
			return fmt.Errorf("inserting admin permission for %q: %w", fnName, err)
		}
	}

	// Lisää Users-oikeudet
	if grantUsersRead {
		usersGroupID, err := getGroupID("users")
		if err != nil {
			return fmt.Errorf("users group not found: %w", err)
		}
		for _, fnName := range readFuncNames {
			fid, err := getFuncID(fnName)
			if err != nil {
				log.Printf("warning: function %q not found, skipping users permission", fnName)
				continue
			}
			if err := insertPerm(q, usersGroupID, fid, tableUID); err != nil {
				return fmt.Errorf("inserting users permission for %q: %w", fnName, err)
			}
		}
	}

	// Lisää Guests-oikeudet
	if grantGuestsRead {
		guestsGroupID, err := getGroupID("guests")
		if err != nil {
			return fmt.Errorf("guests group not found: %w", err)
		}
		for _, fnName := range readFuncNames {
			fid, err := getFuncID(fnName)
			if err != nil {
				log.Printf("warning: function %q not found, skipping guests permission", fnName)
				continue
			}
			if err := insertPerm(q, guestsGroupID, fid, tableUID); err != nil {
				return fmt.Errorf("inserting guests permission for %q: %w", fnName, err)
			}
		}
	}

	return grantRequestedTableReadPermissions(q, tableName, grantUsersRead, grantGuestsRead)
}

func ensureRegisteredTableUID(q dbutils.Querier, tableName string) (int, error) {
	var tableUID int
	err := q.QueryRow("SELECT table_uid FROM system_db_tables WHERE table_name = $1 AND schema_name = 'public'", tableName).Scan(&tableUID)
	if err == nil {
		return tableUID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("table_uid lookup failed for %s: %w", tableName, err)
	}

	defaultFolderID, err := dtt_system_table_folders.EnsureDatabaseOtherTablesFolder(q)
	if err != nil {
		return 0, fmt.Errorf("failed to resolve default folder for %s: %w", tableName, err)
	}

	insertQuery := `
		INSERT INTO system_db_tables (cached_oid, schema_name, table_name, folder_id)
		SELECT c.oid, n.nspname, c.relname
		     , $2
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind = 'r'
		  AND n.nspname = 'public'
		  AND c.relname = $1
		  AND NOT EXISTS (
			SELECT 1
			FROM system_db_tables s
			WHERE s.table_name = c.relname
			  AND s.schema_name = n.nspname
		  )
	`
	if _, insertErr := q.Exec(insertQuery, tableName, defaultFolderID); insertErr != nil {
		return 0, fmt.Errorf("failed to register metadata row for %s: %w", tableName, insertErr)
	}

	err = q.QueryRow("SELECT table_uid FROM system_db_tables WHERE table_name = $1 AND schema_name = 'public'", tableName).Scan(&tableUID)
	if err != nil {
		return 0, fmt.Errorf("table_uid not found for %s: %w", tableName, err)
	}

	return tableUID, nil
}

func insertPerm(q dbutils.Querier, groupID, funcID, tableUID int) error {
	query := `INSERT INTO system_group_table_func_rights
		(user_group_id, function_id, target_table_uid, target_schema_name)
		VALUES ($1, $2, $3, 'public')
		ON CONFLICT (user_group_id, function_id, COALESCE(target_table_uid, 0)) DO NOTHING`
	_, err := q.Exec(query, groupID, funcID, tableUID)
	return err
}

// grantRequestedTableReadPermissions completes the application read grants
// inside the same creation transaction. Resolve each grantee from its existing
// runtime pool so connection-driver defaults cannot diverge from real reads.
func grantRequestedTableReadPermissions(q dbutils.Querier, tableName string, grantUsersRead, grantGuestsRead bool) error {
	if !grantUsersRead && !grantGuestsRead {
		return nil
	}
	tableName, err := security.SanitizeIdentifier(tableName)
	if err != nil {
		return fmt.Errorf("validate new dataset for read permissions: %w", err)
	}
	readers := []struct {
		requested bool
		label     string
		pool      *sql.DB
	}{
		{grantUsersRead, "basic", backend.DbBasic},
		{grantGuestsRead, "guest", backend.DbGuest},
	}
	for _, reader := range readers {
		if !reader.requested {
			continue
		}
		if reader.pool == nil {
			return fmt.Errorf("%s database pool is unavailable", reader.label)
		}
		var roleName string
		if err := reader.pool.QueryRow("SELECT current_user").Scan(&roleName); err != nil {
			return fmt.Errorf("resolve %s database role: %w", reader.label, err)
		}
		query := "GRANT SELECT ON TABLE " + pq.QuoteIdentifier("public") + "." +
			pq.QuoteIdentifier(tableName) + " TO " + pq.QuoteIdentifier(roleName)
		if _, err := q.Exec(query); err != nil {
			return fmt.Errorf("grant new dataset read permission to %s role: %w", reader.label, err)
		}
	}
	return nil
}
