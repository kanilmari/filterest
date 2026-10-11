// publication_handlers.go
// Lists Publications and saves their scheduling, reader copy and publication state.
// Connects administrator requests to existing release goals and request transactions.
// Rejects stale metadata edits without weakening immutable release contracts.
package workline_observatory

import (
	"database/sql"
	"errors"
	"net/http"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

func listPublications(w http.ResponseWriter, r *http.Request) {
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction_unavailable")
		return
	}
	publications, err := loadPublications(r.Context(), tx)
	if err != nil {
		respondReleaseGoalDatabaseError(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{"publications": publications})
}

func updatePublication(w http.ResponseWriter, r *http.Request, input releaseGoalActionRequest) {
	if input.ExpectedRevision == nil || *input.ExpectedRevision < 0 {
		respondPublicationRefusal(w, http.StatusBadRequest, "publication_revision_required")
		return
	}
	details, err := normalizePublicationDetails(input.publicationDetails)
	if err != nil {
		respondPublicationRefusal(w, http.StatusBadRequest, err.Error())
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction_unavailable")
		return
	}
	var revision int64
	var publishedAt sql.NullTime
	err = tx.QueryRowContext(r.Context(), `
        UPDATE dev_agent_release_goals
        SET publication_version = $3, target_date = $4::date, reader_description = $5,
            published = $6,
            published_at = CASE WHEN $6 THEN COALESCE($7::timestamptz, published_at, now()) END
        WHERE id = $1 AND publication_revision = $2
        RETURNING publication_revision, published_at`, input.ID, *input.ExpectedRevision,
		details.PublicationVersion, details.TargetDate, details.ReaderDescription, details.Published, details.PublishedAt,
	).Scan(&revision, &publishedAt)
	if errors.Is(err, sql.ErrNoRows) {
		var exists bool
		if err := tx.QueryRowContext(r.Context(), "SELECT EXISTS (SELECT 1 FROM dev_agent_release_goals WHERE id = $1)", input.ID).Scan(&exists); err != nil {
			respondReleaseGoalDatabaseError(w, err)
			return
		}
		if !exists {
			httpresponse.RespondWithError(w, http.StatusNotFound, "release_goal_not_found")
		} else {
			respondPublicationRefusal(w, http.StatusConflict, "publication_revision_conflict")
		}
		return
	}
	if err != nil {
		respondReleaseGoalDatabaseError(w, err)
		return
	}
	var timeValue any
	if publishedAt.Valid {
		timeValue = publishedAt.Time
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{
		"id": input.ID, "publication_revision": revision, "published_at": timeValue,
	})
}

// The reason key gives the pipeline translated, actionable publication refusals.
func respondPublicationRefusal(w http.ResponseWriter, status int, key string) {
	httpresponse.RespondWithRefusal(w, &httpresponse.Refusal{Status: status, LangKey: key, Message: key})
}
