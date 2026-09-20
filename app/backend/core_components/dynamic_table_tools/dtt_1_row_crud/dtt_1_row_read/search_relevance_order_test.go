// search_relevance_order_test.go
// Verifies that searching a dataset orders its matches by relevance, totally.
// Bridges the free-text condition with the order the listing is read in.
// Exists because making the search an ordinary condition of the listing left
// its matches with no order at all: choosing "search relevance" removes the
// sort parameters, and the listing emits no ORDER BY without one. An unordered
// result read through LIMIT/OFFSET is worse than unranked — endless scrolling
// can show one row twice and never reach another.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/lib/pq"
)

// relevanceDB holds three tasks: one whose title matches a word twice, one
// that matches it once, and one that does not match at all.
func relevanceDB(t *testing.T) *sql.DB {
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
        CREATE TABLE tasks(id integer PRIMARY KEY, title text, body text);
        INSERT INTO tasks VALUES
            (1, 'quarterly report', 'nothing of note here'),
            (2, 'report on the report', 'a report about reports'),
            (3, 'unrelated matter',  'nothing of note here');
    `); err != nil {
		t.Fatal(err)
	}
	return db
}

// searchedIDs runs the listing the way the query builder assembles it.
func searchedIDs(t *testing.T, db *sql.DB, search string) ([]int, string) {
	t.Helper()
	where, args, order, err := appendDatasetTextSearchToWhereClause(
		db, url.Values{"search": {search}}, "tasks", "", nil,
	)
	if err != nil {
		t.Fatalf("free-text condition for %q: %v", search, err)
	}

	query := `SELECT "tasks"."id" FROM "tasks"` + where + order
	rows, err := db.Query(query, args...)
	if err != nil {
		t.Fatalf("the listing query is not valid SQL: %v\n%s", err, query)
	}
	defer func() { _ = rows.Close() }()

	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return ids, order
}

func TestASearchListsItsBestMatchFirstPostgres(t *testing.T) {
	db := relevanceDB(t)

	ids, order := searchedIDs(t, db, "report")

	// Row 2 says the word four times, row 1 once, row 3 not at all.
	if len(ids) != 2 || ids[0] != 2 || ids[1] != 1 {
		t.Fatalf("matches came back as %v, want [2 1] — best match first; order was %q", ids, order)
	}
}

func TestTheSearchOrderIsTotalSoPagingCannotRepeatOrSkipPostgres(t *testing.T) {
	db := relevanceDB(t)

	_, order := searchedIDs(t, db, "nothing")

	// Rows 1 and 3 hold the same words, so their rank ties. Without a unique
	// column last, PostgreSQL may return a tie in either order, and a listing
	// read in windows can then show one row twice and never reach the other.
	if !strings.HasSuffix(order, `"tasks"."id" DESC`) {
		t.Fatalf("the order must end in a unique column: %q", order)
	}

	first, _ := searchedIDs(t, db, "nothing")
	second, _ := searchedIDs(t, db, "nothing")
	if len(first) != 2 || fmt.Sprint(first) != fmt.Sprint(second) {
		t.Fatalf("a tied search answered differently twice: %v then %v", first, second)
	}
}

func TestSearchingANumberPutsThatRowFirstPostgres(t *testing.T) {
	db := relevanceDB(t)

	ids, order := searchedIDs(t, db, "1")

	if len(ids) == 0 || ids[0] != 1 {
		t.Fatalf("searching a number should put that row first, got %v; order was %q", ids, order)
	}
}

func TestARankingAddsNoArgumentsOfItsOwnPostgres(t *testing.T) {
	db := relevanceDB(t)

	_, args, order, err := appendDatasetTextSearchToWhereClause(
		db, url.Values{"search": {"report"}}, "tasks", "", nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	// The ranking matches with the placeholder the condition already bound. A
	// second one would be a second copy of the query text to keep in step, and
	// would shift every argument the caller adds afterwards.
	if len(args) != 1 {
		t.Fatalf("ranking must not add arguments: %#v", args)
	}
	if !strings.Contains(order, "$1") {
		t.Fatalf("the ranking should reuse the condition's placeholder: %q", order)
	}
}

func TestAListingWithoutASearchIsLeftAlone(t *testing.T) {
	where, args, order, err := appendDatasetTextSearchToWhereClause(
		nil, url.Values{}, "tasks", ` WHERE "tasks"."status" = $1`, []interface{}{"open"},
	)
	if err != nil {
		t.Fatalf("no search should not be an error: %v", err)
	}
	if order != "" {
		t.Fatalf("without a search there is nothing to rank: %q", order)
	}
	if where != ` WHERE "tasks"."status" = $1` || len(args) != 1 {
		t.Fatalf("the existing condition should be untouched: %q %#v", where, args)
	}
}
