// semantic_embedding_match_test.go
// Verifies that the AI stage searches every stored embedding and that the reader's language only ranks.
// Bridges fetchSimilarRows and the vector listing's shared distance with a real PostgreSQL and pgvector.
// Exists because the reader's language used to switch the search to that one language's embeddings:
// with lang=fi or lang=en a row embedded only in another language, or only generally, was never found.
// It also holds the related-enough cut-off to cosine distance, which Google's unscaled vectors need.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"math"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/lib/pq"
	pgvector "github.com/pgvector/pgvector-go"
)

// semanticEmbeddingDB starts a disposable PostgreSQL with pgvector and a
// dataset "places" that has both a general embedding column and a language
// embedding table. Vectors are two-dimensional and built by vectorAtDistance,
// which keeps every distance in the cases readable.
func semanticEmbeddingDB(t *testing.T) *sql.DB {
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
        CREATE EXTENSION vector;
        CREATE TABLE system_db_tables (table_name text PRIMARY KEY, multi_lang_embeddings boolean);
        INSERT INTO system_db_tables VALUES ('places', true);
        CREATE TABLE places (id integer PRIMARY KEY, header text, embedding_vector vector);
        CREATE TABLE places_lang_embeddings (
            host_row_id integer REFERENCES places(id) ON DELETE CASCADE,
            language_code text,
            embedding vector,
            updated timestamp NOT NULL DEFAULT now(),
            content_md5 text
        );
    `); err != nil {
		t.Fatal(err)
	}
	return db
}

// vectorAtDistance returns a two-dimensional vector at exactly the given cosine
// distance from the query direction [1, 0], scaled to length norm: norm 1 is
// an OpenAI-like unit vector, norm 0.7 a Google-like unscaled one.
func vectorAtDistance(distance, norm float64) string {
	cosine := 1 - distance
	return fmt.Sprintf("[%.9f, %.9f]", norm*cosine, norm*math.Sqrt(1-cosine*cosine))
}

func insertPlace(t *testing.T, db *sql.DB, id int, header string, general string) {
	t.Helper()
	var generalValue interface{}
	if general != "" {
		generalValue = general
	}
	if _, err := db.Exec(`INSERT INTO places (id, header, embedding_vector) VALUES ($1, $2, $3::vector)`,
		id, header, generalValue); err != nil {
		t.Fatal(err)
	}
}

func insertPlaceLanguage(t *testing.T, db *sql.DB, id int, language string, embedding string) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO places_lang_embeddings (host_row_id, language_code, embedding) VALUES ($1, $2, $3::vector)`,
		id, language, embedding); err != nil {
		t.Fatal(err)
	}
}

// nearestPlaces runs the AI stage's candidate query as the reader in readerLang.
func nearestPlaces(t *testing.T, db *sql.DB, readerLang string) []rowSemanticScore {
	t.Helper()
	return nearestPlacesTo(t, db, readerLang, 1)
}

// nearestPlacesTo queries with [norm, 0]; a query vector shares its model's scale.
func nearestPlacesTo(t *testing.T, db *sql.DB, readerLang string, norm float32) []rowSemanticScore {
	t.Helper()
	sources, err := resolveSemanticSources(db, "places")
	if err != nil {
		t.Fatal(err)
	}
	hits, err := fetchSimilarRows(db, "places", readerLang, pgvector.NewVector([]float32{norm, 0}),
		intelligentSearchAuthorization{userRole: "admin"}, sources, semanticResultLimit)
	if err != nil {
		t.Fatalf("the candidate query failed: %v", err)
	}
	return hits
}

func placeIDs(hits []rowSemanticScore) string {
	ids := make([]string, 0, len(hits))
	for _, hit := range hits {
		ids = append(ids, fmt.Sprint(hit.RowID))
	}
	return "[" + strings.Join(ids, " ") + "]"
}

func TestAReaderFindsRowsEmbeddedOnlyInAnotherLanguagePostgres(t *testing.T) {
	db := semanticEmbeddingDB(t)
	insertPlace(t, db, 1, "Auto", "")
	insertPlaceLanguage(t, db, 1, "fi", vectorAtDistance(0.1, 1))
	insertPlace(t, db, 2, "Car", "")
	insertPlaceLanguage(t, db, 2, "en", vectorAtDistance(0.2, 1))
	insertPlace(t, db, 3, "Garage", vectorAtDistance(0.3, 1))

	// Every reader language searches every embedding: the Finnish-only row,
	// the English-only row and the row with only a general embedding.
	for _, readerLang := range []string{"en", "fi", "ch", ""} {
		if got := placeIDs(nearestPlaces(t, db, readerLang)); got != "[1 2 3]" {
			t.Fatalf("reader %q found %s, want every embedded row [1 2 3]", readerLang, got)
		}
	}
}

