// add_row_files.go
// Handles file uploads and thumbnail generation during row creation.
// Bridges multipart form data and the filesystem storage path.
// Exists to persist uploaded files and generate thumbnails as part of the add-row flow.
package dtt_1_row_create

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
	dtt_asset_linking "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	filevalidation "easelect/backend/core_components/filevalidation"
	"easelect/backend/core_components/httpresponse"

	media_utils "easelect/backend/core_components/media_utils"

	"github.com/lib/pq"
)

// saveUploadedFiles tallentaa uploadsit ja luo thumbnailit kutsuen ResizeImageMaxDimension -funktiota.
// Between: AddRowMultipartHandler -> Filesystem
// Why: Handles saving of uploaded files and generation of thumbnails.
func saveUploadedFiles(
	ctx context.Context,
	tx queryExecer,
	w http.ResponseWriter,
	fileMap map[string][]*multipart.FileHeader,
	baseDir string,
	tableName string,
	tableUID string,
	mainRowID int64,
	childInsertResults []ChildInsertResult,
) error {
	// Kerätään ChildInsertResult map-muotoon fieldKey -> ChildInsertResult
	resultMap := make(map[string]ChildInsertResult)
	for _, res := range childInsertResults {
		resultMap[res.FieldKey] = res
	}

	for fieldName, fhArray := range fileMap {
		if !strings.HasPrefix(fieldName, "file_child_") {
			continue
		}
		if len(fhArray) == 0 {
			continue
		}
		fh := fhArray[0]

		srcFile, err := fh.Open()
		if err != nil {
			fmt.Printf("\033[31m[saveUploadedFiles] error: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error opening file")
			return fmt.Errorf("open uploaded file: %w", err)
		}
		// NOTE: srcFile.Close() called explicitly at end of loop iteration — do not defer inside loop

		resInfo, hasChildResult := resultMap[fieldName]
		childRowID := resInfo.ChildRowID
		childTableName := resInfo.TableName
		referencingColumn := resInfo.ReferencingColumn

		// When file_child_* has no matching _childRows entry, treat the main row as the
		// target (for example direct uploads into a canonical shared asset table).
		if !hasChildResult {
			childRowID = mainRowID
			childTableName = tableName
		}

		uploadConfig, resolvedSourceColumn, configErr := loadFileUploadConfigForUpload(tx, childTableName, resInfo.ReferencingColumn)
		if configErr != nil {
			fmt.Printf("\033[31m[saveUploadedFiles] error loading file_upload config for %s: %s\033[0m\n", childTableName, configErr.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error loading upload config")
			srcFile.Close()
			return fmt.Errorf("load upload config for %s: %w", childTableName, configErr)
		}

		effectiveReferencingColumn := referencingColumn
		if strings.TrimSpace(effectiveReferencingColumn) == "" {
			effectiveReferencingColumn = resolvedSourceColumn
		}
		storedAssetKind, storedReferenceValue, storedContextErr := loadStoredUploadRowContext(
			tx,
			childTableName,
			childRowID,
			effectiveReferencingColumn,
			len(uploadConfig.Profiles) > 0,
		)
		if storedContextErr != nil {
			fmt.Printf("\033[31m[saveUploadedFiles] error loading stored upload context for %s: %s\033[0m\n", childTableName, storedContextErr.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error loading uploaded row")
			srcFile.Close()
			return fmt.Errorf("load stored upload row context for %s: %w", childTableName, storedContextErr)
		}
		if storedContextErr == nil {
			if profileKey := dtt_asset_linking.ResolveProfileKeyForAssetKind(storedAssetKind); profileKey != "" {
				if resolvedConfig, ok := dtt_asset_linking.ResolveEffectiveUploadConfigForProfile(uploadConfig, childTableName, profileKey); ok {
					uploadConfig = resolvedConfig
				}
			}
		}

		allowedExtensions := resolveAllowedExtensions(uploadConfig)
		originalExt := strings.TrimPrefix(strings.ToLower(filepath.Ext(fh.Filename)), ".")
		if originalExt == "" {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "unsupported file type")
			srcFile.Close()
			return fmt.Errorf("uploaded file has no extension")
		}
		if !isAllowedExtension(originalExt, allowedExtensions) {
			fmt.Printf("[INFO] unsupported file extension: %s\n", originalExt)
			httpresponse.RespondWithError(w, http.StatusBadRequest, "unsupported file type")
			srcFile.Close()
			return fmt.Errorf("unsupported uploaded file extension: %s", originalExt)
		}
		if err := filevalidation.ValidateExtensionSignature(srcFile, originalExt); err != nil {
			fmt.Printf("[INFO] upload signature rejected for .%s: %s\n", originalExt, err.Error())
			httpresponse.RespondWithError(w, http.StatusBadRequest, "unsupported file type")
			srcFile.Close()
			return fmt.Errorf("validate uploaded file signature: %w", err)
		}

		storageContext, storageContextErr := dtt_asset_linking.ResolveSharedAssetParentStorageContext(
			tx,
			childTableName,
			effectiveReferencingColumn,
			storedReferenceValue,
		)
		if storageContextErr != nil {
			fmt.Printf("\033[31m[saveUploadedFiles] error resolving shared asset storage context for %s: %s\033[0m\n", childTableName, storageContextErr.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error resolving asset storage path")
			srcFile.Close()
			return fmt.Errorf("resolve shared asset storage context: %w", storageContextErr)
		}
		storageTableUID, storageParentRowID, storageResolveErr := resolveUploadStorageCoordinates(
			tableUID,
			mainRowID,
			hasChildResult,
			storageContext,
		)
		if storageResolveErr != nil {
			fmt.Printf("\033[31m[saveUploadedFiles] error resolving upload storage coordinates for %s: %s\033[0m\n", childTableName, storageResolveErr.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error resolving asset storage path")
			srcFile.Close()
			return fmt.Errorf("resolve upload storage coordinates: %w", storageResolveErr)
		}

		baseFolder := filepath.Join(baseDir, storageTableUID, fmt.Sprintf("%d", storageParentRowID))
		uploadSubfolders := requiredUploadSubfolders(uploadConfig)
		for _, sub := range uploadSubfolders {
			if err = os.MkdirAll(filepath.Join(baseFolder, sub), 0755); err != nil {
				fmt.Printf("\033[31m[saveUploadedFiles] error: %s\033[0m\n", err.Error())
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "error creating directory")
				srcFile.Close()
				return fmt.Errorf("create upload directory: %w", err)
			}
		}
		originalFolder := filepath.Join(baseFolder, "original")

		newFileName := fmt.Sprintf("%s_%d_%d.%s", storageTableUID, storageParentRowID, childRowID, originalExt)
		originalPath := filepath.Join(originalFolder, newFileName)

		dstFile, err := os.Create(originalPath)
		if err != nil {
			fmt.Printf("\033[31m[saveUploadedFiles] error: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error creating file")
			srcFile.Close()
			return fmt.Errorf("create uploaded file: %w", err)
		}
		cleanupUpload := func() {
			removeUploadedFileVariants(baseFolder, uploadSubfolders, newFileName)
		}
		rollbackCleanupRegistered := dbutils.RegisterAfterRollbackHook(ctx, cleanupUpload)

		_, err = io.Copy(dstFile, srcFile)
		dstFile.Close()
		srcFile.Close()
		if err != nil {
			fmt.Printf("\033[31m[saveUploadedFiles] error: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error saving file")
			if !rollbackCleanupRegistered {
				cleanupUpload()
			}
			return fmt.Errorf("save uploaded file: %w", err)
		}
		fmt.Printf("[INFO] saved file: %s\n", originalPath)

		if isImageUpload(uploadConfig) {
			for _, sub := range media_utils.RequiredSubfolders {
				if sub == "original" {
					continue
				}
				size, err := strconv.Atoi(sub)
				if err != nil {
					continue
				}
				thumbPath := filepath.Join(baseFolder, sub, newFileName)
				if err := CreateImageDisplayVariant(originalPath, thumbPath, size); err != nil {
					fmt.Printf("\033[31m[saveUploadedFiles] image display variant creation failed: %s\033[0m\n", err.Error())
					httpresponse.RespondWithError(w, http.StatusInternalServerError, "error creating image display variant")
					if !rollbackCleanupRegistered {
						cleanupUpload()
					}
					return fmt.Errorf("create image display variant %s: %w", sub, err)
				}
				fmt.Printf("[INFO] created image display variant: %s\n", thumbPath)
			}
		}

		// Päivitetään rivin filename
		if err := updateFilenameInChildRow(tx, childTableName, childRowID, newFileName); err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error updating uploaded filename")
			if !rollbackCleanupRegistered {
				cleanupUpload()
			}
			return err
		}

		// Päivitetään cacheTargets myös suorissa asset-uploadeissa, kun parent-FK voidaan lukea tallennetulta riviltä.
		if strings.TrimSpace(effectiveReferencingColumn) != "" {
			filenameColumn := "filename"
			if uploadConfig.FilenameColumn != "" {
				filenameColumn = uploadConfig.FilenameColumn
			}
			tempChildData := map[string]interface{}{
				filenameColumn: newFileName,
			}
			shouldUpdateCache := false
			if hasChildResult {
				tempChildData[effectiveReferencingColumn] = mainRowID
				shouldUpdateCache = true
			} else if storedContextErr == nil && storedReferenceValue != nil {
				tempChildData[effectiveReferencingColumn] = storedReferenceValue
				shouldUpdateCache = true
			}
			if !shouldUpdateCache {
				continue
			}
			if err := updateCacheTargetsNoTx(tx, childTableName, effectiveReferencingColumn, tempChildData); err != nil {
				fmt.Printf("\033[31m[saveUploadedFiles -> updateCacheTargetsNoTx] error: %s\033[0m\n", err.Error())
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "error updating image preview")
				if !rollbackCleanupRegistered {
					cleanupUpload()
				}
				return fmt.Errorf("update uploaded file cache targets: %w", err)
			}
		}
	}
	return nil
}

