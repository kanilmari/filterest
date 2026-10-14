// custom_root_files.go
// Reads the opt-in root setting and safely opens operator-owned static files.
// Connects persistent storage with root delivery, bootstrap and administrator status.
// Keeps source, runtime output and files outside site_root out of this boundary.
package backend

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const DisplayIndexHTMLAtStartupKey = "display_index_html_at_startup"

// ReadDisplayIndexHTMLAtStartup defaults an absent row to false, without a migration.
func ReadDisplayIndexHTMLAtStartup(ctx context.Context, db *sql.DB) (bool, error) {
	if db == nil {
		return false, errors.New("custom root settings database unavailable")
	}
	var enabled bool
	err := db.QueryRowContext(ctx, `SELECT boolean_value FROM public.system_config WHERE key = $1`, DisplayIndexHTMLAtStartupKey).Scan(&enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return enabled, err
}

type customRootFileType struct {
	mime    string
	maxSize int64
}

// Explicit types avoid operating-system MIME overrides and executable/download files.
var customRootFileTypes = map[string]customRootFileType{
	".html": {"text/html; charset=utf-8", 2 << 20},
	".css":  {"text/css; charset=utf-8", 2 << 20},
	".js":   {"text/javascript; charset=utf-8", 2 << 20},
	".png":  {"image/png", 10 << 20}, ".jpg": {"image/jpeg", 10 << 20},
	".jpeg": {"image/jpeg", 10 << 20}, ".webp": {"image/webp", 10 << 20},
	".gif": {"image/gif", 10 << 20}, ".avif": {"image/avif", 10 << 20},
	".svg": {"image/svg+xml", 10 << 20}, ".ico": {"image/vnd.microsoft.icon", 10 << 20},
	".woff": {"font/woff", 10 << 20}, ".woff2": {"font/woff2", 10 << 20},
	".ttf": {"font/ttf", 10 << 20}, ".otf": {"font/otf", 10 << 20},
	".mp4": {"video/mp4", 50 << 20}, ".webm": {"video/webm", 50 << 20},
}

// OpenSiteRootFile returns a regular, bounded file through Go's traversal-resistant
// directory handles. No symlink is accepted; os.Root also confines concurrent
// path replacement to the opened directory. The caller closes the returned file.
func OpenSiteRootFile(storageRoot, name string) (*os.File, os.FileInfo, string, error) {
	refuse := errors.New("custom root file unavailable")
	if !validSiteRootName(name) {
		return nil, nil, "", refuse
	}
	fileType, allowed := customRootFileTypes[path.Ext(name)]
	if !allowed {
		return nil, nil, "", refuse
	}
	storage, err := os.OpenRoot(storageRoot)
	if err != nil {
		return nil, nil, "", err
	}
	defer storage.Close()
	directoryInfo, err := storage.Lstat("site_root")
	if err != nil {
		return nil, nil, "", err
	}
	if !directoryInfo.IsDir() {
		return nil, nil, "", refuse
	}
	directory, err := storage.OpenRoot("site_root")
	if err != nil {
		return nil, nil, "", err
	}
	defer directory.Close()
	openedInfo, err := directory.Stat(".")
	if err != nil || !os.SameFile(directoryInfo, openedInfo) {
		return nil, nil, "", refuse
	}
	parts := strings.Split(name, "/")
	var checkedInfo os.FileInfo
	for i := range parts {
		checkedInfo, err = directory.Lstat(strings.Join(parts[:i+1], "/"))
		if err != nil {
			return nil, nil, "", err
		}
		if checkedInfo.Mode()&os.ModeSymlink != 0 {
			return nil, nil, "", refuse
		}
		if i < len(parts)-1 && !checkedInfo.IsDir() {
			return nil, nil, "", refuse
		}
	}
	if !checkedInfo.Mode().IsRegular() || checkedInfo.Size() > fileType.maxSize {
		return nil, nil, "", refuse
	}
	file, err := directory.Open(name)
	if err != nil {
		return nil, nil, "", err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > fileType.maxSize || !os.SameFile(checkedInfo, info) {
		file.Close()
		return nil, nil, "", refuse
	}
	return file, info, fileType.mime, nil
}

func validSiteRootName(name string) bool {
	if name == "" || len(name) > 1024 || name != path.Clean(name) || strings.HasPrefix(name, "/") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || strings.HasPrefix(part, ".") {
			return false
		}
		for _, char := range part {
			if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || strings.ContainsRune("._-", char)) {
				return false
			}
		}
	}
	return true
}

// SiteRootAvailable exposes only readiness to the public bootstrap; no path escapes.
func SiteRootAvailable(storageRoot string) bool {
	file, _, _, err := OpenSiteRootFile(storageRoot, "index.html")
	if err != nil {
		return false
	}
	file.Close()
	return true
}

// SiteRootStatus is returned only by the administrator Home API. Exists means a
// directory entry is present; Ready additionally checks permissions, types and limits.
type SiteRootStatus struct {
	Path        string `json:"path"`
	Exists      bool   `json:"exists"`
	Ready       bool   `json:"ready"`
	StatusError bool   `json:"status_error"`
}

// ReadSiteRootStatus describes the operator's deployment without publishing it.
func ReadSiteRootStatus(storageRoot string) SiteRootStatus {
	status := SiteRootStatus{Path: filepath.Join(storageRoot, "site_root", "index.html")}
	if absolute, err := filepath.Abs(status.Path); err == nil {
		status.Path = absolute
	}
	_, err := os.Lstat(status.Path)
	status.Exists = err == nil
	status.StatusError = err != nil && !os.IsNotExist(err)
	status.Ready = SiteRootAvailable(storageRoot)
	return status
}
