// admission_saver_test.go
// Verifies admission ordering, idempotency, proof use and immutable audit identities.
// Connects SQL-scripted failure cases with real request/decision persistence code.
// Ensures no request or decision is mistaken for execution or acceptance.
package application_updates

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func requestAnswers(actor Authorization, offer Offer, token string, now time.Time) []queryAnswer {
	return []queryAnswer{empty("SELECT request_sha256"), one("SELECT installation_id", offer.Target.InstallationID, true, jsonBytes(offer)), empty("SELECT payload"), one("SELECT EXISTS", false), proofAnswer(proofBinding{actor, "request", offer.ID, offer.Target}, now, false)}
}

func TestRequestAdmissionPersistsJobProofAndAuditTogether(t *testing.T) {
	now := time.Now()
	actor := testActor()
	offer := testOffer(now)
	token := strings.Repeat("f", 64)
	tx, state := scriptTx(t, requestAnswers(actor, offer, token, now)...)
	job, err := AdmitRequest(context.Background(), tx, actor, Request{1, offer.ID, offer.Target, "request-1", token}, now)
	if err != nil {
		t.Fatal(err)
	}
	if job.Phase != "queued" || job.AdministratorAccepted || job.PublicReopened || job.RequesterID != 42 || job.ExpiresAt != timestamp(now.Add(QueueLifetime)) {
		t.Fatal(job)
	}
	var event Event
	var authorization struct {
		ActorID         int    `json:"actor_id"`
		Generation      int64  `json:"generation"`
		SignInSHA256    string `json:"sign_in_sha256"`
		SignInExpiresAt int64  `json:"sign_in_expires_at"`
	}
	found := false
	for _, statement := range state.executed {
		if strings.Contains(statement.query, "system_application_update_events") {
			found = true
			_ = json.Unmarshal([]byte(statement.args[2].Value.(string)), &event)
			_ = json.Unmarshal([]byte(statement.args[3].Value.(string)), &authorization)
			if statement.args[4].Value != byteDigest([]byte(token)) {
				t.Fatal("audit lacks hashed authentication proof reference")
			}
			if strings.Contains(statement.args[3].Value.(string), actor.SignInID) {
				t.Fatal("audit contains raw sign-in identity")
			}
		}
	}
	if !found || event.ProtocolVersion != ProtocolVersion || event.Sequence != 1 || event.Phase != "queued" || event.ActorID != 42 || event.EvidenceSHA256 != offer.Target.EvidenceSHA256 || authorization.ActorID != actor.ActorID || authorization.Generation != actor.Generation || authorization.SignInExpiresAt != actor.SignInExpiresAt || authorization.SignInSHA256 != byteDigest([]byte(actor.SignInID)) {
		t.Fatal(event, authorization)
	}
	if state.commits != 0 {
		t.Fatal("service committed caller's transaction")
	}
}

func TestIdempotentRetryDoesNotConsumeAnotherProofOrRenewQueue(t *testing.T) {
	now := time.Now()
	offer := testOffer(now)
	request := Request{1, offer.ID, offer.Target, "request-1", "unused-token"}
	canonical := request
	canonical.ReauthenticationProof = ""
	original := Job{ID: "original", Phase: "queued", ExpiresAt: timestamp(now.Add(-time.Minute))}
	tx, state := scriptTx(t, one("SELECT request_sha256", digest(canonical), jsonBytes(original)))
	job, err := AdmitRequest(context.Background(), tx, testActor(), request, now)
	if err != nil || job.ID != original.ID || job.ExpiresAt != original.ExpiresAt || len(state.executed) != 0 {
		t.Fatal(job, err, state.executed)
	}
	tx, _ = scriptTx(t, one("SELECT request_sha256", "different", jsonBytes(original)))
	_, err = AdmitRequest(context.Background(), tx, testActor(), request, now)
	assertCode(t, err, "idempotency_conflict")
}

func TestUnavailableExecutorAndPreflightRefusalHaveDifferentStatuses(t *testing.T) {
	now := time.Now()
	offer := testOffer(now)
	request := Request{1, offer.ID, offer.Target, "request-1", "unused"}
	for _, available := range []bool{false, true} {
		broken := offer
		broken.ReleaseVerified = false
		tx, state := scriptTx(t, empty("SELECT request_sha256"), one("SELECT installation_id", offer.Target.InstallationID, available, jsonBytes(broken)))
		_, err := AdmitRequest(context.Background(), tx, testActor(), request, now)
		if available {
			assertCode(t, err, "preflight_refused")
		} else {
			assertCode(t, err, "executor_unavailable")
		}
		if len(state.executed) != 0 {
			t.Fatal("refusal consumed proof or stored job")
		}
	}
}

