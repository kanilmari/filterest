// article_presentations_handler.go
// Serves one administrator-only atomic article-family editing boundary.
// Connects routed authorization and lazy transaction commit to complete GET readback.
// Group and personal targets cannot change dataset-wide blocks or opener policy.
package system_table_tools

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

// ArticlePresentationsHandler reads or saves complete article-family targets.
// GET /api/admin/view-field-settings/article-presentations?dataset=...&targets=site|group:8,group:9
// POST uses the GET shape (dataset, dataset_uid, family, targets, revisions), plus
// complete site-only blocks; members carry ordered UIDs and all three visible/width values.
func ArticlePresentationsHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := authenticatedViewFieldSetUserID(r)
	if err != nil {
		httpresponse.RespondWithError(w, 401, "authentication required")
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, 500, "transaction unavailable")
		return
	}
	admin, err := viewFieldSetUserIsAdmin(tx, int64(actor))
	if err != nil || !admin {
		httpresponse.RespondWithError(w, 403, "administrator required")
		return
	}
	var input articleSnapshot
	if r.Method == http.MethodPost {
		decoder := json.NewDecoder(io.LimitReader(r.Body, 2<<20))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&input); err != nil {
			httpresponse.RespondWithError(w, 400, "invalid complete article request")
			return
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			httpresponse.RespondWithError(w, 400, "one request required")
			return
		}
	} else {
		input.Dataset = r.URL.Query().Get("dataset")
		for _, key := range strings.Split(r.URL.Query().Get("targets"), ",") {
			principal := articlePrincipal{Scope: key}
			if parts := strings.Split(key, ":"); len(parts) == 2 {
				id, _ := strconv.ParseInt(parts[1], 10, 64)
				principal.Scope = parts[0]
				if parts[0] == "group" {
					principal.GroupID = id
				} else {
					principal.UserID = id
				}
			}
			input.Targets = append(input.Targets, articleTarget{articlePrincipal: principal})
		}
	}
	if err = validArticlePrincipals(input.Targets); err != nil {
		httpresponse.RespondWithError(w, 400, err.Error())
		return
	}
	// Personal hosting is deliberately absent. An administrator may only address
	// their own personal target through this contract, never another account's.
	for _, target := range input.Targets {
		if target.Scope == "personal" && target.UserID != int64(actor) {
			httpresponse.RespondWithError(w, 403, "personal target is not owned")
			return
		}
	}
	dataset, _, err := validateViewFieldSetTarget(input.Dataset, "article_view")
	if err != nil {
		httpresponse.RespondWithError(w, 400, "invalid dataset")
		return
	}
	uid, err := lookupArticleSectionDataset(tx, dataset)
	if err != nil {
		respondViewFieldSetLookupError(w, err)
		return
	}
	if r.Method == http.MethodPost && input.DatasetUID != uid {
		httpresponse.RespondWithError(w, 400, "dataset identity mismatch")
		return
	}
	if err = authorizeViewFieldSetDatasetRead(uid, actor); err != nil {
		respondViewFieldSetAuthorizationError(w, err)
		return
	}
	groups := []int64{}
	for _, target := range input.Targets {
		if target.Scope == "group" {
			groups = append(groups, target.GroupID)
		}
	}
	if err = validateViewFieldSetGroupTargets(tx, groups); err != nil {
		httpresponse.RespondWithError(w, 400, err.Error())
		return
	}
	allowed, err := selectableViewFieldSetColumns(actor, dataset)
	if err != nil {
		httpresponse.RespondWithError(w, 500, "field permissions unavailable")
		return
	}
	var result articleSnapshot
	if r.Method != http.MethodPost {
		var locked bool
		err = tx.QueryRow(`SELECT public.app_lock_article_dataset_uid($1)`, uid).Scan(&locked)
		if err == nil {
			result, err = readArticleSnapshot(tx, dataset, uid, actor, input.Targets)
		}
	} else {
		// Check delivery permissions for every presentation, including unchanged cells.
		rows, queryErr := tx.Query(`SELECT column_uid,column_name FROM system_column_details WHERE table_uid=$1`, uid)
		if queryErr != nil {
			httpresponse.RespondWithError(w, 500, "field catalogue unavailable")
			return
		}
		permitted := map[int]bool{}
		for rows.Next() {
			var id int
			var name string
			if queryErr = rows.Scan(&id, &name); queryErr != nil {
				break
			}
			permitted[id] = allowed[name]
		}
		if queryErr == nil {
			queryErr = rows.Err()
		}
		rows.Close()
		if queryErr != nil {
			httpresponse.RespondWithError(w, 500, "field catalogue unavailable")
			return
		}
		for _, target := range input.Targets {
			for _, member := range target.Members {
				for _, cell := range member.Values {
					if cell.Visible && !permitted[member.UID] {
						httpresponse.RespondWithError(w, 403, "article field is not permitted")
						return
					}
				}
			}
		}
		result, err = persistArticlePresentations(tx, input, actor)
	}
	if errors.Is(err, errArticleRevisionConflict) {
		httpresponse.RespondWithJSON(w, 409, map[string]any{"error": "article_revision_conflict", "code": "article_revision_conflict"})
		return
	}
	if err != nil {
		httpresponse.RespondWithError(w, 400, "article presentations could not be saved or read")
		return
	}
	if r.Method == http.MethodPost {
		scheduleViewFieldSetCacheInvalidation(r.Context(), dataset, "article_view")
	}
	httpresponse.RespondWithJSON(w, 200, result)
}