func removeUploadedFileVariants(baseFolder string, subfolders []string, fileName string) {
	for _, subfolder := range subfolders {
		filePath := filepath.Join(baseFolder, subfolder, fileName)
		if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
			fmt.Printf("[INFO] rollback cleanup could not remove %s: %s\n", filePath, err.Error())
		}
		_ = os.Remove(filepath.Join(baseFolder, subfolder))
	}
	_ = os.Remove(baseFolder)
}

func resolveUploadStorageCoordinates(
	defaultTableUID string,
	defaultParentRowID int64,
	hasChildResult bool,
	storageContext dtt_asset_linking.SharedAssetParentStorageContext,
) (string, int64, error) {
	if hasChildResult {
		return defaultTableUID, defaultParentRowID, nil
	}

	if strings.TrimSpace(storageContext.ParentTableUID) == "" || storageContext.ParentRowID <= 0 {
		return defaultTableUID, defaultParentRowID, nil
	}

	return storageContext.ParentTableUID, storageContext.ParentRowID, nil
}

func loadFileUploadConfigForUpload(q queryExecer, childTableName string, referencingColumn string) (dtt_asset_linking.FileUploadConfig, string, error) {
	query := `
		SELECT fr.target_insert_specs, fr.source_column_name
		  FROM system_foreign_key_relations_1_m fr
		  JOIN system_db_tables s_src ON s_src.table_uid = fr.source_table_uid
		 WHERE s_src.table_name = $1
		   AND fr.target_insert_specs->'file_upload' IS NOT NULL`

	args := []interface{}{childTableName}
	if strings.TrimSpace(referencingColumn) != "" {
		query += ` AND fr.source_column_name = $2`
		args = append(args, referencingColumn)
	}
	query += ` ORDER BY fr.id ASC LIMIT 1`

	var rawSpecs []byte
	var resolvedSourceColumn string
	if err := q.QueryRow(query, args...).Scan(&rawSpecs, &resolvedSourceColumn); err != nil {
		if err == sql.ErrNoRows {
			return dtt_asset_linking.FileUploadConfig{}, "", nil
		}
		return dtt_asset_linking.FileUploadConfig{}, "", err
	}

	config, err := dtt_asset_linking.ParseFileUploadConfig(rawSpecs)
	if err == dtt_asset_linking.ErrMissingFileUploadConfig {
		return dtt_asset_linking.FileUploadConfig{}, resolvedSourceColumn, nil
	}
	if err != nil {
		return dtt_asset_linking.FileUploadConfig{}, resolvedSourceColumn, err
	}
	return config, resolvedSourceColumn, nil
}

