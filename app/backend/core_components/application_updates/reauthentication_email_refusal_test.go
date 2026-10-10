// reauthentication_email_refusal_test.go
// Verifies translated update refusals when real email delivery is unavailable.
// Connects the administrator HTTP pipeline to credential, OTP and mail services.
// Proves requests and decisions expose no code, credentials or sign-in identity.
package application_updates

import (
	"bytes"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/middlewares"
	esessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline/csrf_check"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
)

func TestReauthenticationEmailRefusalIsTranslatedAndSecretFree(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("POSTMARK_API_KEY", "")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")
	oldStore, oldName, oldAdmin, oldDB, oldConf := esessions.Store, esessions.SessionName, backend.DbAdmin, backend.Db, backend.DbConfidential
	esessions.Store, esessions.SessionName = sessions.NewCookieStore([]byte("update-mail-test-signing-key")), "update-mail-test"
	t.Cleanup(func() {
		esessions.Store, esessions.SessionName = oldStore, oldName
		backend.DbAdmin, backend.Db, backend.DbConfidential = oldAdmin, oldDB, oldConf
		logging.SetOutput(os.Stderr)
	})
	password := "http-password-canary"
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"request", "accept", "refuse"} {
		t.Run(action, func(t *testing.T) {
			var captured bytes.Buffer
			logging.SetOutput(&captured)
			now, actor := time.Now(), testActor()
			offer := testOffer(now)
			answers := []queryAnswer{one("RETURNING attempts", int64(1)), one("RETURNING attempts", int64(1)), one("SELECT u.enabled", true, true, actor.Generation), one("FROM public.system_revoked_sign_ins", true), one("SELECT EXISTS", true)}
			body := ReauthenticationRequest{ProtocolVersion: 1, Action: action, OfferID: offer.ID, Target: offer.Target, Password: password}
			if action == "request" {
				answers = append(answers, one("SELECT installation_id", "site-1", true, jsonBytes(offer)))
			} else {
				body.OfferID, body.JobID, body.Target.CutoverID = "", "job-1", "cutover-1"
				job := Job{ID: body.JobID, Target: body.Target, Phase: "awaiting_administrator", PublicReopened: true, EvidenceExpiresAt: timestamp(now.Add(time.Hour))}
				answers = append(answers, one("SELECT payload", jsonBytes(job)))
			}
			answers = append(answers, one("SELECT password", string(hash), "email", "", "", "user@example.invalid", actor.Generation, false), one("SELECT COUNT(*)", int64(0), float64(0)))
			db, state := scriptDB(t, answers...)
			backend.DbAdmin, backend.Db, backend.DbConfidential = db, db, db
			request := testAuthenticatedRequest(t, actor, jsonBytes(body))
			request.URL.Path = "/api/admin/application-update/reauthentication"
			response := httptest.NewRecorder()
			csrf_check.WithCSRFCheck(middlewares.WithLazyTransaction(http.HandlerFunc(ReauthenticationHandler)).ServeHTTP).ServeHTTP(response, request)
			var refusal ErrorResponse
			if err := json.Unmarshal(response.Body.Bytes(), &refusal); err != nil || response.Code != 403 || refusal.ErrorLangKey != "error_application_update_reauthentication_refused" {
				t.Fatal("email refusal lost its translated HTTP contract")
			}
			staged, revoked := false, false
			for _, statement := range state.executed {
				if strings.Contains(statement.query, "INSERT INTO restricted.verification_codes") {
					staged = statement.args[1].Value == "application_update" && statement.args[5].Value == driver.Value(int64(0))
				}
				if strings.Contains(statement.query, "DELETE FROM restricted.verification_codes") {
					revoked = true
				}
				if strings.Contains(statement.query, "INSERT INTO restricted.system_application_update_proofs") {
					t.Fatal("undelivered factor minted a proof")
				}
			}
			if !staged || !revoked {
				t.Fatal("refusal did not invalidate and remove the challenge")
			}
			for _, secret := range []string{password, string(hash), actor.SignInID, auth_generation.SessionKey + "\"", "factor_code", "\"proof\""} {
				if strings.Contains(response.Body.String()+captured.String(), secret) {
					t.Fatal("HTTP refusal exposed authentication material")
				}
			}
		})
	}
}
