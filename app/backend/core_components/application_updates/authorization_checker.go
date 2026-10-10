// authorization_checker.go
// Rechecks current administrator state, explicit grants, session revocation and expiry.
// Connects browser admission and future worker pickup to current account authority.
// A durable queue entry records intent; it never preserves a revoked authorization.
package application_updates

import (
	"context"
	"database/sql"
	"easelect/backend/core_components/sign_in_revocation"
	"easelect/backend/core_components/update_capability"
	"encoding/json"
	"net/http"
	"time"
)

// RecheckAuthorization runs under the runtime-grant barrier before admission or pickup.
func RecheckAuthorization(ctx context.Context, tx *sql.Tx, actor Authorization) error {
	if actor.ActorID <= 1 || actor.Generation < 1 || actor.SignInID == "" {
		return refuse("authorization_revoked", http.StatusForbidden)
	}
	var enabled, admin bool
	var generation int64
	err := tx.QueryRowContext(ctx, `SELECT u.enabled IS TRUE, COALESCE(u.admin_access_allowed,FALSE) AND EXISTS(SELECT 1 FROM public.system_user_group_memberships WHERE user_id=u.id AND group_id=1), c.authentication_generation
		FROM public.system_users u JOIN restricted.users_restricted c ON c.id=u.id WHERE u.id=$1 FOR SHARE OF u,c`, actor.ActorID).Scan(&enabled, &admin, &generation)
	if err == sql.ErrNoRows {
		return refuse("authorization_revoked", http.StatusForbidden)
	}
	if err != nil {
		return err
	}
	if !enabled || !admin || generation != actor.Generation {
		return refuse("authorization_revoked", http.StatusForbidden)
	}
	usable, err := sign_in_revocation.StillUsable(ctx, tx, actor.SignInID, actor.SignInExpiresAt)
	if err != nil {
		return err
	}
	if !usable {
		return refuse("authorization_revoked", http.StatusForbidden)
	}
	granted, err := update_capability.Granted(ctx, tx, actor.ActorID)
	if err != nil {
		return err
	}
	if !granted {
		return refuse("authorization_revoked", http.StatusForbidden)
	}
	return nil
}

// RecheckQueuedRequest validates durable intent without claiming or executing it.
// The worker must still journal consumption outside the restored database in S4.
func RecheckQueuedRequest(ctx context.Context, tx *sql.Tx, id string, now time.Time) (Job, error) {
	job, err := loadJob(ctx, tx, id)
	if err != nil {
		return job, err
	}
	if job.Phase != "queued" || !fresh(job.ExpiresAt, now) {
		return job, refuse("queue_expired", http.StatusConflict)
	}
	var raw []byte
	if err = tx.QueryRowContext(ctx, `SELECT authorization_context FROM restricted.system_application_update_jobs WHERE id=$1`, id).Scan(&raw); err != nil {
		return job, err
	}
	var actor Authorization
	if err = json.Unmarshal(raw, &actor); err != nil {
		return job, err
	}
	if err = RecheckAuthorization(ctx, tx, actor); err != nil {
		return job, err
	}
	state, err := loadControl(ctx, tx)
	if err != nil {
		return job, err
	}
	if !state.available {
		return job, refuse("executor_unavailable", http.StatusServiceUnavailable)
	}
	if state.offer == nil || state.offer.ID != job.Offer.ID || *state.offer != job.Offer {
		return job, refuse("offer_conflict", http.StatusConflict)
	}
	return job, validateOffer(job.Offer, state.installationID, now)
}

// RecheckQueuedDecision checks receipt freshness, revocation and exact current cutover.
func RecheckQueuedDecision(ctx context.Context, tx *sql.Tx, id string, now time.Time) (DecisionReceipt, error) {
	var receipt DecisionReceipt
	var raw, authRaw []byte
	var consumed sql.NullTime
	err := tx.QueryRowContext(ctx, `SELECT payload,authorization_context,consumed_at FROM restricted.system_application_update_decisions WHERE id=$1 FOR UPDATE`, id).Scan(&raw, &authRaw, &consumed)
	if err == sql.ErrNoRows {
		return receipt, refuse("decision_not_found", http.StatusNotFound)
	}
	if err != nil {
		return receipt, err
	}
	if err = json.Unmarshal(raw, &receipt); err != nil {
		return receipt, err
	}
	if consumed.Valid {
		return receipt, refuse("decision_replayed", http.StatusConflict)
	}
	if !fresh(receipt.ExpiresAt, now) {
		return receipt, refuse("queue_expired", http.StatusConflict)
	}
	var actor Authorization
	if err = json.Unmarshal(authRaw, &actor); err != nil {
		return receipt, err
	}
	if err = RecheckAuthorization(ctx, tx, actor); err != nil {
		return receipt, err
	}
	job, err := loadJob(ctx, tx, receipt.JobID)
	if err != nil {
		return receipt, err
	}
	state, err := loadControl(ctx, tx)
	if err != nil {
		return receipt, err
	}
	if !state.available {
		return receipt, refuse("executor_unavailable", http.StatusServiceUnavailable)
	}
	if state.installationID != receipt.Target.InstallationID {
		return receipt, refuse("stale_decision", http.StatusConflict)
	}
	return receipt, validateDecision(job, DecisionRequest{Decision: receipt.Decision, Target: receipt.Target}, now)
}
