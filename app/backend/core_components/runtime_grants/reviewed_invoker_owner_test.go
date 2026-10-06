// reviewed_invoker_owner_test.go
// Pins the catalogue safety predicates and all four bound runtime role identities.
// Real trusted-owner and transitive membership decisions have PostgreSQL proofs.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"strings"
	"testing"
)

func TestReviewedInvokerOwnerSafetyUsesConfiguredRoleOIDs(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		for _, accepted := range []bool{false, true} {
			s := policyFixture()
			s.Objects[90] = Object{OID: 90, Schema: "public", Name: "system_users", Kind: "table"}
			for i := range s.Roles {
				s.Roles[i].OID = int64(300 + i)
			}
			db := metadataTestDB(t, func(query string, args []driver.NamedValue) (int, [][]driver.Value, error) {
				if strings.HasPrefix(query, "SELECT t.tgtype,") {
					return 2, [][]driver.Value{{int64(16), "{}"}}, nil
				}
				if !strings.Contains(query, "pg_has_role(r.role_oid,p.proowner,'MEMBER')") || !strings.Contains(query, "search_path=%") || strings.Contains(query, "p.proowner=(SELECT c.relowner") {
					t.Fatal("invoker recognition lost its ownership/path safety", query)
				}
				var bound []map[string]any
				if err := json.Unmarshal([]byte(args[len(args)-1].Value.(string)), &bound); err != nil || len(bound) != 4 {
					t.Fatal("four configured runtime roles were not bound", err, bound)
				}
				for i, role := range s.Roles {
					if bound[i]["label"] != role.Label || bound[i]["role_oid"] != float64(role.OID) {
						t.Fatal("configured role identity changed", bound, s.Roles)
					}
				}
				return 1, [][]driver.Value{{accepted}}, nil
			})
			tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
			if err != nil {
				t.Fatal(err)
			}
			var got bool
			if legacy {
				got, err = readReviewedLegacyTrigger(context.Background(), tx, &s, 99, 90, "82e78c911a285ee6eb9d81ee00a96206", false)
			} else {
				got, err = readReviewedInvokerTrigger(context.Background(), tx, &s, 99, "aa05ff614a5b400f35158a3386e154d3")
			}
			_ = tx.Rollback()
			if err != nil || got != accepted {
				t.Fatal("catalogue safety decision ignored", legacy, accepted, got, err)
			}
		}
	}
}
