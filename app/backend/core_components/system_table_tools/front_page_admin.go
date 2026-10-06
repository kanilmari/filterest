// front_page_admin.go
// Provides the administrator's common and account-specific front page API.
// Connects strict request forms, display names and versioned transactional replacement.
// Keeps these validated writes out of generic row mutation routes.
package system_table_tools

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
)

var errFrontPageConflict = errors.New("front page changed; reload before saving")
var errFrontPageInput = errors.New("invalid front page request")

type frontPageBlockInput struct {
	Dataset     string `json:"dataset"`
	ResultLimit int    `json:"result_limit"`
	SortOrder   int    `json:"sort_order"`
	Enabled     bool   `json:"enabled"`
}

type frontPageAdminSettings struct {
	SeparateFrontPage            *bool `json:"separate_front_page"`
	FrontPageButtonShowsSiteName *bool `json:"front_page_button_shows_site_name"`
	FrontPageShowBlocks          *bool `json:"front_page_show_blocks"`
}

type frontPageAdminRequest struct {
	Settings       *frontPageAdminSettings `json:"settings"`
	Hero           *frontPageHero          `json:"hero"`
	UserID         *int                    `json:"user_id"`
	Version        string                  `json:"version"`
	Blocks         *[]frontPageBlockInput  `json:"blocks"`
	Reset          *bool                   `json:"reset"`
	CopyFromCommon *bool                   `json:"copy_from_common"`
}

var frontPageAdminSaver = saveFrontPageAdminRequest

// AdminFrontPageHandler manages front page settings and scope lists.
// GET ?user_id=42 returns settings, hero, background, background_error, scope, saved,
// inherits_common, source, version, blocks and datasets (newest_capable, can_read).
// GET ?user_query=text returns at most 20 {user_id,display_name} accounts.
// POST accepts {settings:{separate_front_page,front_page_button_shows_site_name,front_page_show_blocks}}
// or {hero:{title:{fi,en,usage_explanation},slogan:{fi,en,usage_explanation}}}
// or {user_id,version,blocks:[{dataset,result_limit,sort_order,enabled}]},
// {user_id,version,reset:true}, {user_id,version,copy_from_common:true}.
// Omit user_id or use null for common. Version is opaque, initially "none";
// successful scope writes return {version}, stale writes return 409. Older settings
// clients may omit front_page_show_blocks to preserve it; hero strings allow at most 2000 characters.
func AdminFrontPageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if r.Method == http.MethodGet {
		getAdminFrontPage(w, r)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	request, err := decodeFrontPageAdminRequest(r.Body)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, errFrontPageInput.Error())
		return
	}
	version, err := frontPageAdminSaver(r.Context(), request)
	switch {
	case errors.Is(err, errFrontPageConflict):
		httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
	case errors.Is(err, errFrontPageInput):
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
	case err != nil:
		log.Printf("[AdminFrontPageHandler] save failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "front page save failed")
	default:
		httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{"version": version})
	}
}

func decodeFrontPageAdminRequest(body io.Reader) (frontPageAdminRequest, error) {
	var request frontPageAdminRequest
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return request, errFrontPageInput
	}
	modes := 0
	if request.Settings != nil {
		modes++
	}
	if request.Hero != nil {
		modes++
		if err := validateFrontPageHero(*request.Hero); err != nil {
			return request, err
		}
	}
	if request.Blocks != nil {
		modes++
	}
	if request.Reset != nil {
		modes++
		if !*request.Reset {
			return request, errFrontPageInput
		}
	}
	if request.CopyFromCommon != nil {
		modes++
		if !*request.CopyFromCommon {
			return request, errFrontPageInput
		}
	}
	if modes != 1 || (request.UserID != nil && *request.UserID <= 1) {
		return request, errFrontPageInput
	}
	if request.Settings != nil {
		if request.UserID != nil || request.Version != "" || request.Settings.SeparateFrontPage == nil || request.Settings.FrontPageButtonShowsSiteName == nil {
			return request, errFrontPageInput
		}
	} else if request.Hero != nil {
		if request.UserID != nil || request.Version != "" {
			return request, errFrontPageInput
		}
	} else if request.Version == "" || len(request.Version) > 100 {
		return request, errFrontPageInput
	}
	if request.CopyFromCommon != nil && request.UserID == nil {
		return request, errFrontPageInput
	}
	if request.Blocks != nil {
		if err := validateFrontPageBlockInputs(*request.Blocks); err != nil {
			return request, err
		}
	}
	return request, nil
}

