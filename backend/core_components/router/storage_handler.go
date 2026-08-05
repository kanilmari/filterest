// storage_handler.go
// Serves public and row-scoped files from the local storage root.
// Bridges filesystem delivery with session, dataset, row, field, and asset-relation authorization.
// Exists so protected media keeps HTTP range behavior without becoming a static authorization bypass.
package router

import (
	"fmt"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	filevalidation "easelect/backend/core_components/filevalidation"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/middlewares"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/google/uuid"
	"github.com/gorilla/sessions"
	"golang.org/x/sys/unix"
)

var publicStorageRootFiles = map[string]struct{}{
	"project_logo.png":  {},
	"project_logo.jpg":  {},
	"project_logo.jpeg": {},
	"project_logo.webp": {},
	"project_logo.svg":  {},
	"project_logo.gif":  {},
}

var protectedStorageVariants = map[string]struct{}{
	"300":      {},
	"1000":     {},
	"2160":     {},
	"original": {},
}

var storageAuthorizeRead = dtt_1_row_read.AuthorizeStorageRead
var storageCheckLoginToBrowse = middlewares.CheckLoginToBrowse

type storageAuthorizationDecision uint8

const (
	storageAuthorizationNotFound storageAuthorizationDecision = iota
	storageAuthorizationAllowed
	storageAuthorizationForbidden
	storageAuthorizationInternalError
)

func isPublicStoragePath(cleanRel string) bool {
	normalized := filepath.ToSlash(cleanRel)
	if _, ok := publicStorageRootFiles[normalized]; ok {
		return true
	}
	return strings.HasPrefix(normalized, "service_catalog_logos/")
}

