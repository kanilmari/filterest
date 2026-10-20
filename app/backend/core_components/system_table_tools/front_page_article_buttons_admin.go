// front_page_article_buttons_admin.go
// Provides the administrator's independent Home article-list read and save.
// Connects strict requests, canonical actor-owned reads and optimistic revisions.
// Reports unavailable targets privately while public Home silently omits them.
package system_table_tools

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	config "easelect/backend/core_components/system_config_checks"
)

type frontPageArticleButtonsRequest struct {
	ArticleButtons json.RawMessage `json:"article_buttons"`
	Version        string          `json:"version"`
}

type frontPageArticleUnavailable struct {
	Index    int    `json:"index"`
	TableUID int    `json:"table_uid"`
	RowID    string `json:"row_id"`
	Reason   string `json:"reason"`
}

// AdminFrontPageArticleButtonsHandler manages site-wide Home article links.
// GET /api/admin/front-page/article-buttons returns {article_buttons,version,unavailable_items,configuration_error}.
// Missing configuration is {schema_version:1,placement:"below_text",items:[]} with version "none".
// POST accepts {article_buttons:{schema_version:1,placement:"below_text"|"top_row",items:[{table_uid,row_id,enabled,view?}]},version}.
// At most 10 unique targets; row_id is a canonical numeric string.
// Every target must exist and be readable through the saving administrator's article results.
// Success returns {version}; invalid/unreadable targets return 400, stale writes 409.
// Uses the same AdminProfile as Home settings: administrator, route permission, CSRF and request transaction.
func AdminFrontPageArticleButtonsHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID < 1 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "administrator required")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Vary", "Cookie")
	if r.Method == http.MethodGet {
		value, version, err := frontPageArticleButtonsReader(r.Context(), backend.Db)
		if err != nil && version == "" {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "Home article settings unavailable")
			return
		}
		configurationError := ""
		if err != nil {
			configurationError = err.Error()
			value = config.EmptyFrontPageArticleButtons()
		}
		unavailable := []frontPageArticleUnavailable{}
		for index, item := range value.Items {
			if reason := frontPageArticleTargetUnavailable(r, userID, item); reason != "" {
				unavailable = append(unavailable, frontPageArticleUnavailable{index, item.TableUID, item.RowID, reason})
			}
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{
			"article_buttons": value, "version": version, "unavailable_items": unavailable, "configuration_error": configurationError,
		})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	request, err := decodeFrontPageArticleButtonsRequest(r.Body)
	if err == nil {
		err = validateFrontPageArticleTargets(r, userID, request.ArticleButtons)
	}
	version := ""
	if err == nil {
		version, err = saveFrontPageArticleButtons(r.Context(), request.ArticleButtons, request.Version)
	}
	switch {
	case errors.Is(err, errFrontPageConflict):
		httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
	case errors.Is(err, errFrontPageInput):
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
	case err != nil:
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Home article save failed")
	default:
		httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{"version": version})
	}
}

func decodeFrontPageArticleButtonsRequest(body io.Reader) (frontPageArticleButtonsRequest, error) {
	var request frontPageArticleButtonsRequest
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, fmt.Errorf("%w: malformed article buttons request", errFrontPageInput)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF || request.Version == "" || len(request.Version) > 100 {
		return request, fmt.Errorf("%w: supply the current article buttons version", errFrontPageInput)
	}
	if _, err := config.ParseFrontPageArticleButtons(request.ArticleButtons); err != nil {
		return request, fmt.Errorf("%w: %v", errFrontPageInput, err)
	}
	return request, nil
}

func frontPageArticleTargetUnavailable(r *http.Request, userID int, item config.FrontPageArticleItem) string {
	dataset, err := frontPageArticleTargetReader(r, item.TableUID)
	if err != nil {
		return "dataset_missing_or_unavailable"
	}
	if !frontPageCanRead(userID, dataset) || (item.PresentationView() == "image_first_page_view" && !frontPageItemViewAllowed(userID, dataset, item.PresentationView())) {
		return "dataset_unreadable"
	}
	if _, ok := delegateFrontPageArticle(r, dataset, item.RowID, item.PresentationView()); !ok {
		return "row_missing_or_unreadable"
	}
	return ""
}

func validateFrontPageArticleTargets(r *http.Request, userID int, raw []byte) error {
	value, err := config.ParseFrontPageArticleButtons(raw)
	if err != nil {
		return fmt.Errorf("%w: %v", errFrontPageInput, err)
	}
	// Disabled entries still require a real readable target when saved.
	for index, item := range value.Items {
		if reason := frontPageArticleTargetUnavailable(r, userID, item); reason != "" {
			return fmt.Errorf("%w: article button %d: %s", errFrontPageInput, index+1, reason)
		}
	}
	return nil
}
