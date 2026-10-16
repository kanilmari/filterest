// component_startup_barrier_test.go
// Proves only component browser GET/HEAD requests bypass startup admission.
// Observes lazy admission context without opening any database connection.
// Keeps feature API routes, mutations and malformed static paths behind the barrier.
package middlewares

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestComponentStartupBarrierExemptsOnlyStaticReads(t *testing.T) {
	for _, test := range []struct {
		method, target string
		exempt         bool
	}{
		{"GET", "/components/sample/frontend/module.js", true},
		{"HEAD", "/components/sample/frontend/style.css", true},
		{"POST", "/components/sample/frontend/module.js", false},
		{"PUT", "/components/sample/frontend/module.js", false},
		{"DELETE", "/components/sample/frontend/module.js", false},
		{"GET", "/api/components/sample", false},
		{"GET", "/components/sample/api/read", false},
		{"GET", "/components/sample/backend/private.js", false},
		{"GET", "/components/sample/frontend/../backend/private.js", false},
		{"GET", "/components/sample%2ffrontend/module.js", false},
		{"GET", "/components/sample/frontend/handler.spec.js", false},
	} {
		t.Run(test.method+test.target, func(t *testing.T) {
			ctx := context.WithValue(context.Background(), struct{}{}, "original")
			called := false
			handler := WithStartupRequestBarrier(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
				called = true
				if unchanged := request.Context() == ctx; unchanged != test.exempt {
					t.Errorf("exempt = %v, want %v", unchanged, test.exempt)
				}
			}))
			handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(test.method, test.target, nil).WithContext(ctx))
			if !called {
				t.Fatal("request never reached downstream")
			}
		})
	}
}
