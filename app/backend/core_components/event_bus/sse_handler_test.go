// sse_handler_test.go
// Verifies dataset, row and sign-in boundaries of the generic SSE stream.
// Bridges injected keepalive ticks and in-memory authentication records with HTTP frames.
// Exists so an ended sign-in cannot keep receiving dataset mutation metadata.

package event_bus

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/sign_in_deadline"
	"easelect/backend/core_components/sign_in_revocation"

	"github.com/gorilla/sessions"
)

func TestShouldForwardSSEEventFailsClosedPerRow(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/sse/subscribe?datasets=orders", nil)
	allowedEvent := Event{Table: "orders", RowID: 7, Action: "update"}
	deniedEvent := Event{Table: "orders", RowID: 8, Action: "update"}

	if shouldForwardSSEEvent(request, allowedEvent, nil) {
		t.Fatal("missing row event authorizer must fail closed")
	}
	authorize := func(_ *http.Request, event Event) (bool, error) {
		return event.RowID == 7, nil
	}
	if !shouldForwardSSEEvent(request, allowedEvent, authorize) {
		t.Fatal("authorized row event should be forwarded")
	}
	if shouldForwardSSEEvent(request, deniedEvent, authorize) {
		t.Fatal("denied row event must not be forwarded")
	}
	if shouldForwardSSEEvent(
		request,
		allowedEvent,
		func(*http.Request, Event) (bool, error) {
			return false, errors.New("permission backend unavailable")
		},
	) {
		t.Fatal("row event authorization errors must fail closed")
	}
}

