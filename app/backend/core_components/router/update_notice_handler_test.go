// update_notice_handler_test.go
// Verifies fixed update-notice transitions, manager authorization, and bounded admin streaming.
// Bridges lifecycle requests, persistent snapshots, and the no-transaction admin SSE contract.
// Exists to prevent conflicting notices, stale clears, or missed cross-instance state changes.

package router

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
)

func fixedUpdateNoticeRequest(state, noticeID, startsAt, expiresAt string) productionUpdateNoticeRequest {
	request := productionUpdateNoticeRequest{
		SchemaVersion: productionUpdateNoticeSchemaVersion,
		NoticeID:      noticeID,
		State:         state,
	}
	if startsAt != "" {
		request.StartsAt = &startsAt
	}
	if expiresAt != "" {
		request.ExpiresAt = &expiresAt
	}
	return request
}

func emptyProductionUpdateNotice() productionUpdateNotice {
	return productionUpdateNotice{
		SchemaVersion: productionUpdateNoticeSchemaVersion,
		State:         productionUpdateNoticeCleared,
	}
}

func TestProductionUpdateNoticeTransitionsAreIdempotentAndConflictSafe(t *testing.T) {
	now := time.Date(2026, time.August, 24, 10, 0, 0, 0, time.UTC)
	startsAt := now.Add(10 * time.Minute).Format(time.RFC3339)
	expiresAt := now.Add(70 * time.Minute).Format(time.RFC3339)
	announce := fixedUpdateNoticeRequest(productionUpdateNoticeAnnounced, "deploy-8408-a", startsAt, expiresAt)

	announced, changed, err := transitionProductionUpdateNotice(emptyProductionUpdateNotice(), announce, now)
	if err != nil || !changed || announced.State != productionUpdateNoticeAnnounced {
		t.Fatalf("announce transition = (%+v, %v, %v), want changed announced state", announced, changed, err)
	}

	same, changed, err := transitionProductionUpdateNotice(announced, announce, now.Add(time.Second))
	if err != nil || changed || same != announced {
		t.Fatalf("idempotent announce = (%+v, %v, %v), want unchanged", same, changed, err)
	}

	changedStartsAt := now.Add(20 * time.Minute).Format(time.RFC3339)
	conflicting := fixedUpdateNoticeRequest(productionUpdateNoticeAnnounced, "deploy-8408-a", changedStartsAt, expiresAt)
	if _, _, err := transitionProductionUpdateNotice(announced, conflicting, now); !errors.Is(err, errProductionUpdateNoticeConflict) {
		t.Fatalf("schedule mutation error = %v, want conflict", err)
	}

	drain := fixedUpdateNoticeRequest(productionUpdateNoticeDraining, "deploy-8408-a", startsAt, expiresAt)
	draining, changed, err := transitionProductionUpdateNotice(announced, drain, now.Add(2*time.Minute))
	if err != nil || !changed || draining.State != productionUpdateNoticeDraining {
		t.Fatalf("drain transition = (%+v, %v, %v), want changed draining state", draining, changed, err)
	}

	wrongClear := fixedUpdateNoticeRequest(productionUpdateNoticeCleared, "other-deploy", "", "")
	if _, _, err := transitionProductionUpdateNotice(draining, wrongClear, now); !errors.Is(err, errProductionUpdateNoticeConflict) {
		t.Fatalf("wrong-id clear error = %v, want conflict", err)
	}

	clear := fixedUpdateNoticeRequest(productionUpdateNoticeCleared, "deploy-8408-a", "", "")
	cleared, changed, err := transitionProductionUpdateNotice(draining, clear, now.Add(3*time.Minute))
	if err != nil || !changed || cleared.State != productionUpdateNoticeCleared {
		t.Fatalf("clear transition = (%+v, %v, %v), want changed cleared state", cleared, changed, err)
	}
}

