// admission_validator.go
// Checks immutable evidence, authentication bindings and queue freshness.
// Connects browser submissions to server-published offers and cutover evidence.
// Rejects stale or ambiguous authorization before anything can be admitted.
package application_updates

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"time"
)

const ProofFreshness = 5 * time.Minute
const QueueLifetime = 10 * time.Minute

var digestPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var identityPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

type refusal struct {
	code   string
	status int
}

func (e *refusal) Error() string           { return e.code }
func refuse(code string, status int) error { return &refusal{code, status} }

// Authorization is retained privately for pickup-time revocation rechecks.
type Authorization struct {
	ActorID         int    `json:"actor_id"`
	Generation      int64  `json:"generation"`
	SignInID        string `json:"sign_in_id"`
	SignInExpiresAt int64  `json:"sign_in_expires_at"`
}

type proofBinding struct {
	AuthorizationContext Authorization `json:"authorization_context"`
	Action               string        `json:"action"`
	ObjectID             string        `json:"object_id"`
	Target               Target        `json:"target"`
}

func jsonBytes(value interface{}) []byte { raw, _ := json.Marshal(value); return raw }
func digest(value interface{}) string    { return byteDigest(jsonBytes(value)) }
func byteDigest(raw []byte) string       { hash := sha256.Sum256(raw); return hex.EncodeToString(hash[:]) }
func timestamp(now time.Time) string     { return now.UTC().Format(time.RFC3339Nano) }
func fresh(until string, now time.Time) bool {
	t, err := time.Parse(time.RFC3339Nano, until)
	return err == nil && now.Before(t)
}

func validateTarget(target Target, decision bool) error {
	if !identityPattern.MatchString(target.InstallationID) || !identityPattern.MatchString(target.ReleaseID) ||
		!digestPattern.MatchString(target.ManifestSHA256) || !digestPattern.MatchString(target.EvidenceSHA256) ||
		len(target.ImageDigest) != 71 || target.ImageDigest[:7] != "sha256:" || !digestPattern.MatchString(target.ImageDigest[7:]) || target.EvidenceRevision < 1 {
		return refuse("invalid_request", http.StatusBadRequest)
	}
	if decision && !identityPattern.MatchString(target.CutoverID) || !decision && target.CutoverID != "" {
		return refuse("invalid_request", http.StatusBadRequest)
	}
	return nil
}

func validateEnvelope(version int, key string, target Target, decision bool) error {
	if version != ProtocolVersion || !identityPattern.MatchString(key) {
		return refuse("invalid_request", http.StatusBadRequest)
	}
	return validateTarget(target, decision)
}

func validateOffer(offer Offer, installationID string, now time.Time) error {
	if offer.ProtocolVersion != ProtocolVersion || offer.Target.InstallationID != installationID || !identityPattern.MatchString(offer.ID) ||
		validateTarget(offer.Target, false) != nil || !fresh(offer.ExpiresAt, now) || offer.Composition == "" || offer.SourceCommit == "" || offer.TrustRevision < 1 ||
		!offer.ReleaseVerified || !offer.InstallationCompatible || !offer.ExecutionReady {
		return refuse("preflight_refused", http.StatusUnprocessableEntity)
	}
	if !identityPattern.MatchString(offer.CurrentReleaseID) || len(offer.CurrentImageDigest) != 71 || offer.CurrentImageDigest[:7] != "sha256:" || !digestPattern.MatchString(offer.CurrentImageDigest[7:]) || offer.FromDatabaseVersion == "" || offer.ToDatabaseVersion == "" {
		return refuse("preflight_refused", http.StatusUnprocessableEntity)
	}
	return nil
}

func validateDecision(job Job, request DecisionRequest, now time.Time) error {
	if request.Decision != "accept" && request.Decision != "refuse" {
		return refuse("invalid_request", http.StatusBadRequest)
	}
	if job.Phase != "awaiting_administrator" || !job.PublicReopened || job.Target != request.Target || !fresh(job.EvidenceExpiresAt, now) {
		return refuse("stale_decision", http.StatusConflict)
	}
	return nil
}

func validateProof(stored, expected proofBinding, createdAt, expiresAt time.Time, consumed bool, now time.Time) error {
	if consumed || stored != expected {
		return refuse("proof_replayed", http.StatusForbidden)
	}
	if now.Before(createdAt) || !now.Before(expiresAt) || now.Sub(createdAt) >= ProofFreshness {
		return refuse("proof_expired", http.StatusForbidden)
	}
	return nil
}