func TestSSESubscribeHandlerRejectsReservedInternalTopic(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/sse/subscribe?datasets="+InternalUpdateNoticeTopic, nil)
	recorder := httptest.NewRecorder()

	SSESubscribeHandler(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}

func TestSSESubscribeHandlerRejectsMixedAllowedAndForbiddenBeforeSubscribing(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/sse/subscribe?datasets=allowed,forbidden", nil)
	recorder := httptest.NewRecorder()
	subscribeCalls := 0

	serveSSESubscription(
		recorder,
		request,
		func(_ *http.Request, dataset string) (int, error) {
			if dataset == "forbidden" {
				return http.StatusForbidden, nil
			}
			return 0, nil
		},
		func(string) (<-chan Event, func()) {
			subscribeCalls++
			return make(chan Event), func() {}
		},
		nil,
		nil,
		nil,
	)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
	if subscribeCalls != 0 {
		t.Fatalf("subscribe calls = %d, want 0", subscribeCalls)
	}
}

func TestSSESubscribeHandlerRejectsMissingDatasetBeforeSubscribing(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/sse/subscribe?datasets=allowed,missing", nil)
	recorder := httptest.NewRecorder()
	subscribeCalls := 0

	serveSSESubscription(
		recorder,
		request,
		func(_ *http.Request, dataset string) (int, error) {
			if dataset == "missing" {
				return http.StatusNotFound, nil
			}
			return 0, nil
		},
		func(string) (<-chan Event, func()) {
			subscribeCalls++
			return make(chan Event), func() {}
		},
		nil,
		nil,
		nil,
	)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
	if subscribeCalls != 0 {
		t.Fatalf("subscribe calls = %d, want 0", subscribeCalls)
	}
}

func TestIsReservedInternalTopicMatchesOnlyExactTopic(t *testing.T) {
	if !IsReservedInternalTopic("  " + InternalUpdateNoticeTopic + "  ") {
		t.Fatal("exact internal topic should be reserved")
	}
	if IsReservedInternalTopic("system_users") {
		t.Fatal("ordinary dataset should not be reserved")
	}
}

// The production validator asks the real shared authentication functions. This
// driver supplies their database answers in memory, with a controllable clock;
// no database server or network is involved.
type sseSignInFixture struct {
	mu         sync.Mutex
	now        time.Time
	enabled    bool
	revoked    bool
	generation int64
	failure    bool
}

type sseSignInDriver struct{ fixture *sseSignInFixture }
type sseSignInConn struct{ fixture *sseSignInFixture }
type sseSignInRows struct {
	names  []string
	values []driver.Value
	done   bool
}

func (d sseSignInDriver) Open(string) (driver.Conn, error)   { return &sseSignInConn{d.fixture}, nil }
func (c *sseSignInConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("unused") }
func (c *sseSignInConn) Close() error                        { return nil }
func (c *sseSignInConn) Begin() (driver.Tx, error)           { return nil, errors.New("unused") }
func (r *sseSignInRows) Columns() []string                   { return r.names }
func (r *sseSignInRows) Close() error                        { return nil }
func (r *sseSignInRows) Next(values []driver.Value) error {
	if r.done {
		return io.EOF
	}
	copy(values, r.values)
	r.done = true
	return nil
}

func (c *sseSignInConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.fixture.mu.Lock()
	defer c.fixture.mu.Unlock()
	if c.fixture.failure {
		return nil, errors.New("authentication database unavailable")
	}
	switch {
	case strings.Contains(query, "public.system_revoked_sign_ins"):
		deadline := args[1].Value.(int64)
		unlimited := args[2].Value.(bool)
		usable := (unlimited || c.fixture.now.Before(time.Unix(deadline, 0))) && !c.fixture.revoked
		return &sseSignInRows{names: []string{"usable"}, values: []driver.Value{usable}}, nil
	case strings.Contains(query, "SELECT ur.authentication_generation"):
		return &sseSignInRows{names: []string{"authentication_generation", "surviving_sign_in_id", "surviving_sign_in_generation"},
			values: []driver.Value{c.fixture.generation, nil, nil}, done: !c.fixture.enabled}, nil
	case strings.Contains(query, "FROM system_config") && args[0].Value == "only_admin_can_login":
		return &sseSignInRows{names: []string{"boolean_value"}, values: []driver.Value{false}}, nil
	default:
		return nil, fmt.Errorf("unexpected authentication query: %s", query)
	}
}

var sseSignInDriverCounter atomic.Int64

func sseSessionRequest(t *testing.T, userID int) (*http.Request, *sseSignInFixture) {
	t.Helper()
	fixture := &sseSignInFixture{
		now: time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC), enabled: true, generation: 1,
	}
	driverName := fmt.Sprintf("sse_sign_in_%d", sseSignInDriverCounter.Add(1))
	sql.Register(driverName, sseSignInDriver{fixture})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatal(err)
	}
	originalDB, originalConfidential := backend.Db, backend.DbConfidential
	originalStore, originalName := e_sessions.Store, e_sessions.SessionName
	backend.Db, backend.DbConfidential = db, db
	e_sessions.Store = sessions.NewCookieStore([]byte("sse-session-test-signing-key-32bytes"))
	e_sessions.SessionName = "sse_test_session"
	t.Cleanup(func() {
		backend.Db, backend.DbConfidential = originalDB, originalConfidential
		e_sessions.Store, e_sessions.SessionName = originalStore, originalName
		_ = db.Close()
	})

	request := httptest.NewRequest(http.MethodGet, "/api/sse/subscribe?datasets=orders", nil)
	session, err := e_sessions.Load(request)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"] = userID
	if userID > 1 {
		session.Values[auth_generation.SessionKey] = int64(1)
		session.Values[sign_in_revocation.SessionKey] = "this-browsers-sign-in"
		session.Values[sign_in_deadline.SessionKey] = fixture.now.Add(time.Hour).Unix()
		session.Values["device_id"] = "this-device"
		session.Values["fingerprint_hash"] = "this-fingerprint"
		request.AddCookie(&http.Cookie{Name: e_sessions.DeviceIDCookieName(), Value: "this-device"})
		request.AddCookie(&http.Cookie{Name: e_sessions.FingerprintCookieName(), Value: "this-fingerprint"})
	}
	return request, fixture
}

type sseFrameRecorder struct {
	*httptest.ResponseRecorder
	frame  strings.Builder
	frames chan string
}

func (r *sseFrameRecorder) Write(data []byte) (int, error) {
	_, _ = r.frame.Write(data)
	return r.ResponseRecorder.Write(data)
}