func TestTheReadersLanguageWinsANearTiePostgres(t *testing.T) {
	db := semanticEmbeddingDB(t)
	insertPlace(t, db, 1, "Car", "")
	insertPlaceLanguage(t, db, 1, "en", vectorAtDistance(0.100, 1))
	insertPlace(t, db, 2, "Auto", "")
	insertPlaceLanguage(t, db, 2, "fi", vectorAtDistance(0.103, 1))

	cases := map[string]string{"fi": "[2 1]", "en": "[1 2]", "": "[1 2]", "yue": "[1 2]"}
	for readerLang, want := range cases {
		if got := placeIDs(nearestPlaces(t, db, readerLang)); got != want {
			t.Fatalf("reader %q ranked %s, want %s", readerLang, got, want)
		}
	}
}

func TestAClearlyCloserMatchInAnotherLanguageStillLeadsPostgres(t *testing.T) {
	db := semanticEmbeddingDB(t)
	insertPlace(t, db, 1, "Car", "")
	insertPlaceLanguage(t, db, 1, "en", vectorAtDistance(0.10, 1))
	insertPlace(t, db, 2, "Auto", "")
	insertPlaceLanguage(t, db, 2, "fi", vectorAtDistance(0.20, 1))

	if got := placeIDs(nearestPlaces(t, db, "fi")); got != "[1 2]" {
		t.Fatalf("a Finnish reader ranked %s; the preference must stay modest, want [1 2]", got)
	}
}

func TestARowIsFoundOnceAtItsBestDistancePostgres(t *testing.T) {
	db := semanticEmbeddingDB(t)
	insertPlace(t, db, 1, "Station", vectorAtDistance(0.30, 1))
	insertPlaceLanguage(t, db, 1, "en", vectorAtDistance(0.69, 1))
	insertPlaceLanguage(t, db, 1, "fi", vectorAtDistance(0.71, 1))
	insertPlace(t, db, 2, "Harbour", "")
	insertPlaceLanguage(t, db, 2, "en", vectorAtDistance(0.69, 1))
	insertPlaceLanguage(t, db, 2, "fi", vectorAtDistance(0.71, 1))

	hits := nearestPlaces(t, db, "fi")
	if placeIDs(hits) != "[1 2]" {
		t.Fatalf("got %s, want each row once: [1 2]", placeIDs(hits))
	}
	if d := hits[0].DistanceScore; d < 0.2999 || d > 0.3001 || hits[0].MatchLanguage != "" {
		t.Fatalf("row 1 = %+v, want its general distance 0.30", hits[0])
	}
	// The Finnish match ranks row 2 (0.71 * 0.95 < 0.69), but whether the row
	// is close enough is judged by its best distance in any language: 0.69.
	if d := hits[1].DistanceScore; d < 0.6899 || d > 0.6901 {
		t.Fatalf("row 2 distance = %v, want its best distance 0.69", d)
	}
	if hits[1].MatchLanguage != "fi" {
		t.Fatalf("row 2 ranked by %q, want the reader's language fi", hits[1].MatchLanguage)
	}
}

func TestEmbeddingsOfAnotherLengthAreSkippedNotFatalPostgres(t *testing.T) {
	db := semanticEmbeddingDB(t)
	// Row 1 was embedded by an earlier model with three dimensions only.
	insertPlace(t, db, 1, "Old", "[1, 0.1, 0]")
	insertPlaceLanguage(t, db, 1, "en", "[1, 0.1, 0]")
	insertPlace(t, db, 2, "New", "")
	insertPlaceLanguage(t, db, 2, "en", vectorAtDistance(0.2, 1))
	insertPlace(t, db, 3, "Never embedded", "")

	if got := placeIDs(nearestPlaces(t, db, "en")); got != "[2]" {
		t.Fatalf("got %s, want only the comparable row [2]", got)
	}
}

func TestSourcesFollowWhatTheDatasetReallyStoresPostgres(t *testing.T) {
	db := semanticEmbeddingDB(t)
	sources, err := resolveSemanticSources(db, "places")
	if err != nil {
		t.Fatal(err)
	}
	if !sources.General || !sources.Language {
		t.Fatalf("places stores both embeddings, got %+v", sources)
	}

	// A flag left without its table must not send the search to a missing table.
	if _, err := db.Exec(`
        INSERT INTO system_db_tables VALUES ('notes', true);
        CREATE TABLE notes (id integer PRIMARY KEY, header text, embedding_vector vector);
        INSERT INTO notes VALUES (1, 'kept', '[1, 0.4]');
    `); err != nil {
		t.Fatal(err)
	}
	sources, err = resolveSemanticSources(db, "notes")
	if err != nil {
		t.Fatal(err)
	}
	if !sources.General || sources.Language {
		t.Fatalf("notes has only its general embedding, got %+v", sources)
	}
	hits, err := fetchSimilarRows(db, "notes", "fi", pgvector.NewVector([]float32{1, 0}),
		intelligentSearchAuthorization{userRole: "admin"}, sources, semanticResultLimit)
	if err != nil || placeIDs(hits) != "[1]" {
		t.Fatalf("general-only search = %s, %v; want [1]", placeIDs(hits), err)
	}
}

