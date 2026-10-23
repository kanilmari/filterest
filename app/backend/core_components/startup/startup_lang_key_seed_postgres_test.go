// startup_lang_key_seed_postgres_test.go
// Proves startup language seeds preserve owner copy across consecutive starts.
// Connects all three seed callers to the disposable public-bootstrap database.
// Exists so SQL mock checks are backed by real constraints and persisted values.
package startup

import (
	"database/sql"
	"reflect"
	"testing"

	"github.com/lib/pq"
)

func TestStartupLangKeySeedsSecondStartPostgres(t *testing.T) {
	db := translationBootstrapDB(t)
	for _, scenario := range []struct {
		name   string
		seeds  []startupLangKeySeed
		ensure func(*sql.DB)
	}{
		{"login_second_step", loginSecondStepLangKeySeeds, EnsureLoginSecondStepLangKeys},
		{"login_page", loginPageLangKeySeeds, EnsureLoginPageLangKeys},
		{"app_db_compatibility", appDBCompatibilityLangKeySeeds, EnsureAppDBCompatibilityLangKeys},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			if len(scenario.seeds) == 0 {
				t.Fatal("seed catalogue is empty")
			}
			keys := make([]string, 0, len(scenario.seeds))
			want := make(map[string][3]sql.NullString, len(scenario.seeds))
			for _, seed := range scenario.seeds {
				if _, exists := want[seed.langKey]; exists {
					t.Fatalf("duplicate seed key %q", seed.langKey)
				}
				keys = append(keys, seed.langKey)
				want[seed.langKey] = [3]sql.NullString{
					{String: seed.fi, Valid: true},
					{String: seed.en, Valid: true},
					{String: seed.ch, Valid: true},
				}
			}
			execSQL := func(query string, args ...any) {
				t.Helper()
				if _, err := db.Exec(query, args...); err != nil {
					t.Fatal(err)
				}
			}
			snapshot := func() (map[string][3]sql.NullString, int) {
				t.Helper()
				rows, err := db.Query(`SELECT lang_key, fi, en, ch FROM system_lang_keys
WHERE lang_key = ANY($1)`, pq.Array(keys))
				if err != nil {
					t.Fatal(err)
				}
				defer rows.Close()
				values := make(map[string][3]sql.NullString, len(keys))
				for rows.Next() {
					var key string
					var translations [3]sql.NullString
					if err := rows.Scan(&key, &translations[0], &translations[1], &translations[2]); err != nil {
						t.Fatal(err)
					}
					if _, exists := values[key]; exists {
						t.Fatalf("seed key %q exists more than once", key)
					}
					values[key] = translations
				}
				if err := rows.Err(); err != nil {
					t.Fatal(err)
				}
				var total int
				if err := db.QueryRow(`SELECT count(*) FROM system_lang_keys`).Scan(&total); err != nil {
					t.Fatal(err)
				}
				return values, total
			}

			// Reset only this catalogue in the disposable database, retaining the
			// product's columns, uniqueness and foreign-key constraints unchanged.
			execSQL(`DELETE FROM system_lang_keys WHERE lang_key = ANY($1)`, pq.Array(keys))
			ownerKey := keys[0]
			const ownerFI = "Omistajan muokkaama suomenkielinen teksti"
			execSQL(`INSERT INTO system_lang_keys (lang_key, fi, en, ch) VALUES ($1, $2, '', NULL)`, ownerKey, ownerFI)
			initial, initialCount := snapshot()
			if len(initial) != 1 || initial[ownerKey] != [3]sql.NullString{
				{String: ownerFI, Valid: true}, {Valid: true}, {},
			} {
				t.Fatal("fixture must contain only the owner key, with empty EN and NULL CH")
			}
			ownerValues := want[ownerKey]
			ownerValues[0] = sql.NullString{String: ownerFI, Valid: true}
			want[ownerKey] = ownerValues

			scenario.ensure(db)
			first, firstCount := snapshot()
			if !reflect.DeepEqual(first, want) {
				t.Fatalf("first start did not insert every seed or fill only empty values: got %#v, want %#v", first, want)
			}
			if expected := initialCount + len(keys) - 1; firstCount != expected {
				t.Fatalf("first start row count = %d, want %d", firstCount, expected)
			}

			const ownerEN = "Owner-edited English copy after the first start"
			execSQL(`UPDATE system_lang_keys SET en = $2 WHERE lang_key = $1`, ownerKey, ownerEN)
			before, beforeCount := snapshot()
			ownerValues[1] = sql.NullString{String: ownerEN, Valid: true}
			want[ownerKey] = ownerValues
			if !reflect.DeepEqual(before, want) || beforeCount != firstCount {
				t.Fatal("owner edit was not persisted without changing the row count")
			}

			scenario.ensure(db)
			after, afterCount := snapshot()
			if !reflect.DeepEqual(after, before) {
				t.Fatalf("second start changed seeded translations: before %#v, after %#v", before, after)
			}
			if afterCount != beforeCount {
				t.Fatalf("second start changed total row count: before %d, after %d", beforeCount, afterCount)
			}
		})
	}
}