func (r *sseFrameRecorder) Flush() {
	r.ResponseRecorder.Flush()
	r.frames <- r.frame.String()
	r.frame.Reset()
}

type sseTestStream struct {
	recorder     *sseFrameRecorder
	ticks        chan time.Time
	events       chan Event
	done         chan struct{}
	unsubscribed atomic.Int32
}

func startSSETestStream(t *testing.T, request *http.Request, validator sseSessionValidator, authorize sseEventAuthorizer) *sseTestStream {
	t.Helper()
	ctx, cancel := context.WithCancel(request.Context())
	stream := &sseTestStream{
		recorder: &sseFrameRecorder{ResponseRecorder: httptest.NewRecorder(), frames: make(chan string, 16)},
		ticks:    make(chan time.Time), events: make(chan Event, 4), done: make(chan struct{}),
	}
	go func() {
		defer close(stream.done)
		serveSSESubscription(stream.recorder, request.WithContext(ctx),
			func(*http.Request, string) (int, error) { return 0, nil },
			func(string) (<-chan Event, func()) {
				return stream.events, func() { stream.unsubscribed.Add(1) }
			}, authorize, validator, stream.ticks)
	}()
	t.Cleanup(func() {
		cancel()
		waitForSSEStreamEnd(t, stream)
	})
	if frame := nextSSEFrame(t, stream); frame != ": connected\n\n" {
		t.Fatalf("initial frame = %q", frame)
	}
	return stream
}

func nextSSEFrame(t *testing.T, stream *sseTestStream) string {
	t.Helper()
	select {
	case frame := <-stream.recorder.frames:
		return frame
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for SSE frame")
		return ""
	}
}

func waitForSSEStreamEnd(t *testing.T, stream *sseTestStream) {
	t.Helper()
	select {
	case <-stream.done:
	case <-time.After(time.Second):
		t.Fatal("SSE stream did not end")
	}
}

func sendSSETestTick(t *testing.T, stream *sseTestStream) {
	t.Helper()
	select {
	case stream.ticks <- time.Time{}:
	case <-time.After(time.Second):
		t.Fatal("SSE stream did not accept keepalive tick")
	}
}

func assertSSESessionEnded(t *testing.T, stream *sseTestStream) {
	t.Helper()
	if frame := nextSSEFrame(t, stream); frame != "event: session_ended\ndata:\n\n" {
		t.Fatalf("final frame = %q, want empty session_ended event", frame)
	}
	waitForSSEStreamEnd(t, stream)
	if got := stream.unsubscribed.Load(); got != 1 {
		t.Fatalf("unsubscribe calls = %d, want 1", got)
	}
	if body := stream.recorder.Body.String(); strings.Count(body, "event: session_ended") != 1 || strings.Contains(body, "event: row_change") {
		t.Fatalf("ended stream must send one final event and no row event: %q", body)
	}
}

func TestSSEValidSignInStaysOpenAcrossTicks(t *testing.T) {
	request, _ := sseSessionRequest(t, 42)
	stream := startSSETestStream(t, request, validateSSESession, func(*http.Request, Event) (bool, error) { return true, nil })
	for range 3 {
		sendSSETestTick(t, stream)
		if frame := nextSSEFrame(t, stream); frame != ": keepalive\n\n" {
			t.Fatalf("valid sign-in frame = %q", frame)
		}
	}
	stream.events <- Event{Table: "orders", RowID: 7, Action: "update"}
	if frame := nextSSEFrame(t, stream); !strings.HasPrefix(frame, "event: row_change\n") {
		t.Fatalf("valid sign-in lost row event: %q", frame)
	}
	select {
	case <-stream.done:
		t.Fatal("valid sign-in closed the stream")
	default:
	}
}