func parseProtectedStoragePath(cleanRel string) (dtt_1_row_read.StorageReadRequest, bool) {
	normalized := filepath.ToSlash(cleanRel)
	if strings.Contains(normalized, `\`) {
		return dtt_1_row_read.StorageReadRequest{}, false
	}
	parts := strings.Split(normalized, "/")
	if len(parts) != 4 || !canonicalStorageID(parts[0]) || !canonicalStorageID(parts[1]) {
		return dtt_1_row_read.StorageReadRequest{}, false
	}
	if _, ok := protectedStorageVariants[parts[2]]; !ok {
		return dtt_1_row_read.StorageReadRequest{}, false
	}
	filename := parts[3]
	if filename == "" || filename != strings.TrimSpace(filename) || filename == "." || filename == ".." || filepath.Base(filename) != filename {
		return dtt_1_row_read.StorageReadRequest{}, false
	}

	parentRowID, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || parentRowID <= 0 {
		return dtt_1_row_read.StorageReadRequest{}, false
	}
	return dtt_1_row_read.StorageReadRequest{
		TableUID:    parts[0],
		ParentRowID: parentRowID,
		Variant:     parts[2],
		Filename:    filename,
	}, true
}

func canonicalStorageID(value string) bool {
	parsed, err := strconv.ParseInt(value, 10, 64)
	return err == nil && parsed > 0 && strconv.FormatInt(parsed, 10) == value
}

func storageRequestActor(w http.ResponseWriter, r *http.Request) (dbutils.RequestActorContext, storageAuthorizationDecision) {
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		log.Printf("\033[31m[ServeStorage] session lookup failed: %v\033[0m", err)
		return dbutils.RequestActorContext{}, storageAuthorizationInternalError
	}
	if userID, ok := session.Values["user_id"].(int); ok && userID > 1 {
		return storageActorFromSession(session, userID), storageAuthorizationAllowed
	}

	loginToBrowse, err := storageCheckLoginToBrowse()
	if err != nil {
		log.Printf("\033[31m[ServeStorage] login_to_browse fetch failed: %v\033[0m", err)
		return dbutils.RequestActorContext{}, storageAuthorizationInternalError
	}
	if loginToBrowse {
		return dbutils.RequestActorContext{}, storageAuthorizationForbidden
	}

	ensureStorageGuestSession(w, r, session)
	userID, ok := session.Values["user_id"].(int)
	if !ok || userID <= 0 {
		return dbutils.RequestActorContext{}, storageAuthorizationInternalError
	}
	return storageActorFromSession(session, userID), storageAuthorizationAllowed
}

func storageActorFromSession(session *sessions.Session, userID int) dbutils.RequestActorContext {
	if userID == 1 {
		return dbutils.NewRequestActorContext(userID, "guest")
	}
	userRole, _ := session.Values["user_role"].(string)
	return dbutils.NewRequestActorContext(userID, userRole)
}

func ensureStorageGuestSession(w http.ResponseWriter, r *http.Request, session *sessions.Session) {
	changed := false
	if _, hasUserID := session.Values["user_id"].(int); !hasUserID {
		session.Values["user_id"] = 1
		changed = true
	}

	deviceID := ""
	if sessDeviceID, ok := session.Values["device_id"].(string); ok && sessDeviceID != "" {
		deviceID = sessDeviceID
	}
	if cookieDevice, err := r.Cookie("device_id"); err == nil && cookieDevice.Value != "" {
		deviceID = cookieDevice.Value
	}
	if deviceID == "" {
		deviceID = uuid.NewString()
	}
	if sessDeviceID, _ := session.Values["device_id"].(string); sessDeviceID != deviceID {
		session.Values["device_id"] = deviceID
		changed = true
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "device_id",
		Value:    deviceID,
		Path:     "/",
		HttpOnly: false,
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		Secure:   e_sessions.ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode,
	})

	fingerprint := ""
	if sessFP, ok := session.Values["fingerprint_hash"].(string); ok && sessFP != "" {
		fingerprint = sessFP
	}
	if cookieFP, err := r.Cookie("fingerprint"); err == nil && cookieFP.Value != "" {
		fingerprint = cookieFP.Value
	}
	if fingerprint == "" {
		fingerprint = uuid.NewString()
	}
	if sessFP, _ := session.Values["fingerprint_hash"].(string); sessFP != fingerprint {
		session.Values["fingerprint_hash"] = fingerprint
		changed = true
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "fingerprint",
		Value:    fingerprint,
		Path:     "/",
		HttpOnly: false,
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		Secure:   e_sessions.ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode,
	})

	if changed {
		if err := session.Save(r, w); err != nil {
			log.Printf("\033[31m[ServeStorage] guest session save failed: %v\033[0m", err)
		}
	}
}

func authorizeStorageRequest(w http.ResponseWriter, r *http.Request, cleanRel string) storageAuthorizationDecision {
	if isPublicStoragePath(cleanRel) {
		return storageAuthorizationAllowed
	}

	storageRequest, ok := parseProtectedStoragePath(cleanRel)
	if !ok {
		return storageAuthorizationNotFound
	}
	actor, actorDecision := storageRequestActor(w, r)
	if actorDecision != storageAuthorizationAllowed {
		return actorDecision
	}
	roleDB := backend.GetRequestDBForRole(actor.UserRole)
	if backend.Db == nil || roleDB == nil {
		log.Printf("\033[31m[ServeStorage] authorization database unavailable for user_id=%d\033[0m", actor.UserID)
		return storageAuthorizationInternalError
	}

	decision, err := storageAuthorizeRead(
		r.Context(),
		backend.Db,
		roleDB,
		actor,
		storageRequest,
	)
	if err != nil {
		log.Printf(
			"\033[31m[ServeStorage] authorization failed for table_uid=%s row_id=%d user_id=%d: %v\033[0m",
			storageRequest.TableUID,
			storageRequest.ParentRowID,
			actor.UserID,
			err,
		)
		return storageAuthorizationInternalError
	}
	switch decision {
	case dtt_1_row_read.StorageReadAllowed:
		return storageAuthorizationAllowed
	case dtt_1_row_read.StorageReadForbidden:
		return storageAuthorizationForbidden
	default:
		return storageAuthorizationNotFound
	}
}

func respondToStorageAuthorization(w http.ResponseWriter, decision storageAuthorizationDecision) {
	if decision == storageAuthorizationAllowed {
		return
	}
	// Every protected authorization failure is deliberately indistinguishable
	// from a missing file. Detailed causes are logged before this boundary.
	httpresponse.RespondWithError(w, http.StatusNotFound, "file not found")
}

func setProtectedStorageHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Vary", "Cookie")
}

func setStorageDownloadHeaders(w http.ResponseWriter, cleanRel string) {
	extension := filepath.Ext(cleanRel)
	protectedSVG := strings.EqualFold(extension, ".svg") && !isPublicStoragePath(cleanRel)
	if filevalidation.IsInlineSafeImageExtension(extension) && !protectedSVG {
		return
	}
	disposition := mime.FormatMediaType("attachment", map[string]string{
		"filename": filepath.Base(cleanRel),
	})
	w.Header().Set("Content-Disposition", disposition)
}

// openContainedStorageFile walks every path component relative to an open
// storage-root descriptor. O_NOFOLLOW on every openat call prevents both final
// and intermediate symlink swaps from escaping the root between validation and
// use.
func openContainedStorageFile(storageRoot, cleanRel string) (*os.File, error) {
	resolvedRoot, err := filepath.EvalSymlinks(storageRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve storage root: %w", err)
	}
	resolvedRoot, err = filepath.Abs(resolvedRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve absolute storage root: %w", err)
	}

	if cleanRel == "" || cleanRel != filepath.Clean(cleanRel) || filepath.IsAbs(cleanRel) {
		return nil, fmt.Errorf("invalid relative storage path")
	}
	components := strings.Split(cleanRel, string(filepath.Separator))
	for _, component := range components {
		if component == "" || component == "." || component == ".." {
			return nil, fmt.Errorf("invalid storage path component")
		}
	}

	currentFD, err := unix.Open(
		resolvedRoot,
		unix.O_RDONLY|unix.O_CLOEXEC|unix.O_DIRECTORY|unix.O_NOFOLLOW,
		0,
	)
	if err != nil {
		return nil, fmt.Errorf("open storage root without following links: %w", err)
	}

	for index, component := range components {
		flags := unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW | unix.O_NONBLOCK
		if index < len(components)-1 {
			flags |= unix.O_DIRECTORY
		}
		nextFD, openErr := unix.Openat(currentFD, component, flags, 0)
		_ = unix.Close(currentFD)
		if openErr != nil {
			return nil, fmt.Errorf("open storage path component %q without following links: %w", component, openErr)
		}
		currentFD = nextFD
	}

	targetName := filepath.Join(resolvedRoot, cleanRel)
	storageFile := os.NewFile(uintptr(currentFD), targetName)
	if storageFile == nil {
		_ = unix.Close(currentFD)
		return nil, fmt.Errorf("open contained storage target: invalid file descriptor")
	}
	return storageFile, nil
}

// ServeStorage serves public allowlisted files and database-authorized row assets.
func ServeStorage(w http.ResponseWriter, r *http.Request) {
	relativePath := strings.TrimPrefix(r.URL.Path, "/storage/")
	if relativePath == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "filename missing")
		return
	}

	cleanRel := filepath.Clean(relativePath)
	if strings.HasPrefix(cleanRel, "..") || filepath.IsAbs(cleanRel) {
		log.Printf("ServeStorage: rejecting path (invalid): %s", relativePath)
		httpresponse.RespondWithError(w, http.StatusForbidden, "403 - Forbidden")
		return
	}

	if !isPublicStoragePath(cleanRel) {
		setProtectedStorageHeaders(w)
	}
	if decision := authorizeStorageRequest(w, r, cleanRel); decision != storageAuthorizationAllowed {
		respondToStorageAuthorization(w, decision)
		return
	}

	storageFile, err := openContainedStorageFile(localStorageDir, cleanRel)
	if err != nil {
		log.Printf("ServeStorage: contained open failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusNotFound, "file not found")
		return
	}
	defer storageFile.Close()

	info, err := storageFile.Stat()
	if err != nil {
		log.Printf("ServeStorage: opened-file stat failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "500 - Internal Server Error")
		return
	}
	if !info.Mode().IsRegular() {
		httpresponse.RespondWithError(w, http.StatusNotFound, "file not found")
		return
	}

	setStorageDownloadHeaders(w, cleanRel)
	http.ServeContent(w, r, filepath.Base(cleanRel), info.ModTime(), storageFile)
}
