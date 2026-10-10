// admission_saver.go
// Admits requests and decisions atomically with proof consumption and audit events.
// Connects the request transaction to private durable application-update records.
// Leaves commit and its buffered HTTP acknowledgement to the existing pipeline.
package application_updates

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"net/http"
	"time"
)

type control struct {
	installationID string
	available      bool
	offer          *Offer
}

func loadControl(ctx context.Context, tx *sql.Tx) (control, error) {
	var state control
	var raw []byte
	err := tx.QueryRowContext(ctx, `SELECT installation_id, executor_available AND executor_enabled
		AND executor_checked_at > clock_timestamp()-interval '1 minute' AND executor_checked_at <= clock_timestamp(), offer
		FROM restricted.system_application_update_control WHERE singleton IS TRUE FOR UPDATE`).Scan(&state.installationID, &state.available, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return state, nil
	}
	if err == nil && len(raw) > 0 && string(raw) != "null" {
		state.offer = &Offer{}
		err = json.Unmarshal(raw, state.offer)
	}
	return state, err
}

func loadJob(ctx context.Context, tx *sql.Tx, id string) (Job, error) {
	var job Job
	var raw []byte
	err := tx.QueryRowContext(ctx, `SELECT payload FROM restricted.system_application_update_jobs WHERE id=$1 FOR UPDATE`, id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return job, refuse("job_not_found", http.StatusNotFound)
	}
	if err == nil {
		err = json.Unmarshal(raw, &job)
	}
	return job, err
}

func saveJob(ctx context.Context, tx *sql.Tx, job Job, active bool) error {
	_, err := tx.ExecContext(ctx, `UPDATE restricted.system_application_update_jobs SET payload=$2, active=$3 WHERE id=$1`, job.ID, string(jsonBytes(job)), active)
	return err
}

func appendAudit(ctx context.Context, tx *sql.Tx, job *Job, actor Authorization, phase, receiptID, result, proofID string, now time.Time) error {
	sequence := int64(1)
	if len(job.Events) > 0 {
		sequence = job.Events[len(job.Events)-1].Sequence + 1
	}
	event := Event{ProtocolVersion: ProtocolVersion, Sequence: sequence, Phase: phase, At: timestamp(now), ActorID: actor.ActorID, EvidenceSHA256: job.Target.EvidenceSHA256, ReceiptID: receiptID, Result: result}
	// Audits need a stable reference, not a raw sign-in identifier. Only private
	// proof/job/decision authorization records need the original for live rechecks.
	auditActor := struct {
		ActorID         int    `json:"actor_id"`
		Generation      int64  `json:"generation"`
		SignInSHA256    string `json:"sign_in_sha256"`
		SignInExpiresAt int64  `json:"sign_in_expires_at"`
	}{ActorID: actor.ActorID, Generation: actor.Generation, SignInExpiresAt: actor.SignInExpiresAt}
	if actor.SignInID != "" {
		auditActor.SignInSHA256 = byteDigest([]byte(actor.SignInID))
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO restricted.system_application_update_events
		(job_id, sequence, event, authorization_context, proof_id, target, origin) VALUES ($1,$2,$3,$4,$5,$6,'administrator_view')`,
		job.ID, sequence, string(jsonBytes(event)), string(jsonBytes(auditActor)), proofID, string(jsonBytes(job.Target)))
	if err == nil {
		job.Events = append(job.Events, event)
	}
	return err
}

func consumeProof(ctx context.Context, tx *sql.Tx, token string, binding proofBinding, now time.Time) (string, error) {
	if len(token) != 64 {
		return "", refuse("proof_replayed", http.StatusForbidden)
	}
	id := byteDigest([]byte(token))
	var raw []byte
	var created, expires time.Time
	var consumed sql.NullTime
	err := tx.QueryRowContext(ctx, `SELECT binding,created_at,expires_at,consumed_at FROM restricted.system_application_update_proofs WHERE id=$1 FOR UPDATE`, id).Scan(&raw, &created, &expires, &consumed)
	if errors.Is(err, sql.ErrNoRows) {
		return "", refuse("proof_replayed", http.StatusForbidden)
	}
	if err != nil {
		return "", err
	}
	var stored proofBinding
	if err = json.Unmarshal(raw, &stored); err != nil {
		return "", err
	}
	if err = validateProof(stored, binding, created, expires, consumed.Valid, now); err != nil {
		return "", err
	}
	_, err = tx.ExecContext(ctx, `UPDATE restricted.system_application_update_proofs SET consumed_at=$2 WHERE id=$1`, id, now)
	return id, err
}

func existingAdmission(ctx context.Context, tx *sql.Tx, actor int, operation, key, hash string, out interface{}) (bool, error) {
	var storedHash string
	var raw []byte
	err := tx.QueryRowContext(ctx, `SELECT request_sha256,response FROM restricted.system_application_update_admissions WHERE actor_id=$1 AND operation=$2 AND idempotency_key=$3`, actor, operation, key).Scan(&storedHash, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if hash != storedHash {
		return false, refuse("idempotency_conflict", http.StatusConflict)
	}
	return true, json.Unmarshal(raw, out)
}

func saveAdmission(ctx context.Context, tx *sql.Tx, actor int, operation, key, hash string, response interface{}) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO restricted.system_application_update_admissions (actor_id,operation,idempotency_key,request_sha256,response) VALUES ($1,$2,$3,$4,$5)`, actor, operation, key, hash, string(jsonBytes(response)))
	return err
}

