// front_page_box_diagnostics.go
// Reports repairable saved-box omissions only in the administrator Home settings read.
// Connects common-scope guest previews or account previews to the canonical results boundary.
// Uses a fresh session and actor transaction so administrator rights cannot widen the preview.
package system_table_tools

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth"
	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"
)

type frontPageBoxDiagnostic struct {
	BoxID     int64  `json:"box_id"`
	ReasonKey string `json:"reason_key"`
}

func frontPageAdminDiagnostics(original *http.Request, blocks []frontPageBlock, scope int) []frontPageBoxDiagnostic {
	diagnostics := []frontPageBoxDiagnostic{}
	viewer, role := scope, "guest"
	var err error
	if viewer == 0 {
		viewer = 1
	} else {
		role, err = backend.ResolveUserRole(viewer)
	}
	if err != nil {
		return frontPageUnavailableDiagnostics(blocks)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	stop := context.AfterFunc(original.Context(), cancel)
	defer stop()
	actor := dbutils.NewRequestActorContext(viewer, role)
	lazy := dbutils.NewLazyTxWithBeginHook(auth.GetDBForRole(role), func(tx *sql.Tx) error {
		return dbutils.ApplyRequestActorToTx(tx, actor)
	})
	defer lazy.Rollback()
	ctx = dbutils.SetLazyTx(dbutils.SetRequestActorContext(ctx, actor), lazy)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://home.internal/api/front-page?lang="+url.QueryEscape(original.URL.Query().Get("lang")), nil)
	if err != nil {
		return frontPageUnavailableDiagnostics(blocks)
	}
	// A new request has its own Gorilla registry. Never mutate the admin session,
	// reuse its transaction, persist a preview session or send a preview cookie.
	session, err := e_sessions.GetOrCreateSession(nil, request)
	if err != nil {
		return frontPageUnavailableDiagnostics(blocks)
	}
	session.Values["user_id"], session.Values["user_role"] = viewer, role
	for index, block := range blocks {
		if index == 20 {
			break
		}
		if block.ID == 0 || !block.Enabled {
			continue
		}
		reason := "front_page_blocks_invalid"
		if ctx.Err() == nil && frontPageCanRead(viewer, block.Dataset) {
			_, reason = delegateFrontPageBox(request, block)
		}
		if reason != "" {
			diagnostics = append(diagnostics, frontPageBoxDiagnostic{BoxID: block.ID, ReasonKey: reason})
		}
	}
	return diagnostics
}

// A failed preview cannot claim the stored boxes have no repair diagnostics.
func frontPageUnavailableDiagnostics(blocks []frontPageBlock) []frontPageBoxDiagnostic {
	diagnostics := []frontPageBoxDiagnostic{}
	for index, block := range blocks {
		if index == 20 {
			break
		}
		if block.ID > 0 && block.Enabled {
			diagnostics = append(diagnostics, frontPageBoxDiagnostic{BoxID: block.ID, ReasonKey: "front_page_blocks_invalid"})
		}
	}
	return diagnostics
}
