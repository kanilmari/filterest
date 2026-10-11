// error_response_test.go
// Verifies translated policy-wait refusals and wrapped internal failures.
// Connects the mutation response boundary with HTTP refusal/error formatting.
// Keeps other failures' public message while logging the inspection's real cause.
package runtime_grant_mutations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/runtime_grants"
	"github.com/lib/pq"
)

func TestPolicyLockWaitTimeoutResponse(t *testing.T) {
	for _, test := range []struct {
		name             string
		err              error
		status           int
		message, langKey string
	}{
		{"policy_wait_timeout", fmt.Errorf("begin mutation: %w: %w", runtime_grants.ErrPolicyLockWaitTimeout, &pq.Error{Code: "55P03"}), http.StatusServiceUnavailable,
			"Another permission change is still being saved. Try again in a moment.", "error_runtime_grant_policy_busy"},
		{"other_lock_timeout", fmt.Errorf("direct ACL inspection failed: %w", &pq.Error{Code: "55P03"}), http.StatusInternalServerError,
			"permissions could not be saved", ""},
		{"other_postgres_error", &pq.Error{Code: "40P01"}, http.StatusInternalServerError, "permissions could not be saved", ""},
		{"canceled", context.Canceled, http.StatusInternalServerError, "permissions could not be saved", ""},
		{"ordinary_error", fmt.Errorf("unexpected mutation failure"), http.StatusInternalServerError, "permissions could not be saved", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			RespondError(rec, test.err)
			var response struct {
				Error   string `json:"error"`
				Code    int    `json:"code"`
				LangKey string `json:"error_lang_key"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if rec.Code != test.status || response.Code != test.status || response.Error != test.message || response.LangKey != test.langKey {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
			}
		})
	}
}

func TestWrappedACLFailureLogsCauseAndKeepsClientMessage(t *testing.T) {
	var logged bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(previous) })
	rec := httptest.NewRecorder()
	RespondError(rec, fmt.Errorf("direct ACL inspection failed: %w", context.Canceled))
	var response struct {
		Error string `json:"error"`
		Code  int    `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusInternalServerError || response.Code != 500 || response.Error != "permissions could not be saved" {
		t.Fatal("client error changed", rec.Code, rec.Body.String())
	}
	if !strings.Contains(logged.String(), "runtime grant mutation failed: direct ACL inspection failed: context canceled") {
		t.Fatal("server log lost original cause", logged.String())
	}
}
