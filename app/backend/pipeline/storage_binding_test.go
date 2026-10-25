// storage_binding_test.go
// Proves downgrade traces are per-user, bounded and limited to the server log.
// Connects the storage stage's cookie downgrade to its in-memory trace limiter.
// Prevents pre-rate-limit requests from producing an unbounded log or identity map.
package pipeline

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/securecookie"
	"github.com/gorilla/sessions"
)

func TestStorageBindingDowngradeTraceIsThrottledPerUser(t *testing.T) {
	previousStore, previousName := e_sessions.Store, e_sessions.SessionName
	previousTrace, previousOutput := storageBindingTrace, log.Writer()
	e_sessions.Store = sessions.NewCookieStore(bytes.Repeat([]byte{7}, 32))
	e_sessions.SessionName = "storage-binding-test"
	storageBindingTrace = &storageBindingTraceLimiter{}
	var output bytes.Buffer
	log.SetOutput(&output)
	t.Cleanup(func() {
		e_sessions.Store, e_sessions.SessionName = previousStore, previousName
		storageBindingTrace = previousTrace
		log.SetOutput(previousOutput)
	})

	next := func(w http.ResponseWriter, r *http.Request) {
		session, err := e_sessions.Load(r)
		if err != nil || len(session.Values) != 0 || r.Header.Get("Cookie") != "" {
			t.Fatal("downgrade retained the signed-in session or cookies")
		}
		w.WriteHeader(http.StatusNoContent)
	}
	handler := withStorageBinding(next, RouteContext{})
	for _, userID := range []int{42, 42, 43} {
		values := map[interface{}]interface{}{
			"user_id": userID, "authenticated": true,
			"device_id": "stored-device", "fingerprint_hash": "stored-fingerprint",
		}
		encoded, err := securecookie.EncodeMulti(e_sessions.SessionName, values, e_sessions.Store.Codecs...)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodGet, "/storage/service_catalog_logos/public.png", nil)
		request.AddCookie(&http.Cookie{Name: e_sessions.SessionName, Value: encoded})
		response := httptest.NewRecorder()
		handler(response, request)
		if response.Code != http.StatusNoContent || len(response.Header()) != 0 || response.Body.Len() != 0 {
			t.Fatal("server-side tracing changed the response")
		}
	}
	trace := output.String()
	if strings.Count(trace, "user_id=42\n") != 1 || strings.Count(trace, "user_id=43\n") != 1 || strings.Count(trace, "\n") != 2 {
		t.Fatal("repeated downgrades must log once per user within the interval")
	}
	for _, privateValue := range []string{"public.png", "stored-device", "stored-fingerprint", "Cookie"} {
		if strings.Contains(trace, privateValue) {
			t.Fatal("trace contains more than the user ID")
		}
	}
}

func TestStorageBindingTraceIntervalDoesNotSlide(t *testing.T) {
	limiter := &storageBindingTraceLimiter{}
	now := time.Now()
	if !limiter.allow(42, now) || limiter.allow(42, now.Add(storageBindingTraceInterval-time.Nanosecond)) {
		t.Fatal("same user was not throttled within the interval")
	}
	if !limiter.allow(43, now.Add(time.Second)) || !limiter.allow(42, now.Add(storageBindingTraceInterval)) {
		t.Fatal("different user or exact expiry was suppressed")
	}
	if limiter.allow(42, now.Add(storageBindingTraceInterval+time.Second)) {
		t.Fatal("renewed interval did not throttle the user")
	}
}

func TestStorageBindingTraceCapacityAndExpiry(t *testing.T) {
	limiter := &storageBindingTraceLimiter{}
	now := time.Now()
	for userID := 2; userID < storageBindingTraceMaxUsers+2; userID++ {
		if !limiter.allow(userID, now) {
			t.Fatal("trace map filled before its capacity")
		}
	}
	for userID := storageBindingTraceMaxUsers + 2; userID < 2*storageBindingTraceMaxUsers+2; userID++ {
		if limiter.allow(userID, now.Add(time.Second)) {
			t.Fatal("full map admitted another user before expiry")
		}
	}
	if len(limiter.expires) != storageBindingTraceMaxUsers || limiter.allow(2, now.Add(time.Second)) {
		t.Fatal("saturation grew the map or evicted a live user's interval")
	}
	if !limiter.allow(2*storageBindingTraceMaxUsers+2, now.Add(storageBindingTraceInterval)) || len(limiter.expires) != 1 {
		t.Fatal("expired entries were not reclaimed")
	}
}

func TestStorageBindingTraceConcurrentRequestsLogOnce(t *testing.T) {
	limiter := &storageBindingTraceLimiter{}
	now := time.Now()
	var requests sync.WaitGroup
	var admitted atomic.Int32
	for i := 0; i < 64; i++ {
		requests.Go(func() {
			if limiter.allow(42, now) {
				admitted.Add(1)
			}
		})
	}
	requests.Wait()
	if admitted.Load() != 1 {
		t.Fatalf("concurrent trace admissions = %d, want 1", admitted.Load())
	}
}
