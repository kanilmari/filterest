// delegation_store.go
// Holds short-lived credentials that let an assistant job act as the administrator who asked.
// Bridges the chat job dispatcher, the delegation exchange route and the request guard.
// Exists so an assistant reads with the asker's own rights and writes only approved calls.
//
// Delegations live in this process only: they expire in minutes, a restart ends
// every open job, and no assistant credential is written to the database or disk.
package site_assistant

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// DelegationCodePrefix marks an exchange code so a leaked value is recognizable.
const DelegationCodePrefix = "fsa1_"

// MaxDelegationLifetime bounds one job's delegation regardless of the caller's request.
const MaxDelegationLifetime = 45 * time.Minute

// SessionDelegationKey marks a session that an assistant job opened by exchanging
// its code. The guard and the chat use it to recognize assistant requests.
const SessionDelegationKey = "site_assistant_delegation_id"

var (
	// ErrUnknownDelegation covers an unknown, already exchanged, revoked or expired credential.
	ErrUnknownDelegation = errors.New("site assistant delegation is not valid")
	// ErrWriteNotApproved means the request does not match a call the administrator approved.
	ErrWriteNotApproved = errors.New("site assistant write call is not approved")
)

// ApprovedCall is one write request the administrator accepted from a plan.
// Query and body are matched canonically so the approval names one exact target
// without depending on query-parameter order or equivalent URL encoding.
type ApprovedCall struct {
	Method   string `json:"method"`
	Path     string `json:"path"`
	Query    string `json:"query"`
	BodyHash string `json:"body_sha256"`
	used     bool
}

// Delegation is one job's authority to act as one user until it expires.
type Delegation struct {
	ID        string
	JobID     string
	SiteID    string
	UserID    int
	Username  string
	IssuedAt  time.Time
	ExpiresAt time.Time

	codeHash  [sha256.Size]byte
	exchanged bool
	revoked   bool
	approved  []ApprovedCall
}

// Store keeps the delegations of this process.
type Store struct {
	mutex       sync.Mutex
	delegations map[string]*Delegation
	now         func() time.Time
}

// NewStore creates an empty store. A test may replace its clock.
func NewStore() *Store {
	return &Store{delegations: map[string]*Delegation{}, now: time.Now}
}

// DefaultStore is the store the running application uses.
var DefaultStore = NewStore()

// SetClock replaces the store's clock in tests.
func (store *Store) SetClock(clock func() time.Time) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.now = clock
}

// Issue creates a delegation for one job and returns its one-time exchange code.
// The code is returned once; the store keeps only its hash.
func (store *Store) Issue(userID int, username string, jobID string, siteID string, lifetime time.Duration) (string, *Delegation, error) {
	if userID <= 1 || strings.TrimSpace(username) == "" {
		return "", nil, errors.New("site assistant delegation needs an authenticated administrator")
	}
	if strings.TrimSpace(jobID) == "" {
		return "", nil, errors.New("site assistant delegation needs a job identifier")
	}
	if lifetime <= 0 || lifetime > MaxDelegationLifetime {
		lifetime = MaxDelegationLifetime
	}

	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", nil, fmt.Errorf("generate delegation code: %w", err)
	}
	identifier := make([]byte, 16)
	if _, err := rand.Read(identifier); err != nil {
		return "", nil, fmt.Errorf("generate delegation id: %w", err)
	}
	code := DelegationCodePrefix + base64.RawURLEncoding.EncodeToString(secret)

	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.collectExpiredLocked()
	issued := store.now()
	delegation := &Delegation{
		ID:        hex.EncodeToString(identifier),
		JobID:     strings.TrimSpace(jobID),
		SiteID:    strings.TrimSpace(siteID),
		UserID:    userID,
		Username:  strings.TrimSpace(username),
		IssuedAt:  issued,
		ExpiresAt: issued.Add(lifetime),
		codeHash:  sha256.Sum256([]byte(code)),
	}
	store.delegations[delegation.ID] = delegation
	return code, delegation.copyLocked(), nil
}

// Exchange consumes the one-time code and returns the delegation it belongs to.
// A second exchange of the same code fails, so a leaked code cannot be replayed.
func (store *Store) Exchange(code string) (*Delegation, error) {
	if !strings.HasPrefix(code, DelegationCodePrefix) {
		return nil, ErrUnknownDelegation
	}
	candidate := sha256.Sum256([]byte(code))

	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.collectExpiredLocked()
	for _, delegation := range store.delegations {
		if subtle.ConstantTimeCompare(delegation.codeHash[:], candidate[:]) != 1 {
			continue
		}
		if delegation.exchanged || !store.liveLocked(delegation) {
			return nil, ErrUnknownDelegation
		}
		delegation.exchanged = true
		return delegation.copyLocked(), nil
	}
	return nil, ErrUnknownDelegation
}

// Lookup returns a live delegation without consuming anything.
func (store *Store) Lookup(delegationID string) (*Delegation, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	delegation, ok := store.delegations[delegationID]
	if !ok || !store.liveLocked(delegation) {
		return nil, ErrUnknownDelegation
	}
	return delegation.copyLocked(), nil
}

