// admission_postgres_test.go
// Proves durable admission, queue expiry, audit and revocation against PostgreSQL.
// Creates its own opt-in disposable cluster; never uses installation credentials.
// Exercises the shipped migrations and transactional single-use/idempotency constraints.
package application_updates

import (
	"context"
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/runtime_grants"
	"easelect/backend/core_components/update_capability"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func admissionPostgres(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL proofs")
	}
	root := t.TempDir()
	socket := filepath.Join(root, "socket")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	data := filepath.Join(root, "db")
	run := func(name string, args ...string) {
		t.Helper()
		if out, err := exec.Command(filepath.Join(bin, name), args...).CombinedOutput(); err != nil {
			if name == "pg_ctl" {
				serverLog, _ := os.ReadFile(filepath.Join(root, "postgres.log"))
				out = append(out, serverLog...)
			}
			t.Fatalf("%s: %v: %s", name, err, out)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		_, _ = exec.Command(filepath.Join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", "-h '' -k '"+socket+"' -p 15531", "-w", "start")
	db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=15531 user=test_owner dbname=postgres sslmode=disable connect_timeout=5", socket))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

const admissionFixtureSQL = `CREATE SCHEMA restricted;
CREATE TABLE public.system_users(id integer PRIMARY KEY,enabled boolean,admin_access_allowed boolean);
CREATE TABLE restricted.users_restricted(id integer PRIMARY KEY,authentication_generation bigint);
CREATE TABLE public.system_user_groups(id integer PRIMARY KEY,name text);
CREATE TABLE public.system_user_group_memberships(user_id integer,group_id integer);
CREATE TABLE public.system_functions(id serial PRIMARY KEY,name text UNIQUE,"package" text,disabled boolean,specific_table_related boolean,url_route_endpoint text,ui_only boolean,rate_limit_amount integer,rate_limit_minutes integer,creation_spec text);
CREATE TABLE public.system_group_table_func_rights(user_group_id integer,function_id integer,target_schema_name text,target_table_uid integer);
CREATE TABLE public.system_data_repair_records(migration text,action text);
CREATE TABLE public.system_db_tables(table_name text,schema_name text,table_uid integer);
CREATE TABLE public.system_revoked_sign_ins(sign_in_id text PRIMARY KEY,expires_at timestamptz);
INSERT INTO public.system_users VALUES (42,true,true),(73,true,true);
INSERT INTO restricted.users_restricted VALUES (42,3),(73,3);
INSERT INTO public.system_user_groups VALUES (1,'admins'),(2,'update operators');
INSERT INTO public.system_user_group_memberships VALUES (42,1),(42,2),(73,1);`

func pgSQL(t *testing.T, db *sql.DB, statement string, args ...interface{}) {
	t.Helper()
	if _, err := db.Exec(statement, args...); err != nil {
		t.Fatal(err)
	}
}
func pgTx(t *testing.T, db *sql.DB, work func(*sql.Tx) error) error {
	t.Helper()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err = runtime_grants.LockRuntimeGrantPolicy(context.Background(), tx); err != nil {
		return err
	}
	if err = work(tx); err != nil {
		return err
	}
	return tx.Commit()
}
func pgProof(t *testing.T, db *sql.DB, binding proofBinding, now time.Time) string {
	t.Helper()
	var response ReauthenticationResponse
	if err := pgTx(t, db, func(tx *sql.Tx) error {
		var err error
		response, err = createProof(context.Background(), tx, binding, "totp", now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	var created, expires time.Time
	if err := db.QueryRow(`SELECT created_at,expires_at FROM restricted.system_application_update_proofs WHERE id=$1`, byteDigest([]byte(response.Proof))).Scan(&created, &expires); err != nil {
		t.Fatal(err)
	}
	if created.After(now) || expires.After(now.Add(ProofFreshness)) || expires.Sub(created) != ProofFreshness || response.ExpiresAt != timestamp(expires) {
		t.Fatalf("proof round trip changed freshness: issued=%s created=%s expires=%s response=%s", timestamp(now), timestamp(created), timestamp(expires), response.ExpiresAt)
	}
	return response.Proof
}

func TestApplicationUpdateAdmissionPostgres(t *testing.T) {
	db := admissionPostgres(t)
	pgSQL(t, db, admissionFixtureSQL)
	for _, name := range []string{"20261009000050_create_application_update_admission.sql", "20261009000051_register_application_update_capability.sql"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", name))
		if err != nil {
			t.Fatal(err)
		}
		pgSQL(t, db, string(raw))
		pgSQL(t, db, string(raw))
	}
	// Both fresh installation and replay leave the sensitive right ungranted.
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM system_group_table_func_rights r JOIN system_functions f ON f.id=r.function_id WHERE f.name=$1`, update_capability.Name).Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
	if err := backend.EnsureAdminPermissions(db); err != nil {
		t.Fatal(err)
	}
	if err := backend.EnsureAdminTablePermissions(db); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_group_table_func_rights r JOIN system_functions f ON f.id=r.function_id WHERE f.name=$1`, update_capability.Name).Scan(&count); err != nil || count != 0 {
		t.Fatal("startup granted update right", count, err)
	}
	pgSQL(t, db, `INSERT INTO system_group_table_func_rights SELECT 2,id,'public',NULL FROM system_functions WHERE name=$1`, update_capability.Name)
	// Keep a deliberate sub-microsecond remainder that PostgreSQL would round up.
	// The injected admission clock is independent of the real SQL heartbeat clock.
	now := time.Now().UTC().Truncate(time.Microsecond).Add(900 * time.Nanosecond)
	actor := testActor()
	offer := testOffer(now)
	pgSQL(t, db, `INSERT INTO restricted.system_application_update_control(singleton,installation_id,executor_enabled,executor_available,executor_checked_at,offer) VALUES (TRUE,$1,TRUE,TRUE,clock_timestamp(),$2)`, offer.Target.InstallationID, string(jsonBytes(offer)))
	proof := pgProof(t, db, proofBinding{actor, "request", offer.ID, offer.Target}, now)
	request := Request{1, offer.ID, offer.Target, "request-1", proof}
	var job Job
	err := pgTx(t, db, func(tx *sql.Tx) error {
		if err := RecheckAuthorization(context.Background(), tx, actor); err != nil {
			return err
		}
		var err error
		job, err = AdmitRequest(context.Background(), tx, actor, request, now)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if job.ID == "" || len(job.Events) != 1 || job.ExpiresAt != timestamp(now.Add(QueueLifetime)) {
		t.Fatal(job)
	}
	var consumed bool
	if err = db.QueryRow(`SELECT consumed_at IS NOT NULL FROM restricted.system_application_update_proofs WHERE id=$1`, byteDigest([]byte(proof))).Scan(&consumed); err != nil || !consumed {
		t.Fatal(consumed, err)
	}
	now = now.Add(time.Minute)
	err = pgTx(t, db, func(tx *sql.Tx) error {
		retried, err := AdmitRequest(context.Background(), tx, actor, request, now)
		if retried.ID != job.ID || retried.ExpiresAt != job.ExpiresAt {
			t.Fatal("idempotency changed the durable job", retried)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	conflict := request
	conflict.Target.EvidenceRevision++
	err = pgTx(t, db, func(tx *sql.Tx) error {
		_, err := AdmitRequest(context.Background(), tx, actor, conflict, now)
		return err
	})
	assertCode(t, err, "idempotency_conflict")
	err = pgTx(t, db, func(tx *sql.Tx) error {
		_, err := RecheckQueuedRequest(context.Background(), tx, job.ID, now)
		return err
	})
	if err != nil {
		t.Fatal("fresh queued request refused", err)
	}
	// Removing grants and changing generations refuse later pickup even after admission.
	pgSQL(t, db, `DELETE FROM system_group_table_func_rights WHERE user_group_id=2`)
	err = pgTx(t, db, func(tx *sql.Tx) error {
		_, err := RecheckQueuedRequest(context.Background(), tx, job.ID, now)
		return err
	})
	assertCode(t, err, "authorization_revoked")
	pgSQL(t, db, `INSERT INTO system_group_table_func_rights SELECT 2,id,'public',NULL FROM system_functions WHERE name=$1`, update_capability.Name)
	pgSQL(t, db, `UPDATE restricted.users_restricted SET authentication_generation=4 WHERE id=42`)
	err = pgTx(t, db, func(tx *sql.Tx) error {
		_, err := RecheckQueuedRequest(context.Background(), tx, job.ID, now)
		return err
	})
	assertCode(t, err, "authorization_revoked")
	pgSQL(t, db, `UPDATE restricted.users_restricted SET authentication_generation=3 WHERE id=42`)
	pgSQL(t, db, `INSERT INTO system_revoked_sign_ins VALUES ($1,clock_timestamp()+interval '1 hour')`, actor.SignInID)
	err = pgTx(t, db, func(tx *sql.Tx) error {
		_, err := RecheckQueuedRequest(context.Background(), tx, job.ID, now)
		return err
	})
	assertCode(t, err, "authorization_revoked")
	pgSQL(t, db, `DELETE FROM system_revoked_sign_ins`)
	// Another administrator cannot gain their own right by joining the granted group.
	err = pgTx(t, db, func(tx *sql.Tx) error {
		ctx := dbutils.SetRequestActorContext(context.Background(), dbutils.NewRequestActorContext(73, "admin"))
		guard, err := update_capability.Capture(ctx, tx)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(`INSERT INTO system_user_group_memberships VALUES (73,2)`); err != nil {
			return err
		}
		return guard.Check(ctx, tx)
	})
	var refusal *httpresponse.Refusal
	if !errors.As(err, &refusal) || refusal.Status != 403 {
		t.Fatal("membership self-grant accepted", err)
	}
	if err = db.QueryRow(`SELECT count(*) FROM system_user_group_memberships WHERE user_id=73 AND group_id=2`).Scan(&count); err != nil || count != 0 {
		t.Fatal("self-grant survived rollback", count, err)
	}
	// Expired work releases the active slot and records a second ordered event.
	now, err = time.Parse(time.RFC3339Nano, job.ExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	err = pgTx(t, db, func(tx *sql.Tx) error { return expireQueued(context.Background(), tx, now) })
	if err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT count(*) FROM restricted.system_application_update_events WHERE job_id=$1`, job.ID).Scan(&count); err != nil || count != 2 {
		t.Fatal(count, err)
	}
	// Only a trusted future manager can supply cutover evidence; no browser API does it.
	job.Phase = "awaiting_administrator"
	job.PublicReopened = true
	job.Target.CutoverID = "cutover-1"
	job.EvidenceExpiresAt = timestamp(now.Add(time.Hour))
	job.Events = append(job.Events, Event{Sequence: 2, Phase: "expired"})
	err = pgTx(t, db, func(tx *sql.Tx) error { return saveJob(context.Background(), tx, job, true) })
	if err != nil {
		t.Fatal(err)
	}
	decisionProof := pgProof(t, db, proofBinding{actor, "accept", job.ID, job.Target}, now)
	decision := DecisionRequest{1, "accept", job.Target, "decision-1", decisionProof}
	var receipt DecisionReceipt
	err = pgTx(t, db, func(tx *sql.Tx) error {
		var err error
		receipt, err = AdmitDecision(context.Background(), tx, actor, job.ID, decision, now)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if receipt.ActorID != job.RequesterID || receipt.ExpiresAt != timestamp(now.Add(QueueLifetime)) {
		t.Fatal("self-acceptance or queue lifetime changed", receipt)
	}
	err = pgTx(t, db, func(tx *sql.Tx) error {
		_, err := RecheckQueuedDecision(context.Background(), tx, receipt.ID, now)
		return err
	})
	if err != nil {
		t.Fatal("fresh queued decision refused", err)
	}
	job.Target.EvidenceRevision++
	err = pgTx(t, db, func(tx *sql.Tx) error { return saveJob(context.Background(), tx, job, true) })
	if err != nil {
		t.Fatal(err)
	}
	err = pgTx(t, db, func(tx *sql.Tx) error {
		_, err := RecheckQueuedDecision(context.Background(), tx, receipt.ID, now)
		return err
	})
	assertCode(t, err, "stale_decision")
	// Check exact receipt expiry after the fresh/stale checks without rewinding time.
	now, err = time.Parse(time.RFC3339Nano, receipt.ExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	err = pgTx(t, db, func(tx *sql.Tx) error {
		_, err := RecheckQueuedDecision(context.Background(), tx, receipt.ID, now)
		return err
	})
	assertCode(t, err, "queue_expired")
	// Atomic audits retain the actor and hashed proof/sign-in references only.
	var audit string
	if err = db.QueryRow(`SELECT string_agg(event::text||authorization_context::text||target::text||proof_id,'') FROM restricted.system_application_update_events WHERE job_id=$1`, job.ID).Scan(&audit); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(audit, proof) || strings.Contains(audit, decisionProof) || strings.Contains(audit, actor.SignInID) || !strings.Contains(audit, byteDigest([]byte(actor.SignInID))) || !strings.Contains(audit, byteDigest([]byte(proof))) || !strings.Contains(audit, "cutover-1") {
		t.Fatal("audit identity or secret boundary failed")
	}
}
