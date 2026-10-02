// board_search_postgres_test.go
// Verifies the Observatory's search against a real PostgreSQL, word for word.
// Between: the board's search and the one search every dataset uses.
// Exists because the board once searched by substring and ignored workline numbers:
// "127" found lines that merely mentioned 127.0.0.1 or a commit hash, never WL127.
package workline_observatory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"

	_ "github.com/lib/pq"
)

// boardSearchDB holds four worklines shaped like the ones the owner searched for.
func boardSearchDB(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 to run isolated PostgreSQL verification")
	}

	root := t.TempDir()
	socket := filepath.Join(root, "socket")
	if err := os.Mkdir(socket, 0o700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "db")
	bin := "/usr/lib/postgresql/16/bin/"
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(bin+name, args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, output)
		}
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("find an unused port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("release the port: %v", err)
	}

	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		_, _ = exec.Command(bin+"pg_ctl", "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"),
		"-o", fmt.Sprintf("-h '' -k '%s' -p %d", socket, port), "-w", "start")

	db, err := sql.Open("postgres",
		fmt.Sprintf("host=%s port=%d user=test_owner dbname=postgres sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if _, err := db.Exec(`
        CREATE TABLE dev_agent_worklines(id bigint PRIMARY KEY, title text NOT NULL,
            status text NOT NULL DEFAULT 'active', tags text[] NOT NULL DEFAULT '{}',
            updated timestamptz NOT NULL DEFAULT now(), priority text NOT NULL DEFAULT 'normal',
            priority_revision integer NOT NULL DEFAULT 0, status_revision integer NOT NULL DEFAULT 0,
            status_changed_by bigint, status_changed_at timestamptz NOT NULL DEFAULT now(),
            status_change_source text NOT NULL DEFAULT 'creation');
        CREATE TABLE system_users(id bigint PRIMARY KEY, username text);
        CREATE TABLE dev_agent_workline_tasks(workline_id bigint, task_id bigint);
        CREATE TABLE dev_agent_release_goals(id bigint PRIMARY KEY, identity_key text, version text,
            title text, outcome text, decision_state text, is_selected boolean);
        CREATE TABLE dev_agent_release_goal_contracts(id bigint PRIMARY KEY, release_goal_id bigint,
            workline_id bigint, completion_rule text, target_phase integer);
        CREATE TABLE dev_agent_workline_reports(
            id bigint PRIMARY KEY, workline_id bigint NOT NULL, title text, report_type text,
            outcome text, state text NOT NULL, phase_gate text, current_phase integer,
            workline_status_snapshot text, context_text text, plain_language_text text,
            technical_text text, next_step_text text, git_head_commit text,
            git_worktree_state text, git_has_other_changes boolean,
            git_workline_changed_paths text[], created timestamptz NOT NULL);
        INSERT INTO dev_agent_worklines VALUES
            (127, 'Ohjeet: malliperheet ristiin ja olemassa olevan kyvyn etsiminen ennen uutta'),
            (113, 'Palvelimen portti 8090 vastaa internetiin palomuurin ohi'),
            (50, 'Windows-siirron lähdemuutosten viimeistely'),
            (2, 'Kehitysopas');
        INSERT INTO dev_agent_workline_reports(id, workline_id, state, technical_text, created) VALUES
            (1, 113, 'final', 'Portti sidottiin: "8090:8082" -> "127.0.0.1:8090:8082"', now()),
            (2, 50, 'final', 'Historiallinen HEAD säilyy 5ef3bfe4aaee3a127cff3933a7b72be22425eae2', now()),
            (3, 50, 'superseded', 'Korvattu raportti mainitsi malliperheet', now()),
            (4, 127, 'final', 'Kaksi ohjesääntöä kirjoitettu', now()),
            (5, 2, 'final', 'Vanhempi raportti mainitsi karhun', now() - interval '1 day'),
            (6, 2, 'final', 'Uusin raportti', now());
    `); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestBoardSearchFindsWhatADatasetSearchWouldPostgres(t *testing.T) {
	db := boardSearchDB(t)
	for _, item := range []struct {
		search string
		want   []int64
		why    string
	}{
		{"127", []int64{127, 113}, "the number names WL127 first; 127.0.0.1 is a word of #113; a hash merely containing 127 is not"},
		{"malliperheet", []int64{127}, "only the latest final report is read, never a superseded one"},
		{"kehitys", []int64{2}, "a word is found by its beginning"},
		{"opas", []int64{}, "a word is not found by its middle, as in every dataset"},
		{"karhun", []int64{}, "an older report of the same workline is not read"},
		{"portti karhun", []int64{113}, "any of the words is enough"},
	} {
		got, err := loadBoardSearchMatches(context.Background(), db, item.search)
		if err != nil {
			t.Fatalf("%q: %v", item.search, err)
		}
		if fmt.Sprint(got) != fmt.Sprint(item.want) {
			t.Fatalf("%q found %v, want %v: %s", item.search, got, item.want, item.why)
		}
	}
}

// The board handler reads the board and its search in one repeatable-read
// transaction; a report published between the reads must not reach the second.
func TestBoardSearchInsideOneTransactionSeesOneMomentPostgres(t *testing.T) {
	db := boardSearchDB(t)
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	if got, err := loadBoardSearchMatches(ctx, tx, "julkaisu"); err != nil || len(got) != 0 {
		t.Fatalf("before the new report: %v, %v", got, err)
	}
	if _, err := db.Exec(`INSERT INTO dev_agent_workline_reports(id, workline_id, state, technical_text, created)
        VALUES (7, 2, 'final', 'Uusi julkaisu', now() + interval '1 minute')`); err != nil {
		t.Fatal(err)
	}
	if got, err := loadBoardSearchMatches(ctx, tx, "julkaisu"); err != nil || len(got) != 0 {
		t.Fatalf("the same transaction must not see a report published after its first read: %v, %v", got, err)
	}
	if got, err := loadBoardSearchMatches(ctx, db, "julkaisu"); err != nil || fmt.Sprint(got) != "[2]" {
		t.Fatalf("a new read must see the new report: %v, %v", got, err)
	}
}

// poolCheckingWriter records how many database connections are in use when the
// answer is written, which is when a slow client would hold one.
type poolCheckingWriter struct {
	*httptest.ResponseRecorder
	db           *sql.DB
	inUseAtWrite int
}

func (w *poolCheckingWriter) Write(body []byte) (int, error) {
	w.inUseAtWrite = w.db.Stats().InUse
	return w.ResponseRecorder.Write(body)
}

func TestBoardHandlerReleasesItsConnectionBeforeAnsweringPostgres(t *testing.T) {
	db := boardSearchDB(t)
	previous := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previous })

	writer := &poolCheckingWriter{ResponseRecorder: httptest.NewRecorder(), db: db, inUseAtWrite: -1}
	BoardHandler(writer, httptest.NewRequest("GET", "/api/app/workline-observatory/board?search=127", nil))
	if writer.Code != 200 || !strings.Contains(writer.Body.String(), `"id":127`) {
		t.Fatalf("board answer: %d %s", writer.Code, writer.Body.String())
	}
	if writer.inUseAtWrite != 0 {
		t.Fatalf("%d database connection(s) still held while the answer was written", writer.inUseAtWrite)
	}
}

func TestBoardSearchWithoutWordsAndTooLongSearchPostgres(t *testing.T) {
	db := boardSearchDB(t)
	if got, err := loadBoardSearchMatches(context.Background(), db, "  "); err != nil || got != nil {
		t.Fatalf("no search must mean no filter: %v, %v", got, err)
	}
	if _, err := loadBoardSearchMatches(context.Background(), db, strings.Repeat("a", maxBoardSearchLength+1)); !errors.Is(err, errWorklineSearchTooLong) {
		t.Fatalf("an overlong search must be refused before the database: %v", err)
	}
}
