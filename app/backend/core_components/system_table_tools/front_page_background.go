// front_page_background.go
// Uploads, positions and removes the site's one front page background.
// Connects the shared presentation saver with request commit and rollback hooks.
// Removes replaced files only after commit, never while another request still uses them.
package system_table_tools

import (
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

const frontPageBackgroundRoot = "site_media/front_page"
const frontPageBackgroundMaxBytes int64 = 10 << 20

// Video follows the media library ceiling; images retain their existing limit.
const frontPageVideoMaxBytes int64 = 50 << 20

func isAllowedFrontPageMediaExtension(ext string) bool {
	return ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp" || ext == ".mp4" || ext == ".webm"
}

// FrontPageBackgroundHandler saves or removes the front page background.
// POST /api/admin/front-page/background accepts multipart file "background_image"
// and optional focal_x/focal_y in [0,1] (default 0.5). With an existing image,
// omitting the file updates its focal point. PNG/JPEG/WebP: 10 MiB; MP4/WebM: 50 MiB.
// The body allows 1 MiB of multipart overhead. Videos have no resized variants.
// DELETE removes it. Returns {background}, null when removed.
func FrontPageBackgroundHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		w.Header().Set("Allow", "POST, DELETE")
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if r.Method == http.MethodPost {
		r.Body = http.MaxBytesReader(w, r.Body, frontPageVideoMaxBytes+(1<<20))
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid background upload")
			return
		}
		defer r.MultipartForm.RemoveAll()
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "request transaction unavailable")
		return
	}
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended('front_page_background',0))`); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "background unavailable")
		return
	}
	old, oldErr := frontPageBackgroundReader(r.Context(), backend.Db)
	// A malformed value is shown by GET; replacement/removal can repair it, while
	// cleanup refuses its untrusted path. No file outside this root is ever removed.
	if oldErr != nil {
		log.Printf("[FrontPageBackgroundHandler] replacing invalid configuration: %v", oldErr)
	}
	var background *backend.FrontPageBackground
	storageDir := resolveStorageDir()
	if r.Method == http.MethodPost {
		x, y := 0.5, 0.5
		if old != nil {
			x, y = old.FocalX, old.FocalY
		}
		var err error
		if raw := r.FormValue("focal_x"); raw != "" {
			x, err = strconv.ParseFloat(raw, 64)
		}
		if err == nil {
			if raw := r.FormValue("focal_y"); raw != "" {
				y, err = strconv.ParseFloat(raw, 64)
			}
		}
		if err != nil || !validFrontPageFocalPoint(x, y) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid focal point")
			return
		}
		files := r.MultipartForm.File["background_image"]
		if len(files) > 1 || (len(files) == 0 && old == nil) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "one background image required")
			return
		}
		if len(files) == 1 {
			limit := frontPageBackgroundMaxBytes
			if ext := strings.ToLower(filepath.Ext(files[0].Filename)); ext == ".mp4" || ext == ".webm" {
				limit = frontPageVideoMaxBytes
			}
			saved, err := savePresentationMediaFile(storageDir, frontPageBackgroundRoot, files[0], isAllowedFrontPageMediaExtension,
				limit, func(filename, ext string) error {
					if ext == ".mp4" || ext == ".webm" {
						return nil
					}
					return createPresentationMediaDisplayVariants(storageDir, frontPageBackgroundRoot, filename, ext, []int{1000, 2160}, true)
				})
			if err != nil {
				httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid background image")
				return
			}
			cleanup := func() {
				removePresentationMediaFiles(storageDir, frontPageBackgroundRoot, filepath.Base(saved.StorageKey))
			}
			if !dbutils.RegisterAfterRollbackHook(r.Context(), cleanup) {
				cleanup()
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "rollback hook unavailable")
				return
			}
			background = &backend.FrontPageBackground{StorageKey: saved.StorageKey, OriginalName: saved.OriginalName, MIMEType: saved.MIMEType, FocalX: x, FocalY: y}
		} else {
			copy := *old
			copy.FocalX, copy.FocalY = x, y
			background = &copy
		}
	}
	raw, err := json.Marshal(background)
	if err == nil {
		_, err = tx.Exec(`INSERT INTO public.system_config(key,json_value,value_type,creation_spec)
            VALUES ('front_page_background',$1::jsonb,5,'Front page background; written only by its administrator API.')
            ON CONFLICT(key) DO UPDATE SET json_value=EXCLUDED.json_value,value_type=5,updated=now()`, string(raw))
	}
	if err != nil {
		log.Printf("[FrontPageBackgroundHandler] save failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "background save failed")
		return
	}
	if old != nil && (background == nil || old.StorageKey != background.StorageKey) {
		if !dbutils.RegisterAfterCommitHook(r.Context(), func() {
			removePresentationMediaFiles(storageDir, frontPageBackgroundRoot, filepath.Base(old.StorageKey))
		}) {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "commit hook unavailable")
			return
		}
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{"background": background})
}

func validFrontPageFocalPoint(x, y float64) bool {
	background := backend.FrontPageBackground{StorageKey: "site_media/front_page/original/check.png", MIMEType: "image/png", FocalX: x, FocalY: y}
	return backend.ValidateFrontPageBackground(background) == nil
}
