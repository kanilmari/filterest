// storage_table_folder_cleanup.go
// Archives top-level dataset storage folders that no longer belong in active storage/.
// Bridges dataset-delete flows, admin maintenance actions, and the filesystem media root.
// Exists so temp/test dataset table_uid folders do not accumulate forever under storage/.
package storagecleanup

import (
	"context"
	"easelect/backend/core_components/dbutils"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	backend "easelect/backend/core_components"
)

const (
	StorageRootDir        = "storage"
	StorageDeletedRootDir = "storage_deleted"
)

type ArchivedStorageFolderStatus struct {
	FolderName string `json:"folder"`
	TableName  string `json:"table_name,omitempty"`
	IsLive     bool   `json:"is_live"`
	Prunable   bool   `json:"prunable"`
}

func listKnownStorageTableUIDs() (map[string]bool, error) {
	rows, err := backend.Db.Query(`SELECT table_uid FROM system_db_tables`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	known := make(map[string]bool)
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		known[uid] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return known, nil
}

func listKnownStorageTableNames() (map[string]string, error) {
	rows, err := backend.Db.Query(`SELECT table_uid, table_name FROM system_db_tables`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	known := make(map[string]string)
	for rows.Next() {
		var uid string
		var tableName string
		if err := rows.Scan(&uid, &tableName); err != nil {
			return nil, err
		}
		known[uid] = tableName
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return known, nil
}

func normalizeStorageFolderName(folderName string) string {
	trimmed := strings.TrimSpace(folderName)
	if trimmed == "" || trimmed == "." || trimmed == ".." {
		return ""
	}
	if strings.ContainsRune(trimmed, filepath.Separator) {
		return ""
	}
	return trimmed
}

// ListUnknownStorageTableFolders returns top-level storage folders whose table_uid no longer exists in system_db_tables.
func ListUnknownStorageTableFolders() ([]string, error) {
	entries, err := os.ReadDir(StorageRootDir)
	if err != nil {
		return nil, err
	}

	knownUIDs, err := listKnownStorageTableUIDs()
	if err != nil {
		return nil, err
	}

	unknown := make([]string, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		folderName := normalizeStorageFolderName(entry.Name())
		if folderName == "" || knownUIDs[folderName] {
			continue
		}
		unknown = append(unknown, folderName)
	}
	sort.Strings(unknown)
	return unknown, nil
}

// ListArchivedStorageTableFolders returns top-level storage_deleted folders plus their live-dataset status.
func ListArchivedStorageTableFolders() ([]ArchivedStorageFolderStatus, error) {
	entries, err := os.ReadDir(StorageDeletedRootDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []ArchivedStorageFolderStatus{}, nil
		}
		return nil, err
	}

	knownTables, err := listKnownStorageTableNames()
	if err != nil {
		return nil, err
	}

	archived := make([]ArchivedStorageFolderStatus, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		folderName := normalizeStorageFolderName(entry.Name())
		if folderName == "" {
			continue
		}
		tableName, isLive := knownTables[folderName]
		archived = append(archived, ArchivedStorageFolderStatus{
			FolderName: folderName,
			TableName:  tableName,
			IsLive:     isLive,
			Prunable:   !isLive,
		})
	}

	sort.SliceStable(archived, func(i, j int) bool {
		return archived[i].FolderName < archived[j].FolderName
	})
	return archived, nil
}

func archiveStoragePathContents(srcDir, dstDir string) error {
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}

	for _, entry := range entries {
		srcPath := filepath.Join(srcDir, entry.Name())
		dstPath := filepath.Join(dstDir, entry.Name())

		if _, err := os.Stat(dstPath); os.IsNotExist(err) {
			if err := MovePathToDeletedStorage(srcPath, dstPath); err != nil {
				return fmt.Errorf("move %s -> %s: %w", srcPath, dstPath, err)
			}
			continue
		}

		if entry.IsDir() {
			if err := archiveStoragePathContents(srcPath, dstPath); err != nil {
				return err
			}
			if err := os.Remove(srcPath); err != nil && !os.IsNotExist(err) {
				return err
			}
			continue
		}

		renamedDstPath := dstPath + ".archived"
		if err := MovePathToDeletedStorage(srcPath, renamedDstPath); err != nil {
			return fmt.Errorf("move %s -> %s: %w", srcPath, renamedDstPath, err)
		}
	}

	if err := os.Remove(srcDir); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// ArchiveTableStorageFolder moves one active storage/<table_uid> tree under storage_deleted/<table_uid>.
func ArchiveTableStorageFolder(tableUID string) error {
	trimmedTableUID := strings.TrimSpace(tableUID)
	if trimmedTableUID == "" {
		return nil
	}
	srcDir := filepath.Join(StorageRootDir, trimmedTableUID)
	if _, err := os.Stat(srcDir); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	dstDir := filepath.Join(StorageDeletedRootDir, trimmedTableUID)
	return archiveStoragePathContents(srcDir, dstDir)
}

// QueueArchiveTableStorageAfterCommit archives one dataset storage root after the surrounding transaction commits.
func QueueArchiveTableStorageAfterCommit(ctx context.Context, tableUID string) {
	trimmedTableUID := strings.TrimSpace(tableUID)
	if trimmedTableUID == "" {
		return
	}

	archiveFn := func() {
		if err := ArchiveTableStorageFolder(trimmedTableUID); err != nil {
			log.Printf("\033[31merror: archiving storage folder %s: %v\033[0m", trimmedTableUID, err)
		}
	}

	if !dbutils.RegisterAfterCommitHook(ctx, archiveFn) {
		archiveFn()
	}
}

// ArchiveUnknownStorageTableFolders archives all storage/ roots whose table_uid no longer exists.
func ArchiveUnknownStorageTableFolders() ([]string, error) {
	unknownFolders, err := ListUnknownStorageTableFolders()
	if err != nil {
		return nil, err
	}

	archived := make([]string, 0, len(unknownFolders))
	for _, folderName := range unknownFolders {
		if err := ArchiveTableStorageFolder(folderName); err != nil {
			return archived, err
		}
		archived = append(archived, folderName)
	}
	return archived, nil
}

// PruneArchivedStorageTableFolders permanently removes selected archived top-level dataset roots.
// Only folders that no longer map to a live dataset are prunable.
func PruneArchivedStorageTableFolders(targetFolders []string) ([]string, error) {
	archivedFolders, err := ListArchivedStorageTableFolders()
	if err != nil {
		return nil, err
	}

	prunable := make(map[string]bool, len(archivedFolders))
	for _, folder := range archivedFolders {
		if folder.Prunable {
			prunable[folder.FolderName] = true
		}
	}

	requestedFolders := make([]string, 0)
	if len(targetFolders) == 0 {
		for folderName := range prunable {
			requestedFolders = append(requestedFolders, folderName)
		}
	} else {
		seen := make(map[string]bool, len(targetFolders))
		for _, folderName := range targetFolders {
			normalized := normalizeStorageFolderName(folderName)
			if normalized == "" || seen[normalized] {
				continue
			}
			seen[normalized] = true
			requestedFolders = append(requestedFolders, normalized)
		}
	}

	sort.Strings(requestedFolders)
	pruned := make([]string, 0, len(requestedFolders))
	for _, folderName := range requestedFolders {
		if !prunable[folderName] {
			continue
		}
		if err := os.RemoveAll(filepath.Join(StorageDeletedRootDir, folderName)); err != nil {
			return pruned, err
		}
		pruned = append(pruned, folderName)
	}
	return pruned, nil
}
