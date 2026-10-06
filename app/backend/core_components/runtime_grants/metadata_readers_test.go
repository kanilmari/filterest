// metadata_readers_test.go
// Exercises actual metadata scans and complete audit reporting without PostgreSQL.
// Uses a small database/sql driver, as the canonical gallery reader's tests do.
// Guards NULL/dangling rows, diagnostic text and unchanged valid-row policy.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"testing"
)

type metadataTestQuery func(string, []driver.NamedValue) (int, [][]driver.Value, error)
type metadataTestConnector struct{ query metadataTestQuery }
type metadataTestConn struct{ query metadataTestQuery }
type metadataTestTx struct{}
type metadataTestRows struct {
	columns int
	rows    [][]driver.Value
}

func (c metadataTestConnector) Connect(context.Context) (driver.Conn, error) {
	return &metadataTestConn{c.query}, nil
}
func (c metadataTestConnector) Driver() driver.Driver { return c }
func (c metadataTestConnector) Open(string) (driver.Conn, error) {
	return c.Connect(context.Background())
}
func (*metadataTestConn) Close() error { return nil }
func (*metadataTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("metadata test forbids prepared writes")
}
func (*metadataTestConn) Begin() (driver.Tx, error) { return metadataTestTx{}, nil }
func (*metadataTestConn) BeginTx(_ context.Context, options driver.TxOptions) (driver.Tx, error) {
	if !options.ReadOnly {
		return nil, errors.New("metadata test requires read-only transaction")
	}
	return metadataTestTx{}, nil
}
func (c *metadataTestConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	columns, rows, err := c.query(query, args)
	if err != nil {
		return nil, err
	}
	return &metadataTestRows{columns, rows}, nil
}
func (metadataTestTx) Commit() error   { return errors.New("metadata test forbids commit") }
func (metadataTestTx) Rollback() error { return nil }
func (r *metadataTestRows) Columns() []string {
	columns := make([]string, r.columns)
	for i := range columns {
		columns[i] = fmt.Sprintf("column_%d", i)
	}
	return columns
}
func (*metadataTestRows) Close() error { return nil }
func (r *metadataTestRows) Next(dest []driver.Value) error {
	if len(r.rows) == 0 {
		return io.EOF
	}
	copy(dest, r.rows[0])
	r.rows = r.rows[1:]
	return nil
}
func metadataTestDB(t *testing.T, query metadataTestQuery) *sql.DB {
	t.Helper()
	db := sql.OpenDB(metadataTestConnector{query})
	t.Cleanup(func() { db.Close() })
	return db
}