func TestProductionUpdateNoticeExpiryIsReadOnlyFailSoft(t *testing.T) {
	now := time.Date(2026, time.August, 24, 10, 0, 0, 0, time.UTC)
	original := productionUpdateNotice{
		SchemaVersion: productionUpdateNoticeSchemaVersion,
		NoticeID:      "deploy-expired",
		State:         productionUpdateNoticeAnnounced,
		AnnouncedAt:   now.Add(-2 * time.Hour).Format(time.RFC3339),
		StartsAt:      now.Add(-90 * time.Minute).Format(time.RFC3339),
		ExpiresAt:     now.Add(-time.Minute).Format(time.RFC3339),
		UpdatedAt:     now.Add(-2 * time.Hour).Format(time.RFC3339),
	}

	effective := effectiveProductionUpdateNotice(original, now)
	if effective.State != productionUpdateNoticeCleared {
		t.Fatalf("effective expired state = %q, want cleared", effective.State)
	}
	if original.State != productionUpdateNoticeAnnounced {
		t.Fatal("expiry projection mutated persistent source value")
	}

	reusedStartsAt := now.Add(time.Minute).Format(time.RFC3339)
	reusedExpiresAt := now.Add(time.Hour).Format(time.RFC3339)
	reused := fixedUpdateNoticeRequest(productionUpdateNoticeAnnounced, original.NoticeID, reusedStartsAt, reusedExpiresAt)
	if _, _, err := transitionProductionUpdateNotice(original, reused, now); !errors.Is(err, errProductionUpdateNoticeConflict) {
		t.Fatalf("expired notice ID reuse error = %v, want conflict", err)
	}
}

func TestDecodeProductionUpdateNoticeRejectsOperatorTextAndInvalidClearShape(t *testing.T) {
	now := time.Date(2026, time.August, 24, 10, 0, 0, 0, time.UTC)
	originalNow := productionUpdateNoticeNow
	productionUpdateNoticeNow = func() time.Time { return now }
	t.Cleanup(func() { productionUpdateNoticeNow = originalNow })

	unknownFieldRequest := httptest.NewRequest(http.MethodPost, "/system/update-notice", strings.NewReader(`{
		"schema_version":1,"notice_id":"deploy-a","state":"cleared","message":"untrusted html"
	}`))
	if _, err := decodeProductionUpdateNoticeRequest(httptest.NewRecorder(), unknownFieldRequest); err == nil {
		t.Fatal("operator-authored message field should be rejected")
	}

	startsAt := now.Add(time.Minute).Format(time.RFC3339)
	badClear := fixedUpdateNoticeRequest(productionUpdateNoticeCleared, "deploy-a", startsAt, "")
	if err := validateProductionUpdateNoticeRequest(badClear, now); err == nil {
		t.Fatal("clear request with starts_at should be rejected")
	}
}

func TestSystemUpdateNoticeHandlerRequiresManagerGuardAndMapsConflict(t *testing.T) {
	const managerToken = "12345678901234567890123456789012"
	t.Setenv("EASELECT_SYSTEM_MANAGER_TOKEN", managerToken)
	t.Setenv("EASELECT_SYSTEM_MANAGER_TRUSTED_PEER_IP", "")
	now := time.Date(2026, time.August, 24, 10, 0, 0, 0, time.UTC)
	originalNow := productionUpdateNoticeNow
	originalApply := applyProductionUpdateNotice
	productionUpdateNoticeNow = func() time.Time { return now }
	t.Cleanup(func() {
		productionUpdateNoticeNow = originalNow
		applyProductionUpdateNotice = originalApply
	})

	body := `{"schema_version":1,"notice_id":"deploy-a","state":"cleared"}`
	unauthorized := httptest.NewRequest(http.MethodPost, "/system/update-notice", strings.NewReader(body))
	unauthorized.RemoteAddr = "127.0.0.1:1234"
	unauthorizedRecorder := httptest.NewRecorder()
	systemUpdateNoticeHandler(unauthorizedRecorder, unauthorized)
	if unauthorizedRecorder.Code != http.StatusForbidden {
		t.Fatalf("unauthorized status = %d, want 403", unauthorizedRecorder.Code)
	}

	applyProductionUpdateNotice = func(context.Context, productionUpdateNoticeRequest, time.Time) (productionUpdateNoticeSnapshot, bool, error) {
		return productionUpdateNoticeSnapshot{}, false, errProductionUpdateNoticeConflict
	}
	authorized := httptest.NewRequest(http.MethodPost, "/system/update-notice", strings.NewReader(body))
	authorized.RemoteAddr = "127.0.0.1:1234"
	authorized.Header.Set("Authorization", "Bearer "+managerToken)
	authorizedRecorder := httptest.NewRecorder()
	systemUpdateNoticeHandler(authorizedRecorder, authorized)
	if authorizedRecorder.Code != http.StatusConflict {
		t.Fatalf("conflict status = %d, want 409", authorizedRecorder.Code)
	}
}