func resolveAllowedExtensions(config dtt_asset_linking.FileUploadConfig) map[string]struct{} {
	if len(config.AllowedFileTypes) > 0 {
		allowed := make(map[string]struct{}, len(config.AllowedFileTypes))
		for _, ext := range config.AllowedFileTypes {
			trimmed := strings.TrimSpace(strings.TrimPrefix(strings.ToLower(ext), "."))
			if trimmed == "" {
				continue
			}
			allowed[trimmed] = struct{}{}
		}
		if len(allowed) > 0 {
			return allowed
		}
	}

	allowed := make(map[string]struct{}, len(media_utils.AllowedImageExtensions))
	for ext := range media_utils.AllowedImageExtensions {
		allowed[strings.TrimPrefix(strings.ToLower(ext), ".")] = struct{}{}
	}
	return allowed
}

func isAllowedExtension(extension string, allowed map[string]struct{}) bool {
	_, ok := allowed[strings.TrimPrefix(strings.ToLower(extension), ".")]
	return ok
}

func isImageUpload(config dtt_asset_linking.FileUploadConfig) bool {
	if config.ProfileKey == dtt_asset_linking.AssetProfileImage {
		return true
	}
	for _, assetKind := range config.AssetKinds {
		if assetKind == dtt_asset_linking.AssetKindImage {
			return true
		}
	}
	return false
}