// Answer only catalogue/metadata reads; an unexpected content query fails.
func metadataSnapshotQueries(relationRows [][]driver.Value) (RoleConfiguration, metadataTestQuery) {
	s := policyFixture()
	s.Objects[12] = Object{OID: 12, Schema: "public", Name: "fresh_bridge", Kind: "table", DatasetUID: 3, Columns: []Column{{Name: "id"}, {Name: "filename"}, {Name: "parent_id"}}}
	for i, name := range []string{"system_db_tables", "system_foreign_key_relations_1_m", "system_foreign_key_relations_m_m", "system_row_actor_columns", "system_triggers"} {
		oid := int64(20 + i)
		s.Objects[oid] = Object{OID: oid, Schema: "public", Name: name, Kind: "table", Columns: []Column{{Name: "table_uid"}}}
	}
	config := RoleConfiguration{Names: map[string]string{"basic": "hidden basic runtime", "guest": "hidden guest runtime", "readonly": "hidden readonly runtime", "confidential": "hidden confidential runtime"}}
	return config, func(query string, args []driver.NamedValue) (int, [][]driver.Value, error) {
		switch {
		case query == objectsSQL:
			rows := [][]driver.Value{}
			for _, o := range s.Objects {
				rows = append(rows, []driver.Value{o.OID, o.Schema, o.Name, o.Kind, o.Protected, o.Extension})
			}
			return 6, rows, nil
		case strings.Contains(query, "FROM pg_roles WHERE rolname=$1"):
			for _, role := range s.Roles {
				if config.Names[role.Label] == args[0].Value {
					return 2, [][]driver.Value{{role.OID, false}}, nil
				}
			}
			return 2, nil, nil
		case strings.Contains(query, "SELECT a.attrelid,a.attname"):
			rows := [][]driver.Value{}
			for _, o := range s.Objects {
				for _, c := range o.Columns {
					rows = append(rows, []driver.Value{o.OID, c.Name, c.Text, c.Identity})
				}
			}
			return 4, rows, nil
		case strings.Contains(query, "SELECT to_regclass('public.system_db_tables')"):
			return 1, [][]driver.Value{{true}}, nil
		case strings.Contains(query, "FROM public.system_db_tables d ORDER BY d.id"):
			return 6, [][]driver.Value{{int64(1), int64(1), "public", "fresh_dataset", int64(10), ""}, {int64(2), int64(2), "public", "fresh_target", int64(11), ""}, {int64(3), int64(3), "public", "fresh_bridge", int64(12), ""}, {int64(760), nil, "public", "unregistered", int64(0), ""}, {int64(904), int64(999), "public", "missing_registry", int64(0), ""}}, nil
		case strings.Contains(query, "FROM public.system_functions ORDER BY id"):
			return 5, [][]driver.Value{{int64(1), "/api/get-results", false, false, true}, {int64(2), "/api/add-row-multipart", false, false, true}}, nil
		case strings.Contains(query, "SELECT id,name FROM public.system_user_groups"):
			return 2, [][]driver.Value{{int64(1), "admins"}, {int64(2), "users"}, {int64(3), "guests"}}, nil
		case strings.Contains(query, "FROM public.system_user_group_memberships"):
			return 2, [][]driver.Value{{int64(1), int64(3)}}, nil
		case strings.Contains(query, "FROM public.system_group_table_func_rights"):
			return 4, [][]driver.Value{{int64(1), int64(2), int64(1), int64(1)}, {int64(2), int64(2), int64(2), int64(1)}, {int64(3), int64(2), int64(2), int64(3)}, {int64(905), int64(2), int64(1), int64(999)}}, nil
		case strings.Contains(query, "FROM public.system_row_actor_columns"):
			return 5, [][]driver.Value{{nil, nil, "owner", nil, true}, {int64(888), int64(888), "owner", "owner_id", true}}, nil
		case strings.Contains(query, "FROM public.system_foreign_key_relations_1_m ORDER BY id"):
			return 7, relationRows, nil
		case strings.Contains(query, "FROM public.system_foreign_key_relations_m_m"):
			return 4, [][]driver.Value{{int64(1), int64(1), int64(2), int64(3)}, {int64(763), int64(1), int64(2), nil}, {int64(903), int64(1), int64(2), int64(999)}}, nil
		case strings.Contains(query, "FROM public.system_triggers"):
			return 4, [][]driver.Value{{int64(1), "fresh_dataset", "fresh_target", []byte(`{"title":"private metadata value"}`)}, {int64(764), nil, nil, nil}, {int64(906), "fresh_dataset", nil, nil}}, nil
		case query == sequencesSQL:
			return 6, nil, nil
		case strings.Contains(query, "SELECT c.oid,c.conrelid"):
			return 5, nil, nil
		case strings.Contains(query, "SELECT t.oid,t.tgrelid"):
			return 4, nil, nil
		case strings.Contains(query, "SELECT a.oid,a.adrelid"):
			return 8, nil, nil
		case query == sqlPathReviewSQL:
			return 5, nil, nil
		case query == "SHOW transaction_read_only":
			return 1, [][]driver.Value{{"on"}}, nil
		case query == auditorMayWriteSQL:
			return 1, [][]driver.Value{{false}}, nil
		case query == effectivePrivilegesSQL:
			return 9, [][]driver.Value{{"basic", "table", int64(10), "", "SELECT", true, false, true, "dataset capability"}, {"basic", "table", int64(11), "", "UPDATE", false, true, true, "outside desired operation requirements"}}, nil
		case query == directACLsSQL:
			return 10, nil, nil
		case query == defaultACLsSQL:
			return 8, nil, nil
		default:
			return 0, nil, errors.New("unexpected metadata query")
		}
	}
}

