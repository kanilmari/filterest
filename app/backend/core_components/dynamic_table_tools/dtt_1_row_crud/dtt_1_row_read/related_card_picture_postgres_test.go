// related_card_picture_postgres_test.go
// Runs the article's shown-picture read against real PostgreSQL.
// Between the related-rows response and the parent's own picture fields.
// Exists so the article reports the picture the card shows — the designer's image field first,
// then the card picture — also for a dataset without a gallery, and never a media-library
// picture the viewer may not open.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/media_utils"
)

const relatedCardPictureFixture = `
CREATE TABLE system_db_tables(table_uid bigint PRIMARY KEY, table_name text, schema_name text);
CREATE TABLE system_column_details(table_uid bigint, column_name text, card_element text, client_delivery_mode text,
  show_value_on_card boolean, hide_on_small_card boolean, hide_false_null_on_sml_crd boolean);
CREATE TABLE brands(id bigint PRIMARY KEY, title text, logo_image text, banner_image text, cached_image text, image text);
CREATE TABLE notes(id bigint PRIMARY KEY, title text);
CREATE TABLE about(id bigint PRIMARY KEY, cached_image text, image text, secret_image text);
INSERT INTO system_db_tables VALUES (300, 'brands', 'public'), (301, 'notes', 'public'), (117, 'about', 'public');
INSERT INTO system_column_details VALUES
  (300, 'logo_image', 'image', 'include', true, false, true),
  (300, 'banner_image', 'image', 'include', true, true, false),
  (117, 'secret_image', 'image', 'server', true, false, false);
INSERT INTO brands VALUES
  (1, 'Logo', '117_6_6.jpg', 'banner.png', '117_6_1.png', NULL),
  (2, 'No logo', NULL, 'banner.png', '117_6_1.png', 'other.png'),
  (3, 'Only another field', NULL, 'banner.png', NULL, 'other.png'),
  (4, 'A hidden false', 'false', 'banner.png', '117_6_1.png', NULL),
  (5, 'A language map', '{"fi": "fi.png", "en": "en.png"}', 'banner.png', NULL, NULL),
  (6, 'A language map with a library picture', '{"fi": "/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png", "en": "en.png"}', 'banner.png', NULL, NULL),
  (7, 'A language map with a relative library picture', '{"fi": "media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png", "en": "en.png"}', 'banner.png', NULL, NULL),
  (8, 'A language map with a versioned library picture', '{"fi": "/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png?v=1", "en": "en.png"}', 'banner.png', NULL, NULL);
INSERT INTO notes VALUES (1, 'Text only');
INSERT INTO about VALUES
  (1, NULL, 'other.png', 'kept-on-server.png'),
  (2, NULL, NULL, NULL),
  (3, '/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png', NULL, NULL),
  (4, 'media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png', NULL, NULL),
  (5, 'media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png?v=1', NULL, NULL);
`

func relatedCardPicturePostgres(t *testing.T) *sql.DB {
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
	db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%d user=test_owner dbname=postgres sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(relatedCardPictureFixture); err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	return db
}

// withMediaLibraryAnswer gives every media-library read decision in this test the given
// answer for a reference the media library can read, parsed as the registered decision
// parses it (media_library parseReference), and restores the registered decision afterwards.
// A reference the parser refuses, such as one still carrying a ?query, is refused as there.
func withMediaLibraryAnswer(t *testing.T, allowed bool) {
	t.Helper()
	independentMediaRead.Lock()
	previous := independentMediaRead.authorize
	independentMediaRead.authorize = func(_ dbutils.Querier, _ dbutils.RequestActorContext, reference string) bool {
		_, _, _, readable := media_utils.ParseMediaLibraryStoragePath(strings.TrimPrefix(reference, "/storage/"))
		return readable && allowed
	}
	independentMediaRead.Unlock()
	t.Cleanup(func() {
		independentMediaRead.Lock()
		independentMediaRead.authorize = previous
		independentMediaRead.Unlock()
	})
}

