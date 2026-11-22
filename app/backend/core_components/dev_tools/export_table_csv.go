// export_table_csv.go
// CSV export helpers that stream one table into the resolved mutable runtime area.
// Bridges dev-tool HTTP requests, queryable-column discovery, and filesystem CSV writes.
// Exists to support local inspection without creating state beside immutable app source.
package devtools

import (
	"context"
	"crypto/rand"
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/csv"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/security"

	"github.com/lib/pq"
)

// csvExportFile is the part of *os.File one export needs. Tests wrap real
// temporary files to inject late write, sync, ownership, permission and close failures.
type csvExportFile interface {
	io.Writer
	Sync() error
	Chown(uid, gid int) error
	Chmod(os.FileMode) error
	Close() error
	Name() string
}

// csvExportFS names the filesystem steps of publishing one export.
type csvExportFS struct {
	createTemp      func(dir, finalName string, perm os.FileMode) (csvExportFile, error)
	copyAccessRules func(from, to string) error
	rename          func(from, to string) error
	remove          func(path string) error
}

var osCSVExportFS = csvExportFS{
	createTemp:      createExclusiveCSVTemp,
	copyAccessRules: copyCSVAccessRules,
	rename:          os.Rename,
	remove:          os.Remove,
}

// ExportTableCSVToFile exports a table to the resolved tables_data runtime directory.
// The path is returned only after every row was read and the whole file was
// written, synced, closed and moved into place. ImportTableCSV reads the same
// path, so a failed export leaves the previous complete file untouched.
func ExportTableCSVToFile(ctx context.Context, tableName string) (string, string, error) {
	return exportTableCSVToFile(ctx, tableName, osCSVExportFS)
}

func exportTableCSVToFile(ctx context.Context, tableName string, fsys csvExportFS) (string, string, error) {
	if tableName == "" {
		tableName = "dev_todo"
	}

	sanitizedTableName, err := security.SanitizeIdentifier(tableName)
	if err != nil {
		return "", "", err
	}

	dir := tableCSVDataDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", "", fmt.Errorf("error creating dir: %v", err)
	}

	tx, ok := dbutils.GetTx(ctx)
	if !ok {
		return "", "", fmt.Errorf("transaction missing from context")
	}

	cols, err := dbutils.GetQueryableColumns(sanitizedTableName, tx, false)
	if err != nil {
		return "", "", fmt.Errorf("error fetching columns: %v", err)
	}
	if len(cols) == 0 {
		return "", "", fmt.Errorf("no columns to export")
	}

	quotedCols := make([]string, len(cols))
	for i, c := range cols {
		quotedCols[i] = pq.QuoteIdentifier(c)
	}
	query := fmt.Sprintf("SELECT %s FROM %s", strings.Join(quotedCols, ","), pq.QuoteIdentifier(sanitizedTableName))
	if sanitizedTableName == "dev_todo" {
		query += " WHERE status=1 AND serlog_mvp=true ORDER BY id"
	}
	rows, err := tx.Query(query)
	if err != nil {
		return "", "", fmt.Errorf("error querying table: %v", err)
	}
	defer rows.Close()

	filePath := tableCSVFilePath(sanitizedTableName)
	if err := publishCSVFile(fsys, filePath, func(out io.Writer) error { return writeCSVRows(out, cols, rows) }); err != nil {
		return "", "", err
	}
	return filePath, sanitizedTableName, nil
}

// writeCSVRows writes the header and every row, then reports late row and
// buffered-write failures that the loop itself cannot see.
func writeCSVRows(out io.Writer, cols []string, rows *sql.Rows) error {
	writer := csv.NewWriter(out)
	if err := writer.Write(cols); err != nil {
		return fmt.Errorf("error writing header: %w", err)
	}

	values := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range values {
		ptrs[i] = &values[i]
	}
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return fmt.Errorf("error scanning row: %w", err)
		}
		record := make([]string, len(cols))
		for i, v := range values {
			if t, ok := v.(time.Time); ok {
				record[i] = t.Format(time.RFC3339Nano)
			} else if b, ok := v.([]byte); ok {
				record[i] = string(b)
			} else if v != nil {
				record[i] = fmt.Sprint(v)
			} else {
				record[i] = ""
			}
		}
		if err := writer.Write(record); err != nil {
			return fmt.Errorf("error writing row: %w", err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("error iterating rows: %w", err)
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return fmt.Errorf("error flushing csv: %w", err)
	}
	return nil
}

