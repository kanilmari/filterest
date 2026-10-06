// legacy_trigger_events_postgres_test.go
// Proves real catalogue attachment drift cannot add unreachable parent writes.
// Derives desired grants from the attachment's events and UPDATE OF columns.
// Separate limited-role connections verify no parent UPDATE(updated) privilege.
package runtime_grants

import (
	"context"
	"database/sql"
	"github.com/lib/pq"
	"testing"
)

func TestUpdateOnlyLegacyAttachmentDoesNotGrantForInsertPostgres(t *testing.T) {
	owner, connect := grantDisposableDB(t)
	fixtureExec(t, owner, `CREATE ROLE event_basic LOGIN;
	 CREATE TABLE app_service_catalog(id integer PRIMARY KEY,updated timestamptz);
	 CREATE TABLE app_service_locations(id integer PRIMARY KEY,service_id integer,title text)`)
	for _, fixture := range legacyTriggerFixtures(t) {
		if fixture.name == "tg_location_touch_parent" {
			fixtureExec(t, owner, fixture.definition)
		}
	}
	for _, event := range []string{"UPDATE", "UPDATE OF title"} {
		fixtureExec(t, owner, `CREATE TRIGGER location_touch AFTER `+event+` ON app_service_locations FOR EACH ROW EXECUTE FUNCTION tg_location_touch_parent()`)
		s := policyFixture()
		s.Objects = map[int64]Object{}
		s.Dependencies = nil
		s.Sequences = nil
		for _, name := range []string{"app_service_locations", "app_service_catalog"} {
			var oid int64
			if err := owner.QueryRow(`SELECT to_regclass($1)::oid`, name).Scan(&oid); err != nil {
				t.Fatal(err)
			}
			uid := int64(1)
			columns := []Column{{Name: "id"}, {Name: "service_id"}, {Name: "title", Text: true}}
			if name == "app_service_catalog" {
				uid = 2
				columns = []Column{{Name: "id"}, {Name: "updated"}}
			}
			s.Objects[oid] = Object{OID: oid, Schema: "public", Name: name, Kind: "table", DatasetUID: uid, Columns: columns}
		}
		s.Rights = []Right{{GroupID: 2, FunctionID: 2, DatasetUID: 1}} // INSERT only.
		tx, err := owner.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		if err := readTriggerDependencies(context.Background(), tx, &s); err != nil {
			t.Fatal(err)
		}
		tx.Rollback()
		if HasBlockers(s.Blockers) || len(s.Dependencies) != 1 || s.Dependencies[0].When != Update {
			t.Fatal(s.Blockers, s.Dependencies)
		}
		columns := s.Dependencies[0].SourceUpdateColumns
		if event == "UPDATE" && len(columns) != 0 || event == "UPDATE OF title" && (len(columns) != 1 || columns[0] != "title") {
			t.Fatal("attachment update columns missing", event, columns)
		}
		grants := grantsFor(t, s)
		parent := publicObjectOID(&s, "app_service_catalog")
		if containsGrant(grants, "basic", parent, "updated", "UPDATE") {
			t.Fatal("unreachable parent write", grants)
		}
		for _, g := range grants {
			if g.Role == "basic" && g.Privilege == "INSERT" {
				fixtureExec(t, owner, "GRANT INSERT ON "+s.Objects[g.ObjectOID].Identifier()+" TO "+pq.QuoteIdentifier("event_basic"))
			}
		}
		var granted bool
		if err := connect("event_basic").QueryRow(`SELECT has_column_privilege('app_service_catalog','updated','UPDATE')`).Scan(&granted); err != nil || granted {
			t.Fatal("extra parent UPDATE", granted, err)
		}
		fixtureExec(t, owner, `DROP TRIGGER location_touch ON app_service_locations`)
	}
}
