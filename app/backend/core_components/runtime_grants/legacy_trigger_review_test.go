// legacy_trigger_review_test.go
// Pins reviewed legacy timestamp bodies and refuses cross-table/privilege writers.
// Reuses the metadata driver's read-only transaction for offline reader proofs.
// Fixture SQL records exact source bytes without depending on private files.
package runtime_grants

import (
	"context"
	"crypto/md5"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"
)

type legacyTriggerFixture struct {
	name, digest, definition, body string
	reviewed, definer              bool
}

func legacyTriggerFixtures(t *testing.T) []legacyTriggerFixture {
	t.Helper()
	data, err := os.ReadFile("testdata/legacy_trigger_bodies.sql")
	if err != nil {
		t.Fatal(err)
	}
	expected := map[string]struct {
		digest   string
		reviewed bool
	}{
		"update_updated_column":                             {"37c0cc2d0e0371408f4d1d00b21513a9", true},
		"set_auth_user_group_memberships_updated_timestamp": {"1a55728c1558ee7a641163442e85b778", true},
		"set_transaction_log_updated_at_timestamp":          {"06bcf30ac3d0a7f279a54cbf228a7bec", true},
		"tg_location_touch_parent":                          {"3dca2b659502c2291c1a908db58f9b38", false},
		"fn_sync_cached_username":                           {"82e78c911a285ee6eb9d81ee00a96206", false},
		"systemview_role_table_privileges_upd":              {"9a87d4938809ea845f63e034ddffc75a", false},
	}
	pattern := regexp.MustCompile(`(?s)CREATE FUNCTION public\.(\w+)\(\) RETURNS trigger\s+LANGUAGE plpgsql( SECURITY DEFINER)?\s+AS \$\$(.*?)\$\$;`)
	var fixtures []legacyTriggerFixture
	for _, match := range pattern.FindAllStringSubmatch(string(data), -1) {
		want, ok := expected[match[1]]
		if !ok {
			t.Fatal("unexpected legacy fixture", match[1])
		}
		fixtures = append(fixtures, legacyTriggerFixture{match[1], want.digest, match[0], match[3], want.reviewed, match[2] != ""})
		delete(expected, match[1])
	}
	if len(expected) != 0 {
		t.Fatal("missing legacy fixtures", expected)
	}
	return fixtures
}

func TestLegacyTriggerFingerprintsAndReader(t *testing.T) {
	for _, fixture := range legacyTriggerFixtures(t) {
		t.Run(fixture.name, func(t *testing.T) {
			if got := fmt.Sprintf("%x", md5.Sum([]byte(fixture.body))); got != fixture.digest {
				t.Fatalf("fixture body fingerprint=%s; want %s", got, fixture.digest)
			}
			if reviewedTriggerBodies[fixture.digest] != fixture.reviewed {
				t.Fatal("legacy body review decision differs")
			}
			for _, variant := range []struct {
				digest  string
				definer bool
				blocked bool
			}{
				{fixture.digest, fixture.definer, !fixture.reviewed},
				{fixture.digest, true, true},
				{fmt.Sprintf("%x", md5.Sum([]byte(fixture.body+" "))), false, true},
			} {
				db := metadataTestDB(t, func(query string, _ []driver.NamedValue) (int, [][]driver.Value, error) {
					if !strings.Contains(query, "FROM pg_trigger t JOIN pg_proc") {
						t.Fatal("unexpected query", query)
					}
					return 4, [][]driver.Value{{int64(70), int64(10), variant.digest, variant.definer}}, nil
				})
				tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
				if err != nil {
					t.Fatal(err)
				}
				s := policyFixture()
				err = readTriggerDependencies(context.Background(), tx, &s)
				tx.Rollback()
				if err != nil || HasBlockers(s.Blockers) != variant.blocked {
					t.Fatalf("digest=%s definer=%v: %v %+v", variant.digest, variant.definer, err, s.Blockers)
				}
			}
		})
	}
}