func TestMetadataReadersContinueAndPreserveValidPolicy(t *testing.T) {
	rows := [][]driver.Value{
		{int64(757), nil, int64(1), nil, "", true, []byte(`{"file_upload":{"cache_targets":true}}`)},
		{int64(758), int64(3), nil, "parent_id", "", true, []byte(`{"file_upload":{"cache_targets":true}}`)},
		{int64(759), nil, nil, nil, "", true, nil},
		{int64(901), int64(999), int64(1), "parent_id", "", true, nil},
		{int64(1), int64(3), int64(1), "parent_id", "", true, []byte(`{"file_upload":{"cache_targets":[]}}`)},
	}
	config, query := metadataSnapshotQueries(rows)
	db := metadataTestDB(t, query)
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := LoadGrantSnapshot(context.Background(), tx, config)
	tx.Rollback()
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Findings) != 7 || len(snapshot.Blockers) != 6 {
		t.Fatalf("metadata findings: preserved=%d blockers=%d: %+v %+v", len(snapshot.Findings), len(snapshot.Blockers), snapshot.Findings, snapshot.Blockers)
	}
	for _, id := range []int64{757, 758, 759} {
		count := 0
		for _, f := range snapshot.Findings {
			if strings.Contains(f.Reason, fmt.Sprintf("id %d:", id)) {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("row %d reported %d times", id, count)
		}
	}
	if _, err := DesiredRuntimeGrants(snapshot); err == nil {
		t.Fatal("incomplete snapshot accepted by pure policy")
	}
	snapshot.Blockers = nil
	grants := grantsFor(t, snapshot)
	// Removing unusable 1:M rows must not change any desired grant.
	_, cleanQuery := metadataSnapshotQueries(rows[4:])
	cleanDB := metadataTestDB(t, cleanQuery)
	cleanTx, _ := cleanDB.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	clean, err := LoadGrantSnapshot(context.Background(), cleanTx, config)
	cleanTx.Rollback()
	if err != nil {
		t.Fatal(err)
	}
	clean.Blockers = nil
	if !reflect.DeepEqual(grants, grantsFor(t, clean)) {
		t.Fatal("unusable relation rows changed valid policy")
	}
	findings, err := AuditRuntimeGrants(context.Background(), db, config)
	if err != nil {
		t.Fatal(err)
	}
	if !HasBlockers(findings) || !hasFinding(findings, "basic", "missing", "table", 10) || !hasFinding(findings, "basic", "excess_write", "table", 11) {
		t.Fatalf("audit stopped before comparison: %+v", findings)
	}
	for _, f := range findings {
		if strings.Contains(f.Reason, "private metadata value") {
			t.Fatal("metadata value disclosed")
		}
	}
}

func TestMetadataReaderErrorsKeepCauseAndHideRoleNames(t *testing.T) {
	config, query := metadataSnapshotQueries(nil)
	for _, test := range []struct {
		name, match, cause string
		scan               bool
	}{
		{"registry query", "FROM public.system_db_tables d ORDER BY d.id", "catalogue permission denied", false},
		{"child scan", "FROM public.system_foreign_key_relations_1_m ORDER BY id", "invalid syntax", true},
		{"trigger query", "SELECT t.oid,t.tgrelid", "trigger catalogue unavailable", false},
		{"default query", "SELECT a.oid,a.adrelid", "default catalogue unavailable", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := metadataTestDB(t, func(sql string, args []driver.NamedValue) (int, [][]driver.Value, error) {
				if strings.Contains(sql, test.match) {
					if test.scan {
						return 7, [][]driver.Value{{int64(901), "not an integer", int64(1), "parent_id", "", true, nil}}, nil
					}
					return 0, nil, errors.New(test.cause + " for " + config.Names["basic"])
				}
				return query(sql, args)
			})
			tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			_, err = LoadGrantSnapshot(context.Background(), tx, config)
			if err == nil || !strings.Contains(err.Error(), "LoadGrantSnapshot") || !strings.Contains(err.Error(), test.cause) || strings.Contains(err.Error(), config.Names["basic"]) {
				t.Fatalf("reader diagnostic: %v", err)
			}
		})
	}
}