// AdmitRequest requires the caller to hold the permission barrier and recheck identity.
// Idempotent retries do not consume a second proof or refresh the original queue deadline.
func AdmitRequest(ctx context.Context, tx *sql.Tx, actor Authorization, request Request, now time.Time) (Job, error) {
	var job Job
	if err := validateEnvelope(request.ProtocolVersion, request.IdempotencyKey, request.Target, false); err != nil {
		return job, err
	}
	canonical := request
	canonical.ReauthenticationProof = ""
	hash := digest(canonical)
	if found, err := existingAdmission(ctx, tx, actor.ActorID, "request", request.IdempotencyKey, hash, &job); found || err != nil {
		return job, err
	}
	state, err := loadControl(ctx, tx)
	if err != nil {
		return job, err
	}
	if !state.available {
		return job, refuse("executor_unavailable", http.StatusServiceUnavailable)
	}
	if state.offer == nil {
		return job, refuse("preflight_refused", http.StatusUnprocessableEntity)
	}
	if err = validateOffer(*state.offer, state.installationID, now); err != nil {
		return job, err
	}
	if state.offer.ID != request.OfferID || state.offer.Target != request.Target {
		return job, refuse("offer_conflict", http.StatusConflict)
	}
	if err = expireQueued(ctx, tx, now); err != nil {
		return job, err
	}
	var active bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM restricted.system_application_update_jobs WHERE active IS TRUE)`).Scan(&active); err != nil {
		return job, err
	}
	if active {
		return job, refuse("active_job_conflict", http.StatusConflict)
	}
	proofID, err := consumeProof(ctx, tx, request.ReauthenticationProof, proofBinding{actor, "request", request.OfferID, request.Target}, now)
	if err != nil {
		return job, err
	}
	job = Job{ProtocolVersion: ProtocolVersion, ID: uuid.NewString(), Offer: *state.offer, Target: request.Target, RequesterID: actor.ActorID, Phase: "queued", CreatedAt: timestamp(now), ExpiresAt: timestamp(now.Add(QueueLifetime)), CompletionPolicy: "administrator_acceptance", EvidenceExpiresAt: state.offer.ExpiresAt, Events: []Event{}}
	_, err = tx.ExecContext(ctx, `INSERT INTO restricted.system_application_update_jobs (id,installation_id,requester_id,authorization_context,expires_at,active,payload) VALUES ($1,$2,$3,$4,$5,TRUE,$6)`, job.ID, job.Target.InstallationID, actor.ActorID, string(jsonBytes(actor)), now.Add(QueueLifetime), string(jsonBytes(job)))
	if err == nil {
		err = appendAudit(ctx, tx, &job, actor, "queued", "", "admitted", proofID, now)
	}
	if err == nil {
		err = saveJob(ctx, tx, job, true)
	}
	if err == nil {
		err = saveAdmission(ctx, tx, actor.ActorID, "request", request.IdempotencyKey, hash, job)
	}
	return job, err
}

// AdmitDecision records a receipt only; it never accepts a cutover or finalizes an update.
func AdmitDecision(ctx context.Context, tx *sql.Tx, actor Authorization, jobID string, request DecisionRequest, now time.Time) (DecisionReceipt, error) {
	var receipt DecisionReceipt
	if err := validateEnvelope(request.ProtocolVersion, request.IdempotencyKey, request.Target, true); err != nil {
		return receipt, err
	}
	canonical := request
	canonical.ReauthenticationProof = ""
	hash := digest(canonical)
	operation := "decision:" + jobID
	if found, err := existingAdmission(ctx, tx, actor.ActorID, operation, request.IdempotencyKey, hash, &receipt); found || err != nil {
		return receipt, err
	}
	job, err := loadJob(ctx, tx, jobID)
	if err != nil {
		return receipt, err
	}
	if err = validateDecision(job, request, now); err != nil {
		return receipt, err
	}
	state, err := loadControl(ctx, tx)
	if err != nil {
		return receipt, err
	}
	if !state.available {
		return receipt, refuse("executor_unavailable", http.StatusServiceUnavailable)
	}
	if state.installationID != job.Target.InstallationID {
		return receipt, refuse("stale_decision", http.StatusConflict)
	}
	var pending bool
	err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM restricted.system_application_update_decisions WHERE job_id=$1 AND evidence_sha256=$2 AND expires_at>$3 AND consumed_at IS NULL)`, jobID, request.Target.EvidenceSHA256, now).Scan(&pending)
	if err != nil {
		return receipt, err
	}
	if pending {
		return receipt, refuse("decision_conflict", http.StatusConflict)
	}
	proofID, err := consumeProof(ctx, tx, request.ReauthenticationProof, proofBinding{actor, request.Decision, jobID, request.Target}, now)
	if err != nil {
		return receipt, err
	}
	receipt = DecisionReceipt{ProtocolVersion: ProtocolVersion, ID: uuid.NewString(), JobID: jobID, ActorID: actor.ActorID, Decision: request.Decision, Target: request.Target, AdmittedAt: timestamp(now), ExpiresAt: timestamp(now.Add(QueueLifetime)), Origin: "administrator_view"}
	_, err = tx.ExecContext(ctx, `INSERT INTO restricted.system_application_update_decisions (id,job_id,evidence_sha256,authorization_context,expires_at,payload) VALUES ($1,$2,$3,$4,$5,$6)`, receipt.ID, jobID, request.Target.EvidenceSHA256, string(jsonBytes(actor)), now.Add(QueueLifetime), string(jsonBytes(receipt)))
	if err == nil {
		err = appendAudit(ctx, tx, &job, actor, "decision_queued", receipt.ID, request.Decision, proofID, now)
	}
	if err == nil {
		err = saveJob(ctx, tx, job, true)
	}
	if err == nil {
		err = saveAdmission(ctx, tx, actor.ActorID, operation, request.IdempotencyKey, hash, receipt)
	}
	return receipt, err
}

func expireQueued(ctx context.Context, tx *sql.Tx, now time.Time) error {
	rows, err := tx.QueryContext(ctx, `SELECT payload FROM restricted.system_application_update_jobs WHERE active IS TRUE AND expires_at<=$1 AND payload->>'phase'='queued' FOR UPDATE`, now)
	if err != nil {
		return err
	}
	var jobs []Job
	for rows.Next() {
		var raw []byte
		var job Job
		if err = rows.Scan(&raw); err == nil {
			err = json.Unmarshal(raw, &job)
		}
		if err != nil {
			rows.Close()
			return err
		}
		jobs = append(jobs, job)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, job := range jobs {
		job.Phase = "expired"
		job.TerminalResult = "nothing_changed"
		if err = appendAudit(ctx, tx, &job, Authorization{}, "expired", "", "nothing_changed", "", now); err != nil {
			return err
		}
		if err = saveJob(ctx, tx, job, false); err != nil {
			return err
		}
	}
	return nil
}