// publishCSVFile writes into a private temporary file beside target and
// renames it over target only after write, sync and close all succeeded.
// Readers of target therefore see the old or the new complete file. An
// existing target keeps its permission bits and, on Linux, its owner, group
// and POSIX access ACL; if any of them cannot be kept, nothing is replaced.
// The file stays private (0600) until its owner and ACL are in place. A new
// target gets os.Create's 0666 less the umask. A symlinked target is replaced
// where the link points, as writing through it did before; a broken link is
// refused rather than replaced. The rename is not made crash-durable with a
// directory sync.
func publishCSVFile(fsys csvExportFS, target string, write func(io.Writer) error) (err error) {
	if info, linkErr := os.Lstat(target); linkErr == nil && info.Mode()&os.ModeSymlink != 0 {
		resolved, resolveErr := filepath.EvalSymlinks(target)
		if resolveErr != nil {
			return fmt.Errorf("error resolving csv link: %w", resolveErr)
		}
		target = resolved
	}
	perm, keepAccess := os.FileMode(0o666), false
	uid, gid, keepOwner := 0, 0, false
	if info, statErr := os.Stat(target); statErr == nil {
		perm, keepAccess = info.Mode().Perm(), true
		uid, gid, keepOwner = csvOwner(info)
	} else if !errors.Is(statErr, fs.ErrNotExist) {
		return fmt.Errorf("error reading existing csv: %w", statErr)
	}
	createPerm := perm
	if keepAccess {
		createPerm = 0o600
	}
	f, err := fsys.createTemp(filepath.Dir(target), filepath.Base(target), createPerm)
	if err != nil {
		return fmt.Errorf("error creating csv: %w", err)
	}
	tempPath := f.Name()
	closed, published := false, false
	defer func() {
		if !closed {
			if closeErr := f.Close(); closeErr != nil {
				err = errors.Join(err, fmt.Errorf("error closing csv: %w", closeErr))
			}
		}
		if !published {
			if removeErr := fsys.remove(tempPath); removeErr != nil && !errors.Is(removeErr, fs.ErrNotExist) {
				err = errors.Join(err, fmt.Errorf("error removing unfinished csv %s: %w", tempPath, removeErr))
			}
		}
	}()

	if err = write(f); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return fmt.Errorf("error syncing csv: %w", err)
	}
	if keepAccess {
		if keepOwner {
			if err = f.Chown(uid, gid); err != nil {
				return fmt.Errorf("error keeping csv owner and group: %w", err)
			}
		}
		// Access rules go on while the file is still 0600, so nobody they
		// exclude can open it once the permission bits widen.
		if err = fsys.copyAccessRules(target, tempPath); err != nil {
			return fmt.Errorf("error keeping csv access rules: %w", err)
		}
		if err = f.Chmod(perm); err != nil {
			return fmt.Errorf("error keeping csv permissions: %w", err)
		}
	}
	closed = true
	if err = f.Close(); err != nil {
		return fmt.Errorf("error closing csv: %w", err)
	}
	if err = fsys.rename(tempPath, target); err != nil {
		return fmt.Errorf("error publishing csv: %w", err)
	}
	published = true
	return nil
}

// createExclusiveCSVTemp reserves a hidden, uniquely named file beside the
// export. O_EXCL keeps concurrent exports from sharing one temporary file.
func createExclusiveCSVTemp(dir, finalName string, perm os.FileMode) (csvExportFile, error) {
	for attempt := 0; attempt < 16; attempt++ {
		var suffix [8]byte
		if _, err := rand.Read(suffix[:]); err != nil {
			return nil, err
		}
		path := filepath.Join(dir, "."+finalName+"."+hex.EncodeToString(suffix[:])+".tmp")
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, perm)
		if errors.Is(err, fs.ErrExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		return f, nil
	}
	return nil, fmt.Errorf("no free temporary name for %s", finalName)
}

// ExportTableCSVHandler exports the requested table and returns the generated file path as plain text.
func ExportTableCSVHandler(w http.ResponseWriter, r *http.Request) {
	tableName := r.URL.Query().Get("dataset")
	filePath, usedTable, err := ExportTableCSVToFile(r.Context(), tableName)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, "exported %s to %s", usedTable, filePath)
}
