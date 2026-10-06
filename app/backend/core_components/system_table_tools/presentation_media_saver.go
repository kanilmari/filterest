// presentation_media_saver.go
// Saves validated dataset and site presentation images with shared display variants.
// Connects multipart files, signature validation and the existing image variant writer.
// Owns one saver so front page backgrounds do not grow a parallel upload implementation.
package system_table_tools

import (
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	create "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_create"
	"easelect/backend/core_components/filevalidation"
)

func savePresentationMediaFile(storageDir, relativeRoot string, header *multipart.FileHeader,
	allowed func(string) bool, maxSize int64, variants func(string, string) error) (savedDatasetMediaFile, error) {
	if header == nil {
		return savedDatasetMediaFile{}, fmt.Errorf("presentation media file is required")
	}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !allowed(ext) {
		return savedDatasetMediaFile{}, fmt.Errorf("unsupported presentation media file type: %s", ext)
	}
	if maxSize > 0 && header.Size > maxSize {
		return savedDatasetMediaFile{}, fmt.Errorf("presentation media file is too large")
	}
	src, err := header.Open()
	if err != nil {
		return savedDatasetMediaFile{}, err
	}
	defer src.Close()
	if err := filevalidation.ValidateExtensionSignature(src, ext); err != nil {
		return savedDatasetMediaFile{}, err
	}
	relativeDir := filepath.Join(relativeRoot, "original")
	absDir := filepath.Join(storageDir, relativeDir)
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		return savedDatasetMediaFile{}, err
	}
	filename := time.Now().UTC().Format("20060102T150405.000000000Z") + ext
	absPath := filepath.Join(absDir, filename)
	dst, err := os.OpenFile(absPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return savedDatasetMediaFile{}, err
	}
	var reader io.Reader = src
	if maxSize > 0 {
		reader = io.LimitReader(src, maxSize+1)
	}
	n, copyErr := io.Copy(dst, reader)
	closeErr := dst.Close()
	if maxSize > 0 && n > maxSize {
		copyErr = fmt.Errorf("presentation media file is too large")
	}
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(absPath)
		if copyErr != nil {
			return savedDatasetMediaFile{}, copyErr
		}
		return savedDatasetMediaFile{}, closeErr
	}
	if err := variants(filename, ext); err != nil {
		removePresentationMediaFiles(storageDir, relativeRoot, filename)
		return savedDatasetMediaFile{}, err
	}
	return savedDatasetMediaFile{StorageKey: filepath.ToSlash(filepath.Join(relativeDir, filename)),
		OriginalName: filepath.Base(header.Filename), MIMEType: datasetMediaMIMEType(ext)}, nil
}

func createPresentationMediaDisplayVariants(storageDir, relativeRoot, filename, ext string, sizes []int, strict bool) error {
	if ext == ".svg" || ext == ".gif" {
		return nil
	}
	originalPath := filepath.Join(storageDir, relativeRoot, "original", filename)
	for _, size := range sizes {
		variantPath := filepath.Join(storageDir, relativeRoot, strconv.Itoa(size), filename)
		if err := create.CreateImageDisplayVariant(originalPath, variantPath, size); err != nil {
			if strict {
				return err
			}
			log.Printf("presentation media display variant %s/%d: %v", relativeRoot, size, err)
		}
	}
	return nil
}

func removePresentationMediaFiles(storageDir, relativeRoot, filename string) {
	for _, variant := range []string{"original", "300", "1000", "2160"} {
		if err := os.Remove(filepath.Join(storageDir, relativeRoot, variant, filename)); err != nil && !os.IsNotExist(err) {
			log.Printf("presentation media cleanup %s/%s: %v", relativeRoot, variant, err)
		}
	}
}
