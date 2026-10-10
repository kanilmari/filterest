// admission_validator_test.go
// Exercises every proof binding and evidence/expiry boundary without a database.
// Connects request identity and administrator cutover decisions to protocol rules.
// Prevents replay across sessions, releases, installations or revised evidence.
package application_updates

import (
	"testing"
	"time"
)

func TestProofRejectsEveryChangedBindingAndFreshnessBoundary(t *testing.T) {
	now := time.Now()
	binding := proofBinding{testActor(), "request", "offer-1", testTarget()}
	changes := map[string]func(*proofBinding){
		"actor": func(b *proofBinding) { b.AuthorizationContext.ActorID++ }, "generation": func(b *proofBinding) { b.AuthorizationContext.Generation++ },
		"session": func(b *proofBinding) { b.AuthorizationContext.SignInID += "x" }, "session deadline": func(b *proofBinding) { b.AuthorizationContext.SignInExpiresAt++ },
		"action": func(b *proofBinding) { b.Action = "accept" }, "offer or job": func(b *proofBinding) { b.ObjectID += "x" },
		"installation": func(b *proofBinding) { b.Target.InstallationID += "x" }, "release": func(b *proofBinding) { b.Target.ReleaseID += "x" },
		"manifest": func(b *proofBinding) { b.Target.ManifestSHA256 = "different" }, "image": func(b *proofBinding) { b.Target.ImageDigest = "different" },
		"cutover": func(b *proofBinding) { b.Target.CutoverID = "cutover" }, "revision": func(b *proofBinding) { b.Target.EvidenceRevision++ }, "evidence": func(b *proofBinding) { b.Target.EvidenceSHA256 = "different" },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			changed := binding
			change(&changed)
			assertCode(t, validateProof(binding, changed, now.Add(-time.Minute), now.Add(time.Minute), false, now), "proof_replayed")
		})
	}
	assertCode(t, validateProof(binding, binding, now.Add(-time.Minute), now.Add(time.Minute), true, now), "proof_replayed")
	for _, created := range []time.Time{now.Add(-ProofFreshness), now.Add(time.Second)} {
		assertCode(t, validateProof(binding, binding, created, now.Add(time.Minute), false, now), "proof_expired")
	}
	assertCode(t, validateProof(binding, binding, now.Add(-time.Minute), now, false, now), "proof_expired")
	if err := validateProof(binding, binding, now.Add(-ProofFreshness+time.Nanosecond), now.Add(time.Minute), false, now); err != nil {
		t.Fatal(err)
	}
}

func TestPreflightAndStaleDecisionAreSeparateRefusals(t *testing.T) {
	now := time.Now()
	offer := testOffer(now)
	if err := validateOffer(offer, "site-1", now); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Offer){func(o *Offer) { o.ReleaseVerified = false }, func(o *Offer) { o.InstallationCompatible = false }, func(o *Offer) { o.ExecutionReady = false }, func(o *Offer) { o.ExpiresAt = timestamp(now) }, func(o *Offer) { o.Target.InstallationID = "elsewhere" }, func(o *Offer) { o.CurrentImageDigest = "missing" }} {
		copy := offer
		change(&copy)
		assertCode(t, validateOffer(copy, "site-1", now), "preflight_refused")
	}
	target := testTarget()
	target.CutoverID = "cutover-1"
	job := Job{Target: target, Phase: "awaiting_administrator", PublicReopened: true, EvidenceExpiresAt: timestamp(now.Add(time.Minute))}
	request := DecisionRequest{Decision: "accept", Target: target}
	if err := validateDecision(job, request, now); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Job){func(j *Job) { j.Phase = "validating" }, func(j *Job) { j.PublicReopened = false }, func(j *Job) { j.Target.EvidenceRevision++ }, func(j *Job) { j.Target.CutoverID = "next" }, func(j *Job) { j.Target.ImageDigest = "substitute" }, func(j *Job) { j.EvidenceExpiresAt = timestamp(now) }} {
		copy := job
		change(&copy)
		assertCode(t, validateDecision(copy, request, now), "stale_decision")
	}
}