func TestTheVectorListingOrdersByTheSameDistancePostgres(t *testing.T) {
	db := semanticEmbeddingDB(t)
	insertPlace(t, db, 1, "Car", "")
	insertPlaceLanguage(t, db, 1, "en", vectorAtDistance(0.100, 1))
	insertPlace(t, db, 2, "Auto", "")
	insertPlaceLanguage(t, db, 2, "fi", vectorAtDistance(0.103, 1))
	insertPlace(t, db, 3, "Never embedded", "")
	insertPlace(t, db, 4, "Garage", vectorAtDistance(0.5, 1))

	sources, err := resolveSemanticSources(db, "places")
	if err != nil {
		t.Fatal(err)
	}
	// The listing binds its own filters first; the vector and the reader's
	// language follow them, as GetResultsVector numbers them.
	query := `SELECT "places".id FROM "places" CROSS JOIN LATERAL (` +
		semanticMatchLateral("places", sources, 2, 3) +
		`) AS semantic WHERE "places".id > $1
		 ORDER BY semantic.rank_score ASC NULLS LAST, semantic.distance ASC NULLS LAST, "places".id ASC`
	rows, err := db.Query(query, 0, pgvector.NewVector([]float32{1, 0}), readerContentLanguage("fi-FI"))
	if err != nil {
		t.Fatalf("the listing query is not valid SQL: %v", err)
	}
	defer func() { _ = rows.Close() }()
	var ids []string
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, fmt.Sprint(id))
	}
	if got := strings.Join(ids, " "); got != "2 1 4 3" {
		t.Fatalf("listing order = %s, want the Finnish match first and the unembedded row last: 2 1 4 3", got)
	}
}

func TestReaderContentLanguage(t *testing.T) {
	cases := map[string]string{
		"fi": "fi", "fi-FI": "fi", " EN ": "en", "en_GB": "en",
		"yue": "yue", "zh-HK": "yue", "zh-Hant-HK": "yue",
		"ch": "ch", "zh-CN": "ch", "zh-TW": "ch", "zh": "ch",
		"": "", "x": "", "fi'; DROP": "",
	}
	for input, want := range cases {
		if got := readerContentLanguage(input); got != want {
			t.Fatalf("readerContentLanguage(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestTheCutoffMeansTheSameForScaledAndUnscaledVectorsPostgres(t *testing.T) {
	const cutoff = 0.40
	for _, norm := range []float64{1, 0.7} {
		t.Run(fmt.Sprintf("norm %.1f", norm), func(t *testing.T) {
			db := semanticEmbeddingDB(t)
			insertPlace(t, db, 1, "Sushi restaurant", vectorAtDistance(0.15, norm))
			// Cosine distance 0.49: as far as the browser row lay from "ravintola".
			insertPlace(t, db, 2, "Web browser", vectorAtDistance(0.49, norm))

			hits := nearestPlacesTo(t, db, "fi", float32(norm))
			if placeIDs(hits) != "[1 2]" {
				t.Fatalf("candidates = %s, want both rows ranked [1 2]", placeIDs(hits))
			}
			if d := hits[1].DistanceScore; math.Abs(d-0.49) > 0.001 {
				t.Fatalf("the unrelated row's distance = %v, want 0.49 at any scale", d)
			}
			if got := placeIDs(relatedSemanticHits(hits, cutoff)); got != "[1]" {
				t.Fatalf("related rows = %s, want only the genuine match [1]", got)
			}
		})
	}
}

func TestEuclideanDistanceMisjudgedUnscaledVectorsPostgres(t *testing.T) {
	db := semanticEmbeddingDB(t)
	insertPlace(t, db, 2, "Web browser", vectorAtDistance(0.49, 0.7))

	// The former rule: Euclidean distance at most 0.70. Google-like vectors of
	// length 0.7 lie closer together, so an unrelated row fell inside it.
	var euclidean, cosine float64
	if err := db.QueryRow(`SELECT embedding_vector <-> $1::vector, embedding_vector <=> $1::vector FROM places WHERE id = 2`,
		pgvector.NewVector([]float32{0.7, 0})).Scan(&euclidean, &cosine); err != nil {
		t.Fatal(err)
	}
	if euclidean > 0.70 {
		t.Fatalf("Euclidean distance %v; the fixture must reproduce the old false match (<= 0.70)", euclidean)
	}
	if math.Abs(cosine-0.49) > 0.001 {
		t.Fatalf("cosine distance %v, want 0.49", cosine)
	}
}
