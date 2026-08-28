package request_size_limit

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// setLimits directly sets package-level limit vars, bypassing sync.Once.
func setLimits(requestMB, uploadMB int64) {
	requestBodyLimitBytes = requestMB << 20
	uploadBodyLimitBytes = uploadMB << 20
}

// TestMethodCanHaveBody verifies which HTTP methods are body-capable.
func TestMethodCanHaveBody(t *testing.T) {
	bodyMethods := []string{
		http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete,
	}
	for _, m := range bodyMethods {
		if !methodCanHaveBody(m) {
			t.Errorf("methodCanHaveBody(%q) = false, want true", m)
		}
	}

	noBodyMethods := []string{
		http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodTrace,
	}
	for _, m := range noBodyMethods {
		if methodCanHaveBody(m) {
			t.Errorf("methodCanHaveBody(%q) = true, want false", m)
		}
	}
}

// TestParseLimitMBEnv verifies env-var parsing for size limits.
func TestParseLimitMBEnv(t *testing.T) {
	const defaultMB = int64(10)
	expected := defaultMB << 20

	cases := []struct {
		name    string
		envVal  string
		wantMB  int64 // result in bytes = wantMB << 20; 0 means expect default
		wantDef bool
	}{
		{"empty string uses default", "", 0, true},
		{"whitespace-only uses default", "   ", 0, true},
		{"valid 1 MB", "1", 1, false},
		{"valid 100 MB", "100", 100, false},
		{"non-numeric falls back", "abc", 0, true},
		{"negative falls back", "-5", 0, true},
		{"zero falls back", "0", 0, true},
		{"float falls back", "10.5", 0, true},
		{"overflow falls back", "99999999999999999", 0, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("TEST_LIMIT_MB", tc.envVal)
			got := parseLimitMBEnv("TEST_LIMIT_MB", defaultMB)
			if tc.wantDef {
				if got != expected {
					t.Errorf("got %d, want default %d", got, expected)
				}
			} else {
				want := tc.wantMB << 20
				if got != want {
					t.Errorf("got %d, want %d", got, want)
				}
			}
		})
	}
}

// TestWithRequestSizeLimit_NoBodyMethods verifies GET/HEAD bypass limit logic.
func TestWithRequestSizeLimit_NoBodyMethods(t *testing.T) {
	setLimits(defaultRequestBodyLimitMB, defaultUploadBodyLimitMB)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	for _, method := range []string{http.MethodGet, http.MethodHead} {
		called = false
		req := httptest.NewRequest(method, "/", nil)
		rr := httptest.NewRecorder()
		WithRequestSizeLimit("some.Handler", next).ServeHTTP(rr, req)

		if !called {
			t.Errorf("%s: next handler not called", method)
		}
		if rr.Code != http.StatusOK {
			t.Errorf("%s: got status %d, want 200", method, rr.Code)
		}
	}
}

// TestWithRequestSizeLimit_OversizedContentLength verifies 413 on large Content-Length.
func TestWithRequestSizeLimit_OversizedContentLength(t *testing.T) {
	setLimits(defaultRequestBodyLimitMB, defaultUploadBodyLimitMB)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("body"))
	req.ContentLength = requestBodyLimitBytes + 1
	rr := httptest.NewRecorder()
	WithRequestSizeLimit("normal.Handler", next).ServeHTTP(rr, req)

	if called {
		t.Error("next handler should not be called on oversized Content-Length")
	}
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("got status %d, want 413", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "request body too large") {
		t.Errorf("unexpected body: %q", body)
	}
}

// TestWithRequestSizeLimit_NormalHandlerPassthrough verifies normal POST passes through.
func TestWithRequestSizeLimit_NormalHandlerPassthrough(t *testing.T) {
	setLimits(defaultRequestBodyLimitMB, defaultUploadBodyLimitMB)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("small body"))
	rr := httptest.NewRecorder()
	WithRequestSizeLimit("normal.Handler", next).ServeHTTP(rr, req)

	if !called {
		t.Error("next handler not called for normal POST")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("got status %d, want 200", rr.Code)
	}
}

// TestWithRequestSizeLimit_UploadHandlerUsesHigherLimit verifies upload handlers
// get the upload limit, not the standard limit.
func TestWithRequestSizeLimit_UploadHandlerUsesHigherLimit(t *testing.T) {
	setLimits(defaultRequestBodyLimitMB, defaultUploadBodyLimitMB)

	// Pick an upload-heavy handler name.
	const uploadHandler = "dtt_1_row_create.AddRowMultipartHandlerWrapper"

	// A content-length that exceeds the standard limit but is within upload limit.
	overStandardButUnderUpload := requestBodyLimitBytes + 1

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("body"))
	req.ContentLength = overStandardButUnderUpload
	rr := httptest.NewRecorder()
	WithRequestSizeLimit(uploadHandler, next).ServeHTTP(rr, req)

	if !called {
		t.Error("upload handler: next should be called when within upload limit")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("upload handler: got status %d, want 200", rr.Code)
	}

	// Verify a body exceeding even the upload limit gets rejected.
	called = false
	req2 := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("body"))
	req2.ContentLength = uploadBodyLimitBytes + 1
	rr2 := httptest.NewRecorder()
	WithRequestSizeLimit(uploadHandler, next).ServeHTTP(rr2, req2)

	if called {
		t.Error("upload handler: next should not be called when exceeding upload limit")
	}
	if rr2.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("upload handler: got status %d, want 413", rr2.Code)
	}
}
