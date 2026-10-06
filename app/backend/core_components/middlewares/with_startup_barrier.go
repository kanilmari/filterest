// with_startup_barrier.go
// Supplies lazy transaction admission; work-pool connectors gate pooled reads.
// Includes pooled reads; streams release idle admission and gate each later DB phase.
// A waiting boot prevents new requests from entering before its required writers finish.
package middlewares

import (
	"context"
	"log"
	"net/http"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/runtime_grants"
)

func WithStartupRequestBarrier(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Static application source and manager probes do not execute policy writes.
		if r.URL.Path == "/health" || r.URL.Path == "/system/health" || r.URL.Path == "/system/ready" || r.URL.Path == "/system/instance-status" || r.URL.Path == "/system/drain" || strings.HasPrefix(r.URL.Path, "/frontend/") {
			next.ServeHTTP(w, r)
			return
		}
		err := runtime_grants.WithLazyRequestBarrier(r.Context(), backend.DbLifecycle, func(ctx context.Context) {
			next.ServeHTTP(w, r.WithContext(ctx))
		})
		if err != nil {
			log.Printf("[STARTUP BARRIER] request admission/release failed: %v", err)
		}
	})
}
