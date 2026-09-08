// storage.go
// Copies an explicitly selected legacy image into an independent protected asset folder.
// Between authorized source rows, transaction rollback hooks, and the local storage root.
// Exists to preserve original files and retain an inspectable journal if a process stops mid-copy.
package media_library

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
)

const maxImageBytes int64 = 50 << 20

// legacyLocation refuses external URLs and references belonging to a different
// parent. Filenames come only from the authorized source row, never HTTP input.
func legacyLocation(rel relation, src source) (string, string, error) {
	raw := strings.TrimPrefix(src.Reference, "/storage/")
	if strings.ContainsAny(raw, "\\?#") || raw != path.Clean(raw) || strings.HasPrefix(raw, "/") {
		return "", "", ErrUnsupported
	}
	parts := strings.Split(raw, "/")
	filename := parts[len(parts)-1]
	ext := strings.ToLower(path.Ext(filename))
	if !supportedExtension(ext) {
		return "", "", ErrUnsupported
	}
	tableID := strconv.FormatInt(rel.ParentUID, 10)
	rowID := strconv.FormatInt(src.ParentID, 10)
	if len(parts) == 4 {
		if parts[0] != tableID || parts[1] != rowID {
			return "", "", ErrUnsupported
		}
		switch parts[2] {
		case "original", "300", "1000", "2160":
		default:
			return "", "", ErrUnsupported
		}
	} else if len(parts) != 1 || !strings.HasPrefix(filename, tableID+"_"+rowID+"_") {
		return "", "", ErrUnsupported
	}
	return tableID + "/" + rowID, filename, nil
}
func containedFile(root, relative string) (*os.File, error) {
	if relative != path.Clean(relative) || path.IsAbs(relative) {
		return nil, ErrDenied
	}
	fd, err := unix.Open(root, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(relative, "/")
	for i, p := range parts {
		if p == "" || p == "." || p == ".." {
			unix.Close(fd)
			return nil, ErrDenied
		}
		flags := unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW | unix.O_NONBLOCK
		if i < len(parts)-1 {
			flags |= unix.O_DIRECTORY
		}
		next, e := unix.Openat(fd, p, flags, 0)
		unix.Close(fd)
		if e != nil {
			return nil, e
		}
		fd = next
	}
	return os.NewFile(uintptr(fd), filepath.Join(root, relative)), nil
}

type copiedAsset struct {
	Asset   asset
	Hash    string
	Cleanup func()
}

// copyAsset leaves every original intact. Its random new folder is never shared
// before DB commit; cleanup removes only files created by this invocation.
func copyAsset(root string, rel relation, src source, id string) (copiedAsset, error) {
	base, filename, err := legacyLocation(rel, src)
	if err != nil {
		return copiedAsset{}, err
	}
	a := asset{ID: id, Filename: "image" + strings.ToLower(path.Ext(filename)), RelationID: rel.ID, SourceID: src.ID}
	result := copiedAsset{Asset: a}
	mediaDir := filepath.Join(root, "media")
	if err = os.Mkdir(mediaDir, 0750); err != nil && !os.IsExist(err) {
		return result, err
	}
	info, err := os.Lstat(mediaDir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return result, ErrDenied
	}
	dir := filepath.Join(mediaDir, id)
	if err = os.Mkdir(dir, 0750); err != nil {
		return result, err
	}
	made := []string{dir}
	result.Cleanup = func() {
		for i := len(made) - 1; i >= 0; i-- {
			_ = os.Remove(made[i])
		}
	}
	success := false
	defer func() {
		if !success {
			result.Cleanup()
		}
	}()
	journal := filepath.Join(dir, "copy.json")
	j, _ := json.Marshal(map[string]interface{}{"asset_id": id, "relation_id": rel.ID, "source_row_id": src.ID, "state": "copied-awaiting-database-reference", "original_preserved": true})
	if err = os.WriteFile(journal, j, 0600); err != nil {
		return result, err
	}
	made = append(made, journal)
	for _, variant := range []string{"original", "300", "1000", "2160"} {
		in, e := containedFile(root, base+"/"+variant+"/"+filename)
		if e != nil {
			if variant != "original" && os.IsNotExist(e) {
				continue
			}
			return result, e
		}
		stat, e := in.Stat()
		if e != nil || !stat.Mode().IsRegular() || stat.Size() <= 0 || stat.Size() > maxImageBytes {
			in.Close()
			return result, ErrUnsupported
		}
		variantDir := filepath.Join(dir, variant)
		if e = os.Mkdir(variantDir, 0750); e != nil {
			in.Close()
			return result, e
		}
		made = append(made, variantDir)
		target := filepath.Join(variantDir, a.Filename)
		out, e := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0640)
		if e != nil {
			in.Close()
			return result, e
		}
		made = append(made, target)
		h := sha256.New()
		n, e := io.Copy(io.MultiWriter(out, h), io.LimitReader(in, maxImageBytes+1))
		syncErr := out.Sync()
		out.Close()
		in.Close()
		if e != nil || syncErr != nil || n > maxImageBytes || n != stat.Size() {
			return result, fmt.Errorf("image copy failed")
		}
		if variant == "original" {
			result.Hash = hex.EncodeToString(h.Sum(nil))
		}
	}
	success = true
	return result, nil
}
