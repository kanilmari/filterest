// delegation_store_test.go
// Verifies the short-lived assistant delegation: one-time exchange, expiry, revocation and write approval.
// Bridges the in-process credential store and the rules the request guard depends on.
// Exists so an assistant cannot replay a code, outlive its job or write an unapproved call.
package site_assistant

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
)

func newTestStore(t *testing.T) (*Store, func(time.Duration)) {
	t.Helper()
	moment := time.Date(2026, 9, 18, 9, 0, 0, 0, time.UTC)
	store := NewStore()
	store.SetClock(func() time.Time { return moment })
	return store, func(step time.Duration) { moment = moment.Add(step) }
}

func issueTestDelegation(t *testing.T, store *Store) (string, *Delegation) {
	t.Helper()
	code, delegation, err := store.Issue(40861, "test_admin_12", "job-1", "localhost", 10*time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	return code, delegation
}

func TestExchangeWorksOnceAndHidesTheCode(t *testing.T) {
	store, _ := newTestStore(t)
	code, issued := issueTestDelegation(t, store)

	if !strings.HasPrefix(code, DelegationCodePrefix) || len(code) < 40 {
		t.Fatalf("unexpected code shape: %q", code)
	}
	if issued.UserID != 40861 || issued.JobID != "job-1" {
		t.Fatalf("unexpected delegation: %+v", issued)
	}

	exchanged, err := store.Exchange(code)
	if err != nil || exchanged.ID != issued.ID || exchanged.Username != "test_admin_12" {
		t.Fatalf("first exchange = %+v, %v", exchanged, err)
	}
	if _, err := store.Exchange(code); !errors.Is(err, ErrUnknownDelegation) {
		t.Fatalf("second exchange must fail, got %v", err)
	}
	if _, err := store.Exchange("fsa1_unknown"); !errors.Is(err, ErrUnknownDelegation) {
		t.Fatalf("unknown code must fail, got %v", err)
	}
}

func TestDelegationExpiresAndCanBeRevoked(t *testing.T) {
	store, advance := newTestStore(t)
	code, issued := issueTestDelegation(t, store)

	advance(11 * time.Minute)
	if _, err := store.Exchange(code); !errors.Is(err, ErrUnknownDelegation) {
		t.Fatalf("expired code must fail, got %v", err)
	}
	if _, err := store.Lookup(issued.ID); !errors.Is(err, ErrUnknownDelegation) {
		t.Fatalf("expired delegation must not resolve, got %v", err)
	}

	store2, _ := newTestStore(t)
	_, live := issueTestDelegation(t, store2)
	store2.Revoke(live.ID)
	if _, err := store2.Lookup(live.ID); !errors.Is(err, ErrUnknownDelegation) {
		t.Fatalf("revoked delegation must not resolve, got %v", err)
	}
}

func TestLifetimeNeverExceedsTheMaximum(t *testing.T) {
	store, _ := newTestStore(t)
	_, delegation, err := store.Issue(40861, "test_admin_12", "job-2", "localhost", 24*time.Hour)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if delegation.ExpiresAt.Sub(delegation.IssuedAt) != MaxDelegationLifetime {
		t.Fatalf("lifetime = %s, want %s", delegation.ExpiresAt.Sub(delegation.IssuedAt), MaxDelegationLifetime)
	}
}

func TestIssueRequiresAnAuthenticatedAdministratorAndJob(t *testing.T) {
	store, _ := newTestStore(t)
	for _, testCase := range []struct {
		name     string
		userID   int
		username string
		jobID    string
	}{
		{"guest", 1, "guest", "job"},
		{"missing username", 40861, "  ", "job"},
		{"missing job", 40861, "test_admin_12", " "},
	} {
		if _, _, err := store.Issue(testCase.userID, testCase.username, testCase.jobID, "localhost", time.Minute); err == nil {
			t.Fatalf("%s must be refused", testCase.name)
		}
	}
}

func TestWriteApprovalMatchesMethodPathAndBodyOnce(t *testing.T) {
	store, _ := newTestStore(t)
	_, delegation := issueTestDelegation(t, store)
	body := []byte(`{"id":123,"updates":[{"column":"header","value":"New"}]}`)
	bodyHash := HashRequestBody(body)

	if err := store.Approve(delegation.ID, []ApprovedCall{
		{Method: "post", Path: "/api/update-row", BodyHash: strings.ToUpper(bodyHash)},
	}); err != nil {
		t.Fatalf("Approve: %v", err)
	}

	if err := store.UseWriteApproval(delegation.ID, http.MethodPost, "/api/update-row", HashRequestBody([]byte("{}"))); !errors.Is(err, ErrWriteNotApproved) {
		t.Fatalf("different body must be refused, got %v", err)
	}
	if err := store.UseWriteApproval(delegation.ID, http.MethodPost, "/api/delete-rows", bodyHash); !errors.Is(err, ErrWriteNotApproved) {
		t.Fatalf("different path must be refused, got %v", err)
	}
	if err := store.UseWriteApproval(delegation.ID, http.MethodPost, "/api/update-row", bodyHash); err != nil {
		t.Fatalf("approved call must run: %v", err)
	}
	if err := store.UseWriteApproval(delegation.ID, http.MethodPost, "/api/update-row", bodyHash); !errors.Is(err, ErrWriteNotApproved) {
		t.Fatalf("an approved call must run only once, got %v", err)
	}
}

func TestPendingApprovalsAndInvalidPlans(t *testing.T) {
	store, _ := newTestStore(t)
	_, delegation := issueTestDelegation(t, store)
	bodyHash := HashRequestBody([]byte("{}"))

	for _, invalid := range []ApprovedCall{
		{Method: http.MethodGet, Path: "/api/get-results", BodyHash: bodyHash},
		{Method: http.MethodPost, Path: "/admin/", BodyHash: bodyHash},
		{Method: http.MethodPost, Path: "/api/update-row", BodyHash: "not-a-hash"},
	} {
		if err := store.Approve(delegation.ID, []ApprovedCall{invalid}); err == nil {
			t.Fatalf("invalid plan entry must be refused: %+v", invalid)
		}
	}

	if err := store.Approve(delegation.ID, []ApprovedCall{
		{Method: http.MethodPost, Path: "/api/update-row", BodyHash: bodyHash},
		{Method: http.MethodPost, Path: "/api/delete-rows", BodyHash: bodyHash},
	}); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if err := store.UseWriteApproval(delegation.ID, http.MethodPost, "/api/update-row", bodyHash); err != nil {
		t.Fatalf("approved call: %v", err)
	}
	pending, err := store.PendingApprovals(delegation.ID)
	if err != nil || len(pending) != 1 || pending[0].Path != "/api/delete-rows" {
		t.Fatalf("pending = %+v, %v", pending, err)
	}
}

func TestRequestIsWriteCoversReadMethods(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions, ""} {
		if RequestIsWrite(method) {
			t.Fatalf("%q must count as a read", method)
		}
	}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		if !RequestIsWrite(method) {
			t.Fatalf("%q must count as a write", method)
		}
	}
}