// ByJob returns the live delegation of one job, so the chat can approve its plan
// without the browser ever seeing a delegation identifier.
func (store *Store) ByJob(jobID string) (*Delegation, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	jobID = strings.TrimSpace(jobID)
	for _, delegation := range store.delegations {
		if delegation.JobID == jobID && store.liveLocked(delegation) {
			return delegation.copyLocked(), nil
		}
	}
	return nil, ErrUnknownDelegation
}

// Approve records the exact write calls the administrator accepted. Each call
// may run once; approving again replaces the remaining plan.
func (store *Store) Approve(delegationID string, calls []ApprovedCall) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	delegation, ok := store.delegations[delegationID]
	if !ok || !store.liveLocked(delegation) {
		return ErrUnknownDelegation
	}
	approved := make([]ApprovedCall, 0, len(calls))
	for _, call := range calls {
		normalized, err := normalizeApprovedCall(call)
		if err != nil {
			return err
		}
		approved = append(approved, normalized)
	}
	delegation.approved = approved
	return nil
}

// UseWriteApproval consumes the approval matching one request, or reports why not.
func (store *Store) UseWriteApproval(delegationID string, method string, path string, rawQuery string, bodyHash string) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	delegation, ok := store.delegations[delegationID]
	if !ok || !store.liveLocked(delegation) {
		return ErrUnknownDelegation
	}
	method = strings.ToUpper(strings.TrimSpace(method))
	query, err := CanonicalQuery(rawQuery)
	if err != nil {
		return ErrWriteNotApproved
	}
	bodyHash = strings.ToLower(strings.TrimSpace(bodyHash))
	for index := range delegation.approved {
		call := &delegation.approved[index]
		if call.used || call.Method != method || call.Path != path || call.Query != query || call.BodyHash != bodyHash {
			continue
		}
		call.used = true
		return nil
	}
	return ErrWriteNotApproved
}

// Revoke ends a delegation immediately, for example when its job finishes.
func (store *Store) Revoke(delegationID string) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	delete(store.delegations, delegationID)
}

// PendingApprovals lists the approved calls that have not run yet.
func (store *Store) PendingApprovals(delegationID string) ([]ApprovedCall, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	delegation, ok := store.delegations[delegationID]
	if !ok || !store.liveLocked(delegation) {
		return nil, ErrUnknownDelegation
	}
	pending := make([]ApprovedCall, 0, len(delegation.approved))
	for _, call := range delegation.approved {
		if !call.used {
			pending = append(pending, ApprovedCall{Method: call.Method, Path: call.Path, Query: call.Query, BodyHash: call.BodyHash})
		}
	}
	return pending, nil
}

// RequestIsWrite reports whether a method changes state and therefore needs approval.
func RequestIsWrite(method string) bool {
	switch strings.ToUpper(strings.TrimSpace(method)) {
	case http.MethodGet, http.MethodHead, http.MethodOptions, "":
		return false
	default:
		return true
	}
}

// HashRequestBody returns the hex SHA-256 used to bind a plan to exact content.
func HashRequestBody(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

// CanonicalQuery normalizes an encoded query for approval comparison. Sorting
// both names and repeated values makes pair order irrelevant; decoding and
// encoding again also removes harmless differences such as %20 versus +.
func CanonicalQuery(rawQuery string) (string, error) {
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return "", err
	}
	for key := range values {
		sort.Strings(values[key])
	}
	return values.Encode(), nil
}

func normalizeApprovedCall(call ApprovedCall) (ApprovedCall, error) {
	method := strings.ToUpper(strings.TrimSpace(call.Method))
	path := strings.TrimSpace(call.Path)
	query, queryErr := CanonicalQuery(call.Query)
	bodyHash := strings.ToLower(strings.TrimSpace(call.BodyHash))
	if !RequestIsWrite(method) {
		return ApprovedCall{}, fmt.Errorf("only write calls need approval, got %q", call.Method)
	}
	if !strings.HasPrefix(path, "/api/") {
		return ApprovedCall{}, fmt.Errorf("approved call path must be an API path, got %q", call.Path)
	}
	if queryErr != nil {
		return ApprovedCall{}, fmt.Errorf("approved call query is invalid for %s %s", method, path)
	}
	if len(bodyHash) != hex.EncodedLen(sha256.Size) {
		return ApprovedCall{}, fmt.Errorf("approved call needs a SHA-256 body hash for %s %s", method, path)
	}
	if _, err := hex.DecodeString(bodyHash); err != nil {
		return ApprovedCall{}, fmt.Errorf("approved call body hash is not hexadecimal for %s %s", method, path)
	}
	return ApprovedCall{Method: method, Path: path, Query: query, BodyHash: bodyHash}, nil
}

func (store *Store) liveLocked(delegation *Delegation) bool {
	return delegation != nil && !delegation.revoked && store.now().Before(delegation.ExpiresAt)
}

func (store *Store) collectExpiredLocked() {
	moment := store.now()
	for id, delegation := range store.delegations {
		if !moment.Before(delegation.ExpiresAt) {
			delete(store.delegations, id)
		}
	}
}

func (delegation *Delegation) copyLocked() *Delegation {
	copied := *delegation
	copied.approved = nil
	return &copied
}