func requiredUploadSubfolders(config dtt_asset_linking.FileUploadConfig) []string {
	if isImageUpload(config) {
		return media_utils.RequiredSubfolders
	}
	return []string{"original"}
}

func loadStoredUploadRowContext(
	q queryExecer,
	childTableName string,
	childRowID int64,
	referencingColumn string,
	includeAssetKind bool,
) (string, interface{}, error) {
	if childRowID <= 0 || strings.TrimSpace(referencingColumn) == "" {
		return "", nil, nil
	}

	var (
		assetKind string
		refValue  interface{}
	)

	if includeAssetKind {
		query := fmt.Sprintf(
			`SELECT COALESCE(asset_kind, ''), %s FROM %s WHERE id = $1`,
			pq.QuoteIdentifier(referencingColumn),
			pq.QuoteIdentifier(childTableName),
		)
		if err := q.QueryRow(query, childRowID).Scan(&assetKind, &refValue); err != nil {
			return "", nil, err
		}
		return assetKind, refValue, nil
	}

	query := fmt.Sprintf(
		`SELECT %s FROM %s WHERE id = $1`,
		pq.QuoteIdentifier(referencingColumn),
		pq.QuoteIdentifier(childTableName),
	)
	if err := q.QueryRow(query, childRowID).Scan(&refValue); err != nil {
		return "", nil, err
	}
	return "", refValue, nil
}