func validateFrontPageBlockInputs(blocks []frontPageBlockInput) error {
	if len(blocks) > 20 {
		return errFrontPageInput
	}
	seenDatasets, seenPositions := map[string]bool{}, map[int]bool{}
	for _, block := range blocks {
		if block.Dataset == "" || len(block.Dataset) > 63 || block.ResultLimit < 1 || block.ResultLimit > 20 ||
			block.SortOrder < 1 || block.SortOrder > 100 || seenDatasets[block.Dataset] || seenPositions[block.SortOrder] {
			return errFrontPageInput
		}
		seenDatasets[block.Dataset], seenPositions[block.SortOrder] = true, true
	}
	return nil
}

func getAdminFrontPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	if r.URL.Query().Has("user_query") {
		if r.URL.Query().Has("user_id") {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "choose user_query or user_id")
			return
		}
		users, err := searchFrontPageUsers(r.URL.Query().Get("user_query"))
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "account search unavailable")
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{"users": users})
		return
	}
	scope := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("user_id")); raw != "" {
		id, err := strconv.Atoi(raw)
		if err != nil || id <= 1 {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid user scope")
			return
		}
		scope = id
	}
	viewer, err := e_sessions.GetUserIDFromSession(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "administrator required")
		return
	}
	displayName := ""
	if scope > 1 {
		displayName, err = backend.UserDisplayName(r.Context(), backend.Db, scope)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusNotFound, "account unavailable")
			return
		}
		viewer = scope
	}
	settings, err := frontPageSettingsReader(r.Context(), backend.Db)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "front page settings unavailable")
		return
	}
	background, backgroundErr := frontPageBackgroundReader(r.Context(), backend.Db)
	hero, err := readFrontPageHeroForAdmin(backend.Db)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "home hero unavailable")
		return
	}
	datasets, err := readFrontPageDatasets(backend.Db, viewer)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "datasets unavailable")
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "request transaction unavailable")
		return
	}
	// Common then account is also the copy operation's lock order.
	if err := lockFrontPageScope(tx, 0, true); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "scope unavailable")
		return
	}
	if scope > 1 {
		if err := lockFrontPageScope(tx, scope, true); err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "scope unavailable")
			return
		}
	}
	blocks, err := readFrontPageBlocks(tx, scope)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "blocks unavailable")
		return
	}
	saved := len(blocks) > 0
	source := "common"
	if scope > 1 {
		source = "user"
	}
	if !saved {
		if scope > 1 {
			blocks, source, err = resolveFrontPageBlocks(tx, viewer)
		} else {
			blocks, err = defaultFrontPageBlocks(tx, viewer)
			source = "default"
		}
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "default blocks unavailable")
			return
		}
	}
	for index := range blocks {
		blocks[index].CanRead = frontPageCanRead(viewer, blocks[index].Dataset)
	}
	version, err := frontPageScopeVersion(tx, scope)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "scope version unavailable")
		return
	}
	var userID any
	if scope > 1 {
		userID = scope
	}
	backgroundError := ""
	if backgroundErr != nil {
		backgroundError = "invalid front_page_background"
		log.Printf("[AdminFrontPageHandler] %v", backgroundErr)
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{"settings": settings, "hero": hero, "background": background,
		"background_error": backgroundError, "scope": map[string]any{"user_id": userID, "display_name": displayName},
		"saved": saved, "inherits_common": scope > 1 && !saved, "source": source, "version": version,
		"blocks": blocks, "datasets": datasets})
}