func TestSSEEndedSignInClosesOnNextTickOrRowEvent(t *testing.T) {
	for _, cause := range []string{"expired deadline", "revoked sign-in", "disabled account", "changed generation", "authentication read failure"} {
		for _, trigger := range []string{"keepalive", "row event"} {
			t.Run(cause+"/"+trigger, func(t *testing.T) {
				request, fixture := sseSessionRequest(t, 42)
				stream := startSSETestStream(t, request, validateSSESession, func(*http.Request, Event) (bool, error) {
					return true, nil
				})
				sendSSETestTick(t, stream)
				if frame := nextSSEFrame(t, stream); frame != ": keepalive\n\n" {
					t.Fatalf("sign-in was not valid before ending: %q", frame)
				}
				fixture.mu.Lock()
				switch cause {
				case "expired deadline":
					fixture.now = fixture.now.Add(time.Hour) // Equality is already expired.
				case "revoked sign-in":
					fixture.revoked = true
				case "disabled account":
					fixture.enabled = false
				case "changed generation":
					fixture.generation++
				case "authentication read failure":
					fixture.failure = true
				}
				fixture.mu.Unlock()
				if trigger == "keepalive" {
					sendSSETestTick(t, stream)
				} else {
					stream.events <- Event{Table: "orders", RowID: 7, Action: "update"}
				}
				assertSSESessionEnded(t, stream)
			})
		}
	}
}

func TestSSEGuestStreamDoesNotAcquireSignInChecks(t *testing.T) {
	request, fixture := sseSessionRequest(t, 1)
	fixture.failure = true // Guest checks must never ask the authentication store.
	stream := startSSETestStream(t, request, validateSSESession, func(*http.Request, Event) (bool, error) { return true, nil })
	for range 3 {
		sendSSETestTick(t, stream)
		if frame := nextSSEFrame(t, stream); frame != ": keepalive\n\n" {
			t.Fatalf("guest frame = %q", frame)
		}
	}
	stream.events <- Event{Table: "orders", RowID: 7, Action: "update"}
	if frame := nextSSEFrame(t, stream); !strings.HasPrefix(frame, "event: row_change\n") {
		t.Fatalf("guest lost row event: %q", frame)
	}
}

func TestSSEStreamPreservesExactRowDenials(t *testing.T) {
	request, _ := sseSessionRequest(t, 42)
	stream := startSSETestStream(t, request, validateSSESession, func(_ *http.Request, event Event) (bool, error) {
		return event.RowID == 7, nil
	})
	stream.events <- Event{Table: "orders", RowID: 8, Action: "update"}
	stream.events <- Event{Table: "orders", RowID: 7, Action: "update"}
	frame := nextSSEFrame(t, stream)
	if !strings.HasPrefix(frame, "event: row_change\n") || !strings.Contains(frame, `"row_id":7`) {
		t.Fatalf("stream forwarded a denied row: %q", frame)
	}
}

func TestSSESignInEndingDuringRowAuthorizationSuppressesQueuedEvents(t *testing.T) {
	request, fixture := sseSessionRequest(t, 42)
	stream := startSSETestStream(t, request, validateSSESession, func(*http.Request, Event) (bool, error) {
		// A row read may wait while the sign-in is revoked elsewhere. The
		// final check must see that change even though row access was granted.
		fixture.mu.Lock()
		fixture.revoked = true
		fixture.mu.Unlock()
		return true, nil
	})
	stream.events <- Event{Table: "orders", RowID: 7, Action: "update"}
	stream.events <- Event{Table: "orders", RowID: 8, Action: "update"}
	assertSSESessionEnded(t, stream)
}

func TestSSESessionReusesBrowserBindingChecks(t *testing.T) {
	for _, key := range []string{"device_id", "fingerprint_hash"} {
		t.Run(key, func(t *testing.T) {
			request, _ := sseSessionRequest(t, 42)
			session, err := e_sessions.Load(request)
			if err != nil {
				t.Fatal(err)
			}
			session.Values[key] = "another-browser"
			stream := startSSETestStream(t, request, validateSSESession, nil)
			sendSSETestTick(t, stream)
			assertSSESessionEnded(t, stream)
		})
	}
}

func TestSSEMissingSessionValidatorFailsClosed(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/sse/subscribe?datasets=orders", nil)
	stream := startSSETestStream(t, request, nil, nil)
	sendSSETestTick(t, stream)
	assertSSESessionEnded(t, stream)
}