func TestDisposableTheArticleReportsThePictureTheCardShows(t *testing.T) {
	db := relatedCardPicturePostgres(t)
	withMediaLibraryAnswer(t, false)
	actor := dbutils.NewRequestActorContext(7, "basic")

	cases := []struct {
		name      string
		table     string
		rowID     int
		want      string
		hasFields bool
	}{
		{name: "the designer's image field first", table: "brands", rowID: 1, want: "117_6_6.jpg", hasFields: true},
		{name: "an empty image field leaves the card picture; a field hidden on the card never wins", table: "brands", rowID: 2, want: "117_6_1.png", hasFields: true},
		{name: "then the next named field, as the card list falls back", table: "brands", rowID: 3, want: "other.png", hasFields: true},
		{name: "a false the card hides gives way to the card picture", table: "brands", rowID: 4, want: "117_6_1.png", hasFields: true},
		{name: "a language map is reported as stored, for the browser to read in the viewer's language", table: "brands", rowID: 5, want: `{"fi": "fi.png", "en": "en.png"}`, hasFields: true},
		{name: "a language map holding a library picture this viewer may not open shows none", table: "brands", rowID: 6, want: "", hasFields: true},
		{name: "so does one holding it as a relative address the browser reads under /storage/", table: "brands", rowID: 7, want: "", hasFields: true},
		{name: "and one holding it with a query", table: "brands", rowID: 8, want: "", hasFields: true},
		{name: "a dataset without a gallery or image field shows a named picture field", table: "about", rowID: 1, want: "other.png", hasFields: true},
		{name: "an explicit empty picture", table: "about", rowID: 2, want: "", hasFields: true},
		{name: "a media-library picture this viewer may not open", table: "about", rowID: 3, want: "", hasFields: true},
		{name: "the same picture written as a relative address", table: "about", rowID: 4, want: "", hasFields: true},
		{name: "and as a relative address with a query", table: "about", rowID: 5, want: "", hasFields: true},
		{name: "a dataset with no picture field", table: "notes", rowID: 1, want: "", hasFields: false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got, hasFields, err := readRelatedCardPicture(db, actor, testCase.table, testCase.rowID)
			if err != nil {
				t.Fatal(err)
			}
			if got != testCase.want || hasFields != testCase.hasFields {
				t.Fatalf("shown picture = %q (fields %v), want %q (fields %v)", got, hasFields, testCase.want, testCase.hasFields)
			}
			if strings.Contains(got, "kept-on-server") {
				t.Fatal("a field kept on the server left it as a picture")
			}
		})
	}
}

// A viewer who may open the library pictures keeps them: the language map is reported as
// stored and the plain library address as it is.
func TestDisposableTheArticleKeepsLibraryPicturesTheViewerMayOpen(t *testing.T) {
	db := relatedCardPicturePostgres(t)
	withMediaLibraryAnswer(t, true)
	actor := dbutils.NewRequestActorContext(7, "basic")

	cases := []struct {
		table string
		rowID int
		want  string
	}{
		{table: "brands", rowID: 6, want: `{"fi": "/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png", "en": "en.png"}`},
		{table: "brands", rowID: 7, want: `{"fi": "media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png", "en": "en.png"}`},
		{table: "about", rowID: 3, want: "/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png"},
		{table: "about", rowID: 4, want: "media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png"},
		// The decision reads the file path, so a query the storage route ignores does not
		// refuse a picture this viewer may open; the value is reported as written.
		{table: "brands", rowID: 8, want: `{"fi": "/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png?v=1", "en": "en.png"}`},
		{table: "about", rowID: 5, want: "media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png?v=1"},
	}
	for _, testCase := range cases {
		got, _, err := readRelatedCardPicture(db, actor, testCase.table, testCase.rowID)
		if err != nil {
			t.Fatal(err)
		}
		if got != testCase.want {
			t.Errorf("%s row %d: shown picture = %q, want %q", testCase.table, testCase.rowID, got, testCase.want)
		}
	}
}