func TestSystemUpdateNoticeHandlerAcceptsExactIdempotentJSON(t *testing.T) {
	const managerToken = "12345678901234567890123456789012"
	t.Setenv("EASELECT_SYSTEM_MANAGER_TOKEN", managerToken)
	t.Setenv("EASELECT_SYSTEM_MANAGER_TRUSTED_PEER_IP", "")
	now := time.Date(2026, time.August, 24, 10, 0, 0, 0, time.UTC)
	originalNow := productionUpdateNoticeNow
	originalApply := applyProductionUpdateNotice
	productionUpdateNoticeNow = func() time.Time { return now }
	applyCalls := 0
	applyProductionUpdateNotice = func(_ context.Context, request productionUpdateNoticeRequest, receivedNow time.Time) (productionUpdateNoticeSnapshot, bool, error) {
		applyCalls++
		if request.State != productionUpdateNoticeAnnounced || receivedNow != now {
			t.Fatalf("apply request = (%+v, %v), want announced at fixed server time", request, receivedNow)
		}
		return productionUpdateNoticeSnapshot{
			productionUpdateNotice: productionUpdateNotice{
				SchemaVersion: productionUpdateNoticeSchemaVersion,
				NoticeID:      request.NoticeID,
				State:         request.State,
			},
			ServerTime: now.Format(time.RFC3339),
		}, false, nil
	}
	t.Cleanup(func() {
		productionUpdateNoticeNow = originalNow
		applyProductionUpdateNotice = originalApply
	})

	body := `{"schema_version":1,"notice_id":"deploy-a","state":"announced","starts_at":"2026-08-24T10:10:00Z","expires_at":"2026-08-24T11:00:00Z"}`
	request := httptest.NewRequest(http.MethodPost, "/system/update-notice", strings.NewReader(body))
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("Authorization", "Bearer "+managerToken)
	recorder := httptest.NewRecorder()
	systemUpdateNoticeHandler(recorder, request)
	if recorder.Code != http.StatusOK || applyCalls != 1 {
		t.Fatalf("idempotent handler = status %d, apply calls %d; want 200 and one apply", recorder.Code, applyCalls)
	}
	if !strings.Contains(recorder.Body.String(), `"server_time":"2026-08-24T10:00:00Z"`) {
		t.Fatalf("response body = %q, want server timestamp", recorder.Body.String())
	}

	invalid := httptest.NewRequest(http.MethodPost, "/system/update-notice", strings.NewReader(strings.TrimSuffix(body, "}")+`,"message":"operator text"}`))
	invalid.RemoteAddr = "127.0.0.1:1234"
	invalid.Header.Set("Authorization", "Bearer "+managerToken)
	invalidRecorder := httptest.NewRecorder()
	systemUpdateNoticeHandler(invalidRecorder, invalid)
	if invalidRecorder.Code != http.StatusBadRequest || applyCalls != 1 {
		t.Fatalf("invalid JSON shape = status %d, apply calls %d; want 400 and no apply", invalidRecorder.Code, applyCalls)
	}
}