func TestDecisionAdmissionKeepsRequesterAndDeciderSeparateWithoutAccepting(t *testing.T) {
	now := time.Now()
	actor := testActor()
	target := testTarget()
	target.CutoverID = "cutover-1"
	token := strings.Repeat("f", 64)
	for _, decision := range []string{"accept", "refuse"} {
		job := Job{ID: "job-1", RequesterID: 73, Target: target, Phase: "awaiting_administrator", PublicReopened: true, EvidenceExpiresAt: timestamp(now.Add(time.Hour)), Events: []Event{{Sequence: 9}}}
		tx, state := scriptTx(t, empty("SELECT request_sha256"), one("SELECT payload", jsonBytes(job)), one("SELECT installation_id", "site-1", true, nil), one("SELECT EXISTS", false), proofAnswer(proofBinding{actor, decision, job.ID, target}, now, false))
		receipt, err := AdmitDecision(context.Background(), tx, actor, job.ID, DecisionRequest{1, decision, target, "decision-1", token}, now)
		if err != nil || receipt.ActorID != 42 || receipt.Decision != decision || receipt.ExpiresAt != timestamp(now.Add(QueueLifetime)) {
			t.Fatal(receipt, err)
		}
		for _, statement := range state.executed {
			if strings.Contains(statement.query, "INSERT INTO restricted.system_application_update_events") {
				raw := statement.args[3].Value.(string)
				if strings.Contains(raw, actor.SignInID) || strings.Contains(raw, token) || !strings.Contains(raw, byteDigest([]byte(actor.SignInID))) || statement.args[4].Value != byteDigest([]byte(token)) {
					t.Fatal("decision audit exposes a secret or lacks hashed references")
				}
			}
			if strings.Contains(statement.query, "UPDATE restricted.system_application_update_jobs") {
				var stored Job
				_ = json.Unmarshal([]byte(statement.args[1].Value.(string)), &stored)
				if stored.RequesterID != 73 || stored.AdministratorAccepted || stored.Phase != "awaiting_administrator" || stored.Events[1].Sequence != 10 || stored.Events[1].ActorID != 42 || stored.Events[1].ReceiptID != receipt.ID {
					t.Fatal(stored)
				}
			}
		}
	}
}

func TestStaleAndConflictingDecisionsDoNotConsumeProofs(t *testing.T) {
	now := time.Now()
	target := testTarget()
	target.CutoverID = "cutover-1"
	request := DecisionRequest{1, "accept", target, "decision-1", "unused"}
	job := Job{ID: "job-1", Target: target, Phase: "awaiting_administrator", PublicReopened: true, EvidenceExpiresAt: timestamp(now.Add(time.Hour))}
	stale := job
	stale.Target.EvidenceRevision++
	tx, state := scriptTx(t, empty("SELECT request_sha256"), one("SELECT payload", jsonBytes(stale)))
	_, err := AdmitDecision(context.Background(), tx, testActor(), job.ID, request, now)
	assertCode(t, err, "stale_decision")
	if len(state.executed) != 0 {
		t.Fatal(state.executed)
	}
	tx, state = scriptTx(t, empty("SELECT request_sha256"), one("SELECT payload", jsonBytes(job)), one("SELECT installation_id", "site-1", true, nil), one("SELECT EXISTS", true))
	_, err = AdmitDecision(context.Background(), tx, testActor(), job.ID, request, now)
	assertCode(t, err, "decision_conflict")
	if len(state.executed) != 0 {
		t.Fatal(state.executed)
	}
}

func TestExpiredQueueRecordsOrderedNothingChangedOutcome(t *testing.T) {
	now := time.Now()
	job := Job{ID: "expired-job", Target: testTarget(), Phase: "queued", Events: []Event{{Sequence: 1}}, ExpiresAt: timestamp(now)}
	tx, state := scriptTx(t, one("SELECT payload", jsonBytes(job)))
	if err := expireQueued(context.Background(), tx, now); err != nil {
		t.Fatal(err)
	}
	last := state.executed[len(state.executed)-1]
	var stored Job
	_ = json.Unmarshal([]byte(last.args[1].Value.(string)), &stored)
	if stored.Phase != "expired" || stored.TerminalResult != "nothing_changed" || stored.Events[1].ProtocolVersion != ProtocolVersion || stored.Events[1].Sequence != 2 || stored.Events[1].Result != "nothing_changed" || last.args[2].Value != false {
		t.Fatal(stored, last)
	}
}
