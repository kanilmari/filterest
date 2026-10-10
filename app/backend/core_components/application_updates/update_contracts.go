// update_contracts.go
// Defines the version-one browser admission and administrator decision protocol.
// Connects signed release offers, installation evidence, durable jobs and receipts.
// Keeps execution outside the application while exposing sanitized, ordered facts.
package application_updates

const ProtocolVersion = 1

// Target is immutable identity, supplied by a trusted offer or current cutover.
type Target struct {
	InstallationID   string `json:"installation_id"`
	ReleaseID        string `json:"release_id"`
	ManifestSHA256   string `json:"manifest_sha256"`
	ImageDigest      string `json:"image_digest"`
	CutoverID        string `json:"cutover_id"`
	EvidenceRevision int64  `json:"evidence_revision"`
	EvidenceSHA256   string `json:"evidence_sha256"`
}

// Offer is operator-published verifier evidence, never GitHub's advisory latest release.
type Offer struct {
	ProtocolVersion        int    `json:"protocol_version"`
	ID                     string `json:"id"`
	Target                 Target `json:"target"`
	Composition            string `json:"composition"`
	SourceCommit           string `json:"source_commit"`
	CurrentReleaseID       string `json:"current_release_id"`
	CurrentImageDigest     string `json:"current_image_digest"`
	FromDatabaseVersion    string `json:"from_database_version"`
	ToDatabaseVersion      string `json:"to_database_version"`
	TrustRevision          int64  `json:"trust_revision"`
	ExpiresAt              string `json:"expires_at"`
	ReleaseVerified        bool   `json:"release_verified"`
	InstallationCompatible bool   `json:"installation_compatible"`
	ExecutionReady         bool   `json:"execution_ready"`
}

// JobPhases is the public durable progress vocabulary for future executors.
var JobPhases = [...]string{"queued", "verifying", "preparing", "rehearsing", "notice", "maintenance", "draining", "stopped", "quiescent", "backing_up", "off_host_copy_verified", "migrating", "restarting", "validating", "awaiting_administrator", "finalizing", "succeeded", "expired", "refused", "restored", "recovery_required", "repair_required", "failed"}

type Request struct {
	ProtocolVersion       int    `json:"protocol_version"`
	OfferID               string `json:"offer_id"`
	Target                Target `json:"target"`
	IdempotencyKey        string `json:"idempotency_key"`
	ReauthenticationProof string `json:"reauthentication_proof"`
}

type DecisionRequest struct {
	ProtocolVersion       int    `json:"protocol_version"`
	Decision              string `json:"decision"`
	Target                Target `json:"target"`
	IdempotencyKey        string `json:"idempotency_key"`
	ReauthenticationProof string `json:"reauthentication_proof"`
}

type ReauthenticationRequest struct {
	ProtocolVersion int    `json:"protocol_version"`
	Action          string `json:"action"`
	OfferID         string `json:"offer_id"`
	JobID           string `json:"job_id"`
	Target          Target `json:"target"`
	Password        string `json:"password"`
	FactorCode      string `json:"factor_code"`
}

type ReauthenticationResponse struct {
	ProtocolVersion    int    `json:"protocol_version"`
	Proof              string `json:"proof"`
	ExpiresAt          string `json:"expires_at"`
	FactorRequired     bool   `json:"factor_required"`
	VerificationMethod string `json:"verification_method"`
}

// Event maps durable transitions; clients must never infer progress from log text.
type Event struct {
	ProtocolVersion int    `json:"protocol_version"`
	Sequence        int64  `json:"sequence"`
	Phase           string `json:"phase"`
	At              string `json:"at"`
	ActorID         int    `json:"actor_id"`
	EvidenceSHA256  string `json:"evidence_sha256"`
	ReceiptID       string `json:"receipt_id"`
	Result          string `json:"result"`
}

type DecisionReceipt struct {
	ProtocolVersion int    `json:"protocol_version"`
	ID              string `json:"id"`
	JobID           string `json:"job_id"`
	ActorID         int    `json:"actor_id"`
	Decision        string `json:"decision"`
	Target          Target `json:"target"`
	AdmittedAt      string `json:"admitted_at"`
	ExpiresAt       string `json:"expires_at"`
	Origin          string `json:"origin"`
}

type Job struct {
	ProtocolVersion       int     `json:"protocol_version"`
	ID                    string  `json:"id"`
	Offer                 Offer   `json:"offer"`
	Target                Target  `json:"target"`
	RequesterID           int     `json:"requester_id"`
	Phase                 string  `json:"phase"`
	TerminalResult        string  `json:"terminal_result"`
	CreatedAt             string  `json:"created_at"`
	ExpiresAt             string  `json:"expires_at"`
	CompletionPolicy      string  `json:"completion_policy"`
	EvidenceExpiresAt     string  `json:"evidence_expires_at"`
	PublicReopened        bool    `json:"public_reopened"`
	AdministratorAccepted bool    `json:"administrator_accepted"`
	Events                []Event `json:"events"`
}

type StatusResponse struct {
	ProtocolVersion   int    `json:"protocol_version"`
	InstallationID    string `json:"installation_id"`
	ExecutorAvailable bool   `json:"executor_available"`
	CanUpdate         bool   `json:"can_update"`
	Offer             *Offer `json:"offer"`
	LatestJob         *Job   `json:"latest_job"`
}

// ErrorResponse distinguishes conflicts, unavailable execution and refused preflight.
type ErrorResponse struct {
	ProtocolVersion int    `json:"protocol_version"`
	Code            string `json:"code"`
	ErrorLangKey    string `json:"error_lang_key"`
}
