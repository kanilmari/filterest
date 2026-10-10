// admission_handler_test.go
// Tests real HTTP admission through CSRF and commit-buffered lazy transactions.
// Connects authenticated cookie identity with scripted durable admission and failure.
// Proves a failed commit or forged request can never receive a 202 acknowledgement.
package application_updates

import (
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/middlewares"
	esessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/sign_in_deadline"
	"easelect/backend/core_components/sign_in_revocation"
	"easelect/backend/pipeline/csrf_check"
	"encoding/json"
	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testAuthenticatedRequest(t *testing.T, actor Authorization, body []byte) *http.Request {
	t.Helper()
	seed := httptest.NewRequest("GET", "/", nil)
	session, err := esessions.GetOrCreateSession(nil, seed)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["authenticated"] = true
	session.Values["user_id"] = actor.ActorID
	session.Values["user_role"] = "admin"
	session.Values["csrf_token"] = "csrf-proof"
	session.Values[auth_generation.SessionKey] = actor.Generation
	session.Values[sign_in_revocation.SessionKey] = actor.SignInID
	session.Values[sign_in_deadline.SessionKey] = actor.SignInExpiresAt
	w := httptest.NewRecorder()
	if err = esessions.Save(w, seed, session); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/api/admin/application-update/requests", strings.NewReader(string(body)))
	for _, cookie := range w.Result().Cookies() {
		r.AddCookie(cookie)
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-CSRF-Token", "csrf-proof")
	return r.WithContext(dbutils.SetRequestActorContext(r.Context(), dbutils.NewRequestActorContext(actor.ActorID, "admin")))
}

func TestHTTPAdmissionAcknowledgesOnlyCommittedIntent(t *testing.T) {
	oldStore, oldName := esessions.Store, esessions.SessionName
	oldAdmin, oldDB := backend.DbAdmin, backend.Db
	esessions.Store = sessions.NewCookieStore([]byte("update-admission-test-signing-key"))
	esessions.SessionName = "update-test"
	t.Cleanup(func() {
		esessions.Store, esessions.SessionName = oldStore, oldName
		backend.DbAdmin, backend.Db = oldAdmin, oldDB
	})
	for _, mode := range []string{"success", "commit failure", "csrf", "revoked grant"} {
		t.Run(mode, func(t *testing.T) {
			now := time.Now()
			actor := testActor()
			offer := testOffer(now)
			token := strings.Repeat("f", 64)
			answers := []queryAnswer{}
			if mode != "csrf" {
				answers = append(answers, one("SELECT u.enabled", true, true, actor.Generation), one("FROM public.system_revoked_sign_ins", true), one("SELECT EXISTS", mode != "revoked grant"))
			}
			if mode == "success" || mode == "commit failure" {
				answers = append(answers, requestAnswers(actor, offer, token, now)...)
			}
			db, state := scriptDB(t, answers...)
			backend.DbAdmin, backend.Db = db, db
			response := httptest.NewRecorder()
			state.recorder = response
			state.commitFailure = mode == "commit failure"
			request := testAuthenticatedRequest(t, actor, jsonBytes(Request{1, offer.ID, offer.Target, "request-1", token}))
			if mode == "csrf" {
				request.Header.Del("X-CSRF-Token")
			}
			csrf_check.WithCSRFCheck(middlewares.WithLazyTransaction(http.HandlerFunc(RequestHandler)).ServeHTTP).ServeHTTP(response, request)
			want := http.StatusAccepted
			if mode == "commit failure" {
				want = 500
			}
			if mode == "csrf" || mode == "revoked grant" {
				want = 403
			}
			if response.Code != want {
				t.Fatal(response.Code, response.Body.String())
			}
			if mode == "success" {
				var job Job
				if err := json.Unmarshal(response.Body.Bytes(), &job); err != nil || job.ID == "" || state.commits != 1 {
					t.Fatal(job, err, state.commits)
				}
			}
			if mode == "commit failure" && strings.Contains(response.Body.String(), "queued") {
				t.Fatal("uncommitted job was acknowledged")
			}
			if mode == "csrf" && len(state.executed) != 0 {
				t.Fatal("CSRF refusal touched the database")
			}
		})
	}
}

func TestStrictRequestDecoderRefusesUnknownTrailingAndOversizedData(t *testing.T) {
	for _, body := range []string{`{"unknown":1}`, `{} {}`, strings.Repeat("x", 17000)} {
		request := httptest.NewRequest("POST", "/", strings.NewReader(body))
		var decoded Request
		assertCode(t, decodeBody(httptest.NewRecorder(), request, &decoded), "invalid_request")
	}
}

func TestReauthenticationIssuesProofOnlyAfterPasswordAndConfiguredFactor(t *testing.T) {
	oldStore, oldName := esessions.Store, esessions.SessionName
	oldAdmin, oldDB, oldConf := backend.DbAdmin, backend.Db, backend.DbConfidential
	esessions.Store = sessions.NewCookieStore([]byte("update-proof-test-signing-key"))
	esessions.SessionName = "update-proof-test"
	t.Cleanup(func() {
		esessions.Store, esessions.SessionName = oldStore, oldName
		backend.DbAdmin, backend.Db, backend.DbConfidential = oldAdmin, oldDB, oldConf
	})
	passwordHash, _ := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	pinHash, _ := bcrypt.GenerateFromPassword([]byte("1234"), bcrypt.MinCost)
	for _, mode := range []string{"missing factor", "wrong password", "wrong factor", "success"} {
		t.Run(mode, func(t *testing.T) {
			now := time.Now()
			actor := testActor()
			offer := testOffer(now)
			answers := []queryAnswer{one("RETURNING attempts", int64(1)), one("RETURNING attempts", int64(1)), one("SELECT u.enabled", true, true, actor.Generation), one("FROM public.system_revoked_sign_ins", true), one("SELECT EXISTS", true), one("SELECT installation_id", "site-1", true, jsonBytes(offer)), one("SELECT password", string(passwordHash), "fixed_pin", string(pinHash), "", "", actor.Generation, false)}
			if mode == "success" {
				answers = append(answers, one("SELECT u.enabled", true, true, actor.Generation), one("FROM public.system_revoked_sign_ins", true), one("SELECT EXISTS", true))
			}
			db, state := scriptDB(t, answers...)
			backend.DbAdmin, backend.Db, backend.DbConfidential = db, db, db
			response := httptest.NewRecorder()
			state.recorder = response
			password, factor := "correct-password", "1234"
			if mode == "missing factor" {
				factor = ""
			}
			if mode == "wrong password" {
				password = "wrong"
			}
			if mode == "wrong factor" {
				factor = "9876"
			}
			body := ReauthenticationRequest{ProtocolVersion: 1, Action: "request", OfferID: offer.ID, Target: offer.Target, Password: password, FactorCode: factor}
			request := testAuthenticatedRequest(t, actor, jsonBytes(body))
			request.URL.Path = "/api/admin/application-update/reauthentication"
			csrf_check.WithCSRFCheck(middlewares.WithLazyTransaction(http.HandlerFunc(ReauthenticationHandler)).ServeHTTP).ServeHTTP(response, request)
			want := 403
			if mode == "success" {
				want = 201
			}
			if mode == "missing factor" {
				want = 200
			}
			if response.Code != want {
				t.Fatal("unexpected reauthentication status", mode, response.Code)
			}
			var result ReauthenticationResponse
			_ = json.Unmarshal(response.Body.Bytes(), &result)
			proofWrites := 0
			for _, statement := range state.executed {
				if strings.Contains(statement.query, "INSERT INTO restricted.system_application_update_proofs") {
					proofWrites++
					if statement.args[0].Value != byteDigest([]byte(result.Proof)) {
						t.Fatal("raw proof was persisted")
					}
					var binding proofBinding
					_ = json.Unmarshal([]byte(statement.args[1].Value.(string)), &binding)
					if binding.AuthorizationContext != actor || binding.Action != "request" || binding.Target != offer.Target || binding.ObjectID != offer.ID || statement.args[4].Value.(driver.Value) != "fixed_pin" {
						t.Fatal("stored proof binding or verification method differs")
					}
				}
			}
			if mode == "success" {
				if len(result.Proof) != 64 || proofWrites != 1 || state.commits != 2 {
					t.Fatal("proof issuance failed its hash/write/commit contract", proofWrites, state.commits)
				}
			} else if result.Proof != "" || proofWrites != 0 {
				t.Fatal("missing or refused credentials minted a proof")
			}
			if mode == "missing factor" && !result.FactorRequired {
				t.Fatal("configured factor was skipped")
			}
			if state.commits < 1 {
				t.Fatal("authentication failure rolled back its rate budget")
			}
		})
	}
}
