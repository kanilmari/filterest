// authorization_checker_test.go
// Rechecks revocations, receipt expiry, durable replay and authentication budgets.
// Connects stored intent with current enabled administrators and explicit grants.
// Proves later worker pickup cannot inherit authority that has ended.
package application_updates

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestAuthorizationRefusesRevokedAccountGenerationSessionAndGrant(t *testing.T) {
	for _, kind := range []string{"disabled", "not administrator", "generation", "sign-out", "grant", "missing account"} {
		t.Run(kind, func(t *testing.T) {
			actor := testActor()
			answers := []queryAnswer{}
			if kind == "missing account" {
				answers = append(answers, empty("SELECT u.enabled"))
			} else {
				generation := actor.Generation
				if kind == "generation" {
					generation++
				}
				answers = append(answers, one("SELECT u.enabled", kind != "disabled", kind != "not administrator", generation))
				if kind == "sign-out" || kind == "grant" {
					answers = append(answers, one("FROM public.system_revoked_sign_ins", kind != "sign-out"))
				}
				if kind == "grant" {
					answers = append(answers, one("SELECT EXISTS", false))
				}
			}
			tx, _ := scriptTx(t, answers...)
			assertCode(t, RecheckAuthorization(context.Background(), tx, actor), "authorization_revoked")
		})
	}
}

func TestProofConsumptionRefusesReplayWithoutAnotherWrite(t *testing.T) {
	now := time.Now()
	actor := testActor()
	binding := proofBinding{actor, "request", "offer-1", testTarget()}
	token := strings.Repeat("f", 64)
	tx, state := scriptTx(t, proofAnswer(binding, now, false), proofAnswer(binding, now, true))
	if _, err := consumeProof(context.Background(), tx, token, binding, now); err != nil {
		t.Fatal(err)
	}
	_, err := consumeProof(context.Background(), tx, token, binding, now)
	assertCode(t, err, "proof_replayed")
	if len(state.executed) != 1 {
		t.Fatal("replay consumed proof twice")
	}
}

func TestQueuedRequestAndDecisionExpireAtTenMinutes(t *testing.T) {
	now := time.Now()
	job := Job{ID: "job-1", Phase: "queued", ExpiresAt: timestamp(now)}
	tx, _ := scriptTx(t, one("SELECT payload", jsonBytes(job)))
	_, err := RecheckQueuedRequest(context.Background(), tx, job.ID, now)
	assertCode(t, err, "queue_expired")
	receipt := DecisionReceipt{ID: "decision-1", ExpiresAt: timestamp(now)}
	tx, _ = scriptTx(t, one("SELECT payload", jsonBytes(receipt), jsonBytes(testActor()), nil))
	_, err = RecheckQueuedDecision(context.Background(), tx, receipt.ID, now)
	assertCode(t, err, "queue_expired")
	tx, _ = scriptTx(t, one("SELECT payload", jsonBytes(receipt), jsonBytes(testActor()), now))
	_, err = RecheckQueuedDecision(context.Background(), tx, receipt.ID, now)
	assertCode(t, err, "decision_replayed")
}

func TestAuthenticationRateLimitPersistsItsBudgetOnRefusal(t *testing.T) {
	for _, count := range []int64{5, 6} {
		answers := []queryAnswer{one("RETURNING attempts", count)}
		if count == 5 {
			answers = append(answers, one("RETURNING attempts", count))
		}
		db, state := scriptDB(t, answers...)
		err := reserveAuthenticationAttempt(context.Background(), db, 42, "127.0.0.1")
		if count == 6 {
			assertCode(t, err, "rate_limited")
		} else if err != nil {
			t.Fatal(err)
		}
		if state.commits != 1 {
			t.Fatal("failed attempts lost their durable rate budget")
		}
	}
}
