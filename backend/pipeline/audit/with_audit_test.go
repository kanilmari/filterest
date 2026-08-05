package audit

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInferOperationType(t *testing.T) {
	tests := []struct {
		name        string
		handlerName string
		want        string
	}{
		{name: "create", handlerName: "dtt.row_create", want: "create"},
		{name: "read", handlerName: "dtt.GetResultsHandler", want: "read"},
		{name: "update", handlerName: "dtt.row_update", want: "update"},
		{name: "delete", handlerName: "dtt.DeleteRowsHandler", want: "delete"},
		{name: "auth", handlerName: "auth.LoginHandler", want: "auth"},
		{name: "admin", handlerName: "admin.CreateIndexHandler", want: "admin"},
		{name: "translation defaults to read", handlerName: "lang.UpdateLangKeyHandler", want: "read"},
		{name: "search tooling defaults to read", handlerName: "searchvector.RebuildHandler", want: "read"},
		{name: "other", handlerName: "misc.CustomThing", want: "other"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := InferOperationType(tt.handlerName); got != tt.want {
				t.Fatalf("InferOperationType(%q) = %q, want %q", tt.handlerName, got, tt.want)
			}
		})
	}
}

func TestExtractTableName(t *testing.T) {
	tests := []struct {
		name     string
		rawURL   string
		wantName string
	}{
		{name: "dataset", rawURL: "/api/test?dataset=products", wantName: "products"},
		{name: "table", rawURL: "/api/test?table=orders", wantName: "orders"},
		{name: "dataset_name", rawURL: "/api/test?dataset_name=people", wantName: "people"},
		{name: "dataset wins precedence", rawURL: "/api/test?dataset=products&table=orders", wantName: "products"},
		{name: "no known parameter", rawURL: "/api/test?view=cards", wantName: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", tt.rawURL, nil)
			if got := extractTableName(req); got != tt.wantName {
				t.Fatalf("extractTableName(%q) = %q, want %q", tt.rawURL, got, tt.wantName)
			}
		})
	}
}

func TestExtractIP(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		headers    map[string]string
		want       string
	}{
		{
			name:       "x forwarded for first wins",
			remoteAddr: "10.0.0.1:1234",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.1, 198.51.100.2"},
			want:       "203.0.113.1",
		},
		{
			name:       "single x forwarded for",
			remoteAddr: "10.0.0.1:1234",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.8"},
			want:       "203.0.113.8",
		},
		{
			name:       "x real ip fallback",
			remoteAddr: "10.0.0.1:1234",
			headers:    map[string]string{"X-Real-IP": "198.51.100.7"},
			want:       "198.51.100.7",
		},
		{
			name:       "remote addr host part",
			remoteAddr: "192.0.2.44:8080",
			want:       "192.0.2.44",
		},
		{
			name:       "malformed remote addr falls back as is",
			remoteAddr: "malformed-remote-addr",
			want:       "malformed-remote-addr",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/test", nil)
			req.RemoteAddr = tt.remoteAddr
			for key, value := range tt.headers {
				req.Header.Set(key, value)
			}
			if got := extractIP(req); got != tt.want {
				t.Fatalf("extractIP() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestShouldEnqueueAuditEvent(t *testing.T) {
	tests := []struct {
		name          string
		handlerName   string
		operationType string
		method        string
		statusCode    int
		want          bool
	}{
		{
			name:          "skip successful frontend shell traffic",
			handlerName:   "router.handleFrontend",
			operationType: "other",
			method:        http.MethodGet,
			statusCode:    http.StatusOK,
			want:          false,
		},
		{
			name:          "keep failed frontend shell traffic",
			handlerName:   "router.handleFrontend",
			operationType: "other",
			method:        http.MethodGet,
			statusCode:    http.StatusInternalServerError,
			want:          true,
		},
		{
			name:          "keep successful write operations",
			handlerName:   "dtt_1_row_update.UpdateRowHandlerWrapper",
			operationType: "update",
			method:        http.MethodPost,
			statusCode:    http.StatusOK,
			want:          true,
		},
		{
			name:          "skip successful low-signal auth check",
			handlerName:   "auth.CheckTableRightHandler",
			operationType: "auth",
			method:        http.MethodGet,
			statusCode:    http.StatusOK,
			want:          false,
		},
		{
			name:          "keep successful meaningful read traffic",
			handlerName:   "dtt_1_row_read.GetResultsHandlerWrapper",
			operationType: "read",
			method:        http.MethodGet,
			statusCode:    http.StatusOK,
			want:          true,
		},
		{
			name:          "keep successful post auth traffic even if handler is otherwise noisy",
			handlerName:   "auth.CheckFingerprintHandler",
			operationType: "auth",
			method:        http.MethodPost,
			statusCode:    http.StatusOK,
			want:          true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := shouldEnqueueAuditEvent(tt.handlerName, tt.operationType, tt.method, tt.statusCode); got != tt.want {
				t.Fatalf("shouldEnqueueAuditEvent(%q, %q, %q, %d) = %v, want %v", tt.handlerName, tt.operationType, tt.method, tt.statusCode, got, tt.want)
			}
		})
	}
}

type flushRecorder struct {
	*httptest.ResponseRecorder
	flushed bool
}

func (f *flushRecorder) Flush() {
	f.flushed = true
}

func TestStatusCaptureWriteHeaderPreservesFirstCode(t *testing.T) {
	recorder := httptest.NewRecorder()
	capture := &statusCapture{ResponseWriter: recorder, code: http.StatusOK}

	capture.WriteHeader(http.StatusNoContent)
	capture.WriteHeader(http.StatusBadGateway)

	if capture.code != http.StatusNoContent {
		t.Fatalf("statusCapture.code = %d, want %d", capture.code, http.StatusNoContent)
	}
	if !capture.written {
		t.Fatal("statusCapture.written = false, want true")
	}
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("underlying recorder code = %d, want %d", recorder.Code, http.StatusNoContent)
	}
}

func TestStatusCaptureWriteDefaultsStatusOK(t *testing.T) {
	recorder := httptest.NewRecorder()
	capture := &statusCapture{ResponseWriter: recorder}

	n, err := capture.Write([]byte("hello"))
	if err != nil {
		t.Fatalf("statusCapture.Write returned unexpected error: %v", err)
	}
	if n != 5 {
		t.Fatalf("statusCapture.Write wrote %d bytes, want 5", n)
	}
	if capture.code != http.StatusOK {
		t.Fatalf("statusCapture.code = %d, want %d", capture.code, http.StatusOK)
	}
	if !capture.written {
		t.Fatal("statusCapture.written = false, want true")
	}
}

func TestStatusCaptureFlushDelegatesToUnderlyingWriter(t *testing.T) {
	recorder := &flushRecorder{ResponseRecorder: httptest.NewRecorder()}
	capture := &statusCapture{ResponseWriter: recorder}

	capture.Flush()

	if !recorder.flushed {
		t.Fatal("statusCapture.Flush() did not delegate to underlying flusher")
	}
}
