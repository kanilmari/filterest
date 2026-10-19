// article_restore_postgres_test.go
// Restores an actual article-functions backup into a target without those routines.
// Connects the real backup, replacement restore and function-security verifier.
// Uses a disposable cluster and proves installation occurs only after verification.
package runtime_grants

import (
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestArticleUnmatchedFunctionsBackupRestorePostgres(t *testing.T) {
	owner, _ := grantDisposableDB(t)
	root := filepath.Join("..", "..", "..")
	for _, path := range []string{
		"testing/fixtures/article_bundle_legacy.sql",
		"server_tools/migrations/20261015000010_add_article_bundle_storage.sql",
		"server_tools/migrations/20261015000011_add_article_bundle_mutations.sql",
		"server_tools/migrations/20261015000012_materialize_article_bundles.sql",
	} {
		content, err := os.ReadFile(filepath.Join(root, path))
		if err != nil {
			t.Fatal(err)
		}
		fixtureExec(t, owner, string(content))
	}
	fixtureExec(t, owner, `CREATE TABLE system_db_version(version text); INSERT INTO system_db_version VALUES('9.12.0')`)
	fixtureExec(t, owner, `CREATE DATABASE populated_target`)
	var socket string
	var port int
	if err := owner.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')::int`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	dsn := fmt.Sprintf("host=%s port=%d user=fixture_owner dbname=populated_target sslmode=disable", socket, port)
	target, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	fixtureExec(t, target, `CREATE TABLE old_only(id int); INSERT INTO old_only VALUES(42)`)
	var absent bool
	if err := target.QueryRow(`SELECT to_regprocedure('public.app_lock_article_dataset_uid(integer)') IS NULL`).Scan(&absent); err != nil || !absent {
		t.Fatal("target already has imported article functions", absent, err)
	}
	target.Close()
	work := t.TempDir()
	instance := filepath.Join(work, "instances", "proof")
	if err := os.MkdirAll(instance, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(instance, ".env"), []byte("DB_ADMIN_USER=fixture_owner\nDB_NAME=populated_target\nAPP_PORT=1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	source, err := filepath.Abs(filepath.Join(root, "server_tools/ctl/lib/instance_backup.sh"))
	if err != nil {
		t.Fatal(err)
	}
	// Reuse the existing native PostgreSQL adapter. Readiness is immediate here;
	// the real pre-swap function-security verification remains fully enabled.
	script := strings.Replace(populatedRestoreScript, "touch waiting-for-readiness", "touch waiting-for-readiness; return 0", 1)
	cmd := exec.Command("bash", "-c", script)
	cmd.Dir = work
	cmd.Env = append(os.Environ(), "BACKUP_SOURCE="+source, "EASELECT_RESTORE_CONFIRM=yes", "PGHOST="+socket, fmt.Sprintf("PGPORT=%d", port), "PGUSER=fixture_owner")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("article backup restore failed: %v\n%s", err, output)
	}
	files, err := filepath.Glob(filepath.Join(instance, "backups", "restore_*.txt"))
	if err != nil || len(files) != 1 {
		t.Fatal("missing restore evidence", files, err)
	}
	evidence, err := os.ReadFile(files[0])
	if err != nil || !strings.Contains(string(evidence), "phase=installed") || !strings.Contains(string(evidence), "phase=function_security_verified") || strings.Contains(string(evidence), "phase=function_security_failed") {
		t.Fatal("restore did not pass security and install", string(evidence), err)
	}
	restored, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	var count int
	if err := restored.QueryRow(`WITH reviewed_definer_bodies AS (SELECT key AS body_md5,value AS identity FROM jsonb_each($1::jsonb)) SELECT count(*) FROM (`+reviewedDefinerFunctionsSQL+`) accepted`, string(reviewedDefinerBodiesJSON())).Scan(&count); err != nil || count != 6 {
		t.Fatal("restored article functions do not pass runtime verification", count, err)
	}
	if err := restored.QueryRow(`SELECT count(*) FROM public.app_check_article_bundles()`).Scan(&count); err != nil || count != 0 {
		t.Fatal("restored storage invariants", count, err)
	}
	// Re-run the real verifier in a rollback-only transaction with an unmatched
	// definer. Tightening imported trigger ACLs must never accept unknown code.
	tx, err := restored.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	fixture := `CREATE TEMP TABLE restore_original_functions(identity text,info jsonb);
	 CREATE TEMP TABLE restore_reviewed_definers(policy jsonb);
	 CREATE FUNCTION public.article_unreviewed_restore() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS 'SELECT true'`
	if _, err := tx.Exec(fixture); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`INSERT INTO restore_reviewed_definers VALUES($1)`, string(reviewedDefinerBodiesJSON())); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"instance_restore_acl.sql", "instance_restore_functions.sql"} {
		content, readErr := os.ReadFile(filepath.Join(root, "server_tools/ctl/lib", name))
		if readErr != nil {
			t.Fatal(readErr)
		}
		_, err = tx.Exec(string(content))
		if name == "instance_restore_acl.sql" && err != nil {
			t.Fatal(err)
		}
	}
	if err == nil || !strings.Contains(err.Error(), "unmatched SECURITY DEFINER function public.article_unreviewed_restore()") {
		t.Fatal("restore accepted an unreviewed definer", err)
	}
}
