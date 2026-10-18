// user_filterbar_preference_handler.go
// Reads and patches account-owned filterbar choices in the existing visual preferences.
// Connects the authenticated session to site policy and one site-wide personal order.
// Keeps copying explicit, rejects dataset/user selectors and preserves theme preferences.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

type userFilterbarPreference struct {
	UserID           int      `json:"user_id"`
	OrderMode        string   `json:"order_mode"`
	SectionOrder     []string `json:"section_order,omitempty"`
	VisibilityMemory string   `json:"visibility_memory"`
	OwnOrderAllowed  bool     `json:"own_order_allowed"`
}

type userFilterbarPreferencePatch struct {
	OrderMode        *string  `json:"order_mode,omitempty"`
	SectionOrder     []string `json:"section_order,omitempty"`
	VisibilityMemory *string  `json:"visibility_memory,omitempty"`
}

func validUserFilterbarPreferencePatch(req userFilterbarPreferencePatch) bool {
	return (req.OrderMode == nil || *req.OrderMode == "shared" || *req.OrderMode == "own") &&
		(req.VisibilityMemory == nil || *req.VisibilityMemory == "shared" || *req.VisibilityMemory == "dataset") &&
		(req.SectionOrder == nil || validFilterbarOrder(req.SectionOrder))
}

// UserFilterbarPreferenceHandler always takes ownership from the session. The
// login-only profile keeps CSRF/device checks; the handler enforces site policy.
func UserFilterbarPreferenceHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	userID, err := authenticatedViewFieldSetUserID(r)
	if err != nil {
		httpresponse.RespondWithError(w, 401, "authenticated user required")
		return
	}
	var patch userFilterbarPreferencePatch
	if r.Method == http.MethodPatch {
		if err := decodeFilterbarRequest(w, r, &patch); err != nil || !validUserFilterbarPreferencePatch(patch) {
			httpresponse.RespondWithError(w, 400, "invalid filterbar preference")
			return
		}
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, 500, "transaction unavailable")
		return
	}
	q := dbutils.BindQueryContext(r.Context(), tx)

	layout, err := readFilterbarLayoutFrom(q)
	if err != nil {
		httpresponse.RespondWithError(w, 500, "layout unavailable")
		return
	}
	var admin bool
	err = q.QueryRow(`SELECT COALESCE(admin_access_allowed,false) FROM public.system_users WHERE id=$1`, userID).Scan(&admin)
	if err != nil {
		httpresponse.RespondWithError(w, 500, "account unavailable")
		return
	}
	if r.Method == http.MethodDelete {
		// Reset only this feature; a theme preference in the same row survives.
		_, err := q.Exec(`UPDATE public.system_user_visual_preferences SET filterbar_order_mode='shared',
            filterbar_section_order=NULL, filterbar_visibility_memory='shared', revision=revision+1 WHERE user_id=$1`, userID)
		if err != nil {
			httpresponse.RespondWithError(w, 500, "preference reset failed")
			return
		}
		_, err = q.Exec(`DELETE FROM public.system_user_visual_preferences WHERE user_id=$1 AND theme_mode IS NULL
            AND filterbar_order_mode='shared' AND filterbar_section_order IS NULL AND filterbar_visibility_memory='shared'`, userID)
		if err != nil {
			httpresponse.RespondWithError(w, 500, "preference reset failed")
			return
		}
		httpresponse.RespondWithJSON(w, 200, userFilterbarPreference{UserID: userID, OrderMode: "shared", VisibilityMemory: "shared", OwnOrderAllowed: admin || layout.AllowOwnOrder})
		return
	}
	preference := userFilterbarPreference{UserID: userID, OrderMode: "shared", VisibilityMemory: "shared", OwnOrderAllowed: admin || layout.AllowOwnOrder}
	// Lock even an absent preference row; theme writes can still update their
	// own columns without overwriting these choices.
	if r.Method == http.MethodPatch {
		if _, err := q.Exec(`SELECT pg_advisory_xact_lock(770078, $1)`, userID); err != nil {
			httpresponse.RespondWithError(w, 500, "preference lock failed")
			return
		}
	}
	var raw []byte
	err = q.QueryRow(`SELECT filterbar_order_mode, filterbar_section_order, filterbar_visibility_memory
        FROM public.system_user_visual_preferences WHERE user_id=$1`, userID).Scan(&preference.OrderMode, &raw, &preference.VisibilityMemory)
	if err != nil && err != sql.ErrNoRows {
		httpresponse.RespondWithError(w, 500, "preference unavailable")
		return
	}
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &preference.SectionOrder); err != nil {
			httpresponse.RespondWithError(w, 500, "preference unavailable")
			return
		}
		preference.SectionOrder = normalizeFilterbarSectionOrder(preference.SectionOrder)
	}
	if r.Method == http.MethodPatch {
		if !preference.OwnOrderAllowed && ((patch.OrderMode != nil && *patch.OrderMode == "own") || patch.SectionOrder != nil) {
			httpresponse.RespondWithError(w, 403, "own order is disabled by site policy")
			return
		}
		if patch.OrderMode != nil {
			// Only this explicit shared -> own choice copies the current site order.
			if *patch.OrderMode == "own" && preference.OrderMode != "own" {
				preference.SectionOrder = layout.SectionOrder
			}
			preference.OrderMode = *patch.OrderMode
		}
		if patch.SectionOrder != nil {
			if preference.OrderMode != "own" {
				httpresponse.RespondWithError(w, 400, "choose own order first")
				return
			}
			preference.SectionOrder = normalizeFilterbarSectionOrder(patch.SectionOrder)
		}
		if patch.VisibilityMemory != nil {
			preference.VisibilityMemory = *patch.VisibilityMemory
		}
		orderJSON, _ := json.Marshal(preference.SectionOrder)
		_, err = q.Exec(`INSERT INTO public.system_user_visual_preferences
            (user_id, filterbar_order_mode, filterbar_section_order, filterbar_visibility_memory)
            VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT (user_id) DO UPDATE SET
            filterbar_order_mode=EXCLUDED.filterbar_order_mode, filterbar_section_order=EXCLUDED.filterbar_section_order,
            filterbar_visibility_memory=EXCLUDED.filterbar_visibility_memory, revision=system_user_visual_preferences.revision+1`,
			userID, preference.OrderMode, string(orderJSON), preference.VisibilityMemory)
		if err != nil {
			httpresponse.RespondWithError(w, 500, "preference save failed")
			return
		}
	}
	if !preference.OwnOrderAllowed {
		preference.OrderMode = "shared"
		preference.SectionOrder = nil
	}
	httpresponse.RespondWithJSON(w, 200, preference)
}
