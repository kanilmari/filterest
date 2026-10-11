// admission_read_lock_test.go
// Exercises real status/job GET handlers while the policy lock is unavailable.
// Connects authenticated lazy transactions to a driver refusing that lock.
// Proves reads use committed state without lock acquisition or expiry writes.
package application_updates

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/middlewares"
	esessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/sessions"
)

func TestAdmissionReadsDoNotAcquirePolicyOrRowLocks(t *testing.T) {
	oldStore, oldName := esessions.Store, esessions.SessionName
	oldAdmin, oldDB := backend.DbAdmin, backend.Db
	esessions.Store = sessions.NewCookieStore([]byte("read-lock-test-signing-key"))
	esessions.SessionName = "read-lock-test"
	t.Cleanup(func() {
		esessions.Store, esessions.SessionName = oldStore, oldName
		backend.DbAdmin, backend.Db = oldAdmin, oldDB
	})
	for _, name := range []string{"status", "job"} {
		t.Run(name, func(t *testing.T) {
			actor := testActor()
			job := Job{ID: "read-job", Phase: "queued", ExpiresAt: timestamp(time.Now().Add(-time.Minute))}
			answers := []queryAnswer{one("FROM public.system_revoked_sign_ins", true),
				one("SELECT ur.authentication_generation", actor.Generation, nil, nil),
				one("SELECT boolean_value", false)}
			handler := StatusHandler
			if name == "status" {
				answers = append(answers, one("SELECT installation_id", "site-1", true, nil), one("SELECT EXISTS", true), one("SELECT payload", jsonBytes(job)))
			} else {
				handler = JobHandler
				answers = append(answers, one("SELECT payload", jsonBytes(job)))
			}
			db, state := scriptDB(t, answers...)
			state.refusePolicyLock = true
			backend.DbAdmin, backend.Db = db, db
			request := testAuthenticatedRequest(t, actor, nil)
			request.Method = http.MethodGet
			request.SetPathValue("id", job.ID)
			response := httptest.NewRecorder()
			middlewares.WithLazyTransaction(http.HandlerFunc(handler)).ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("read queued behind held policy lock: %d %s", response.Code, response.Body)
			}
			var displayed Job
			if name == "status" {
				var status StatusResponse
				if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil || status.LatestJob == nil {
					t.Fatalf("status response: %v %s", err, response.Body)
				}
				displayed = *status.LatestJob
			} else if err := json.Unmarshal(response.Body.Bytes(), &displayed); err != nil {
				t.Fatal(err)
			}
			if displayed.Phase != "expired" || displayed.TerminalResult != "nothing_changed" {
				t.Fatal("read failed to display queue expiry", displayed)
			}
			for _, query := range state.queried {
				if strings.Contains(query, "FOR UPDATE") {
					t.Fatal("read took a row lock", query)
				}
			}
			for _, statement := range state.executed {
				query := strings.TrimSpace(statement.query)
				if strings.Contains(query, "runtime_role_write_revocations") || strings.HasPrefix(query, "UPDATE") || strings.HasPrefix(query, "INSERT") || strings.HasPrefix(query, "DELETE") {
					t.Fatal("read entered mutation boundary", query)
				}
			}
			t.Log("held-policy refusal driver: HTTP 200, no policy lock, FOR UPDATE or expiry writes")
		})
	}
}