func TestSQLPathReadersContinuePastDanglingObjects(t *testing.T) {
	for _, test := range []struct {
		name     string
		read     func(context.Context, *sql.Tx, *GrantSnapshot) error
		columns  int
		rows     [][]driver.Value
		identity string
	}{
		{"trigger", readTriggerDependencies, 4, [][]driver.Value{
			{int64(801), int64(999), "bd0a0b3593213d52cad42ba53ae32e5c", false},
			{int64(802), int64(10), "unreviewed", false},
		}, "tgrelid=999"},
		{"default", readDefaultFunctionDependencies, 8, [][]driver.Value{
			{int64(801), int64(999), "id", int64(803), "public", "app_request_actor_id", false, reviewedActorDefaultBody},
			{int64(802), int64(10), "id", int64(804), "public", "unknown_default", false, "unreviewed"},
		}, "adrelid=999"},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := metadataTestDB(t, func(string, []driver.NamedValue) (int, [][]driver.Value, error) { return test.columns, test.rows, nil })
			tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			snapshot := policyFixture()
			if err := test.read(context.Background(), tx, &snapshot); err != nil {
				t.Fatal(err)
			}
			if len(snapshot.Blockers) != 2 || !strings.Contains(snapshot.Blockers[0].Reason, "801") || !strings.Contains(snapshot.Blockers[0].Reason, test.identity) {
				t.Fatalf("catalogue row stopped reader: %+v", snapshot.Blockers)
			}
		})
	}
}

func TestEarlierFindingsSurviveLaterReaderFailure(t *testing.T) {
	config, query := metadataSnapshotQueries(nil)
	db := metadataTestDB(t, func(sql string, args []driver.NamedValue) (int, [][]driver.Value, error) {
		if strings.Contains(sql, "SELECT t.oid,t.tgrelid") {
			return 0, nil, errors.New("trigger catalogue unavailable")
		}
		return query(sql, args)
	})
	findings, err := AuditRuntimeGrants(context.Background(), db, config)
	if err != nil {
		t.Fatal(err)
	}
	registryFound, failureFound := false, false
	for _, f := range findings {
		registryFound = registryFound || f.Finding == "blocker" && strings.Contains(f.Reason, "id 904:")
		failureFound = failureFound || f.Role == "audit" && strings.Contains(f.Reason, "readTriggerDependencies") && strings.Contains(f.Reason, "trigger catalogue unavailable")
	}
	if !registryFound || !failureFound {
		t.Fatalf("earlier findings lost on reader failure: %+v", findings)
	}
}

func TestNullTargetWithReachableDirectUploadBlocks(t *testing.T) {
	config, query := metadataSnapshotQueries([][]driver.Value{{int64(758), int64(3), nil, "parent_id", "", true, []byte(`{"file_upload":{"filename_column":"filename","cache_targets":[]}}`)}})
	db := metadataTestDB(t, query)
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	snapshot, err := LoadGrantSnapshot(context.Background(), tx, config)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, f := range snapshot.Blockers {
		found = found || strings.Contains(f.Reason, "id 758:") && strings.Contains(f.Reason, "direct upload") && strings.Contains(f.Reason, "source_table_uid=3")
	}
	if !found {
		t.Fatal("reachable direct upload was silently treated as unused", snapshot.Blockers)
	}
	if _, err := DesiredRuntimeGrants(snapshot); err == nil {
		t.Fatal("source-only upload uncertainty allowed grant derivation")
	}
}