func TestAdminUpdateNoticeStreamSnapshotsPersistentStateAndRechecksAdmin(t *testing.T) {
	originalRead := readProductionUpdateNotice
	originalAdminOK := productionUpdateNoticeAdminOK
	originalHeartbeat := productionUpdateNoticeHeartbeat
	originalSnapshotInterval := productionUpdateNoticeSnapshotInterval
	originalRecheck := productionUpdateNoticeRecheck
	originalLifetime := productionUpdateNoticeLifetime
	t.Cleanup(func() {
		readProductionUpdateNotice = originalRead
		productionUpdateNoticeAdminOK = originalAdminOK
		productionUpdateNoticeHeartbeat = originalHeartbeat
		productionUpdateNoticeSnapshotInterval = originalSnapshotInterval
		productionUpdateNoticeRecheck = originalRecheck
		productionUpdateNoticeLifetime = originalLifetime
	})

	readCount := 0
	readProductionUpdateNotice = func(context.Context, time.Time) (productionUpdateNoticeSnapshot, error) {
		readCount++
		state := productionUpdateNoticeAnnounced
		if readCount > 1 {
			state = productionUpdateNoticeDraining
		}
		return productionUpdateNoticeSnapshot{
			productionUpdateNotice: productionUpdateNotice{
				SchemaVersion: productionUpdateNoticeSchemaVersion,
				NoticeID:      "two-node-deploy",
				State:         state,
			},
			ServerTime: "2026-08-24T10:00:00Z",
		}, nil
	}
	productionUpdateNoticeAdminOK = func(context.Context, int) (bool, error) { return true, nil }
	productionUpdateNoticeHeartbeat = time.Hour
	productionUpdateNoticeSnapshotInterval = time.Millisecond
	productionUpdateNoticeRecheck = time.Hour
	productionUpdateNoticeLifetime = 5 * time.Millisecond

	request := httptest.NewRequest(http.MethodGet, "/api/admin/update-notice/stream", nil)
	request = request.WithContext(dbutils.SetRequestActorContext(
		request.Context(),
		dbutils.NewRequestActorContext(42, "admin"),
	))
	recorder := httptest.NewRecorder()
	adminUpdateNoticeStreamHandler(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("stream status = %d, want 200", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `"state":"announced"`) ||
		!strings.Contains(recorder.Body.String(), `"state":"draining"`) {
		t.Fatalf("stream body = %q, want immediate and periodic persistent snapshots", recorder.Body.String())
	}

	productionUpdateNoticeSnapshotInterval = time.Hour
	productionUpdateNoticeRecheck = time.Millisecond
	productionUpdateNoticeLifetime = 20 * time.Millisecond
	productionUpdateNoticeAdminOK = func(context.Context, int) (bool, error) { return false, nil }
	revokedRequest := httptest.NewRequest(http.MethodGet, "/api/admin/update-notice/stream", nil)
	revokedRequest = revokedRequest.WithContext(dbutils.SetRequestActorContext(
		revokedRequest.Context(),
		dbutils.NewRequestActorContext(42, "admin"),
	))
	revokedRecorder := httptest.NewRecorder()
	adminUpdateNoticeStreamHandler(revokedRecorder, revokedRequest)
	if !strings.Contains(revokedRecorder.Body.String(), "event: access_revoked") {
		t.Fatalf("revoked stream body = %q, want access_revoked", revokedRecorder.Body.String())
	}
}

func TestAdminUpdateNoticeStreamRejectsMissingAdminActor(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/admin/update-notice/stream", nil)
	recorder := httptest.NewRecorder()
	adminUpdateNoticeStreamHandler(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
}

func TestProductionUpdateNoticeAdminRecheckRequiresEnabledAdminMember(t *testing.T) {
	originalReadFlags := readProductionUpdateNoticeAdminFlags
	t.Cleanup(func() { readProductionUpdateNoticeAdminFlags = originalReadFlags })

	tests := []struct {
		name          string
		enabled       bool
		adminAllowed  bool
		adminsMember  bool
		wantPermitted bool
	}{
		{name: "all current", enabled: true, adminAllowed: true, adminsMember: true, wantPermitted: true},
		{name: "disabled", enabled: false, adminAllowed: true, adminsMember: true},
		{name: "admin access revoked", enabled: true, adminAllowed: false, adminsMember: true},
		{name: "admin group removed", enabled: true, adminAllowed: true, adminsMember: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			readProductionUpdateNoticeAdminFlags = func(context.Context, int) (bool, bool, bool, error) {
				return test.enabled, test.adminAllowed, test.adminsMember, nil
			}
			permitted, err := productionUpdateNoticeAdminStillAllowed(context.Background(), 42)
			if err != nil || permitted != test.wantPermitted {
				t.Fatalf("admin recheck = (%v, %v), want (%v, nil)", permitted, err, test.wantPermitted)
			}
		})
	}
}

func TestDrainCancelsBothSSESurfaces(t *testing.T) {
	resetSystemDesiredStateForTest(t)
	for _, path := range []string{"/api/sse/subscribe", "/api/admin/update-notice/stream"} {
		t.Run(path, func(t *testing.T) {
			setSystemDesiredState(systemDesiredStateActive)
			request := httptest.NewRequest(http.MethodGet, path, nil)
			accepted, admittedRequest, cleanup := admitSystemAPIRequest(request)
			if !accepted {
				t.Fatalf("%s was not admitted before drain", path)
			}

			setSystemDesiredState(systemDesiredStateDraining)
			select {
			case <-admittedRequest.Context().Done():
			case <-time.After(time.Second):
				cleanup()
				t.Fatalf("%s was not canceled by drain", path)
			}
			cleanup()
			if got := currentSystemActiveAPIRequests(); got != 0 {
				t.Fatalf("active requests after canceling %s = %d, want 0", path, got)
			}
		})
	}
}

func TestProductionUpdateNoticeSnapshotJSONUsesFixedServerTimeKey(t *testing.T) {
	snapshot := snapshotProductionUpdateNotice(emptyProductionUpdateNotice(), time.Date(2026, 8, 24, 10, 0, 0, 0, time.UTC))
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"schema_version", "notice_id", "state", "announced_at", "starts_at", "expires_at", "updated_at", "server_time"} {
		if !strings.Contains(string(encoded), `"`+key+`"`) {
			t.Fatalf("snapshot JSON %s missing fixed key %q", encoded, key)
		}
	}
}
