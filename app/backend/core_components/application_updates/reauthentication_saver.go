// reauthentication_saver.go
// Persists bounded authentication attempts and single-use, evidence-bound proofs.
// Connects existing credential verification to the private admission transaction.
// Stores proof hashes only; failed authentication cannot roll back its rate budget.
package application_updates

import (
	"context"
	"crypto/rand"
	"database/sql"
	"easelect/backend/core_components/dbutils"
	"encoding/hex"
	"net/http"
	"time"
)

// reserveAuthenticationAttempt persists actor and trusted-client-IP budgets separately
// from the request transaction, so a failed password still consumes a slot.
func reserveAuthenticationAttempt(ctx context.Context, db *sql.DB, actorID int, clientIP string) error {
	if db == nil {
		return refuse("executor_unavailable", http.StatusServiceUnavailable)
	}
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	tx, err := dbutils.RequireTxWithError(dbutils.SetLazyTx(ctx, lazy))
	if err != nil {
		return err
	}
	for _, key := range []string{digest(struct{ Actor int }{actorID}), byteDigest([]byte("ip:" + clientIP))} {
		var count int
		err = tx.QueryRowContext(ctx, `INSERT INTO restricted.system_application_update_auth_attempts (key,window_start,attempts)
			VALUES ($1,clock_timestamp(),1) ON CONFLICT (key) DO UPDATE SET
			attempts=CASE WHEN system_application_update_auth_attempts.window_start<=clock_timestamp()-interval '5 minutes' THEN 1 ELSE system_application_update_auth_attempts.attempts+1 END,
			window_start=CASE WHEN system_application_update_auth_attempts.window_start<=clock_timestamp()-interval '5 minutes' THEN clock_timestamp() ELSE system_application_update_auth_attempts.window_start END RETURNING attempts`, key).Scan(&count)
		if err != nil {
			return err
		}
		if count > 5 {
			if err = lazy.Commit(); err != nil {
				return err
			}
			return refuse("rate_limited", http.StatusTooManyRequests)
		}
	}
	return lazy.Commit()
}

func createProof(ctx context.Context, tx *sql.Tx, binding proofBinding, method string, now time.Time) (ReauthenticationResponse, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return ReauthenticationResponse{}, err
	}
	token := hex.EncodeToString(bytes[:])
	// timestamptz stores microseconds; rounding nanoseconds can put creation in
	// the future and extend expiry. Truncate issuance before deriving the deadline
	// so stored and returned times agree and freshness never exceeds five minutes.
	created := now.UTC().Truncate(time.Microsecond)
	expires := created.Add(ProofFreshness)
	_, err := tx.ExecContext(ctx, `INSERT INTO restricted.system_application_update_proofs (id,binding,created_at,expires_at,verification_method) VALUES ($1,$2,$3,$4,$5)`, byteDigest([]byte(token)), string(jsonBytes(binding)), created, expires, method)
	return ReauthenticationResponse{ProtocolVersion: ProtocolVersion, Proof: token, ExpiresAt: timestamp(expires)}, err
}

func validateReauthenticationTarget(ctx context.Context, tx *sql.Tx, request ReauthenticationRequest, now time.Time) (proofBinding, error) {
	binding := proofBinding{Action: request.Action, Target: request.Target}
	decision := request.Action == "accept" || request.Action == "refuse"
	if request.ProtocolVersion != ProtocolVersion || !decision && request.Action != "request" {
		return binding, refuse("invalid_request", http.StatusBadRequest)
	}
	if err := validateTarget(request.Target, decision); err != nil {
		return binding, err
	}
	if decision {
		if request.OfferID != "" || !identityPattern.MatchString(request.JobID) {
			return binding, refuse("invalid_request", http.StatusBadRequest)
		}
		job, err := loadJob(ctx, tx, request.JobID)
		if err != nil {
			return binding, err
		}
		binding.ObjectID = request.JobID
		return binding, validateDecision(job, DecisionRequest{Decision: request.Action, Target: request.Target}, now)
	}
	if request.JobID != "" {
		return binding, refuse("invalid_request", http.StatusBadRequest)
	}
	state, err := loadControl(ctx, tx)
	if err != nil {
		return binding, err
	}
	if !state.available {
		return binding, refuse("executor_unavailable", http.StatusServiceUnavailable)
	}
	if state.offer == nil {
		return binding, refuse("preflight_refused", http.StatusUnprocessableEntity)
	}
	if request.OfferID != state.offer.ID || request.Target != state.offer.Target {
		return binding, refuse("offer_conflict", http.StatusConflict)
	}
	binding.ObjectID = request.OfferID
	return binding, validateOffer(*state.offer, state.installationID, now)
}
