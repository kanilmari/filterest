// permissions_route_snapshot_test.go
// Verifies read-only permission snapshots include route and scope identities.
// Connects the HTTP permission reader to a small database driver and a disposable PostgreSQL fixture.
// Prevents missing-view warnings from relying on numeric function IDs or incomplete reads.
package backend

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

type permissionSnapshotDriver struct{ fail bool }
type permissionSnapshotConnection struct{ fail bool }
type permissionSnapshotRows struct {
	read bool
	fail bool
}

var permissionSnapshotSequence atomic.Uint64

func (d permissionSnapshotDriver) Open(string) (driver.Conn, error) {
	return permissionSnapshotConnection{fail: d.fail}, nil
}
func (permissionSnapshotConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unsupported")
}
func (permissionSnapshotConnection) Close() error              { return nil }
func (permissionSnapshotConnection) Begin() (driver.Tx, error) { return nil, errors.New("read only") }
func (c permissionSnapshotConnection) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if !strings.Contains(query, "f.url_route_endpoint") || !strings.Contains(query, "f.disabled = false") {
		return nil, errors.New("route identity and disabled-function filter required")
	}
	return &permissionSnapshotRows{fail: c.fail}, nil
}
func (*permissionSnapshotRows) Columns() []string {
	return []string{"group", "function", "schema", "dataset", "uid", "route"}
}
func (*permissionSnapshotRows) Close() error { return nil }
func (r *permissionSnapshotRows) Next(values []driver.Value) error {
	if r.read {
		if r.fail {
			return errors.New("snapshot interrupted")
		}
		return io.EOF
	}
	r.read = true
	copy(values, []driver.Value{int64(7), int64(412), "project_data", nil, int64(0), "/ui/view/article_view"})
	return nil
}

func TestPermissionSnapshotRouteAndPartialRead(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			name := fmt.Sprintf("permission-snapshot-%d", permissionSnapshotSequence.Add(1))
			sql.Register(name, permissionSnapshotDriver{fail: fail})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			previous := Db
			Db = db
			defer func() { Db = previous }()
			response := httptest.NewRecorder()
			getPermissions(response, httptest.NewRequest(http.MethodGet, "/api/dataset_permissions", nil))
			if fail {
				if response.Code != http.StatusInternalServerError {
					t.Fatalf("partial read returned %d: %s", response.Code, response.Body.String())
				}
				return
			}
			var rights []Permission
			if err := json.Unmarshal(response.Body.Bytes(), &rights); err != nil {
				t.Fatal(err)
			}
			if response.Code != http.StatusOK || len(rights) != 1 || rights[0].FunctionRoute != "/ui/view/article_view" || rights[0].TargetTableUID != 0 || rights[0].TargetSchemaName != "project_data" {
				t.Fatalf("unexpected snapshot: %d %+v", response.Code, rights)
			}
		})
	}
}

func TestPermissionSnapshotRoutesPostgres(t *testing.T) {
	cluster := startWriteRevocationCluster(t)
	db := cluster.open("test_owner", "postgres")
	cluster.exec(db, `CREATE TABLE system_functions(id integer PRIMARY KEY, disabled boolean, url_route_endpoint text);
CREATE TABLE system_db_tables(table_uid integer PRIMARY KEY, table_name text);
CREATE TABLE system_group_table_func_rights(user_group_id integer, function_id integer, target_schema_name text, target_table_uid integer);
INSERT INTO system_functions VALUES (31,false,'/ui/view/article_view'),(32,true,'/ui/view/article_view'),(33,NULL,'/ui/view/article_view');
INSERT INTO system_db_tables VALUES (8,'snapshot_dataset');
INSERT INTO system_group_table_func_rights VALUES (7,31,'public',NULL),(9,31,'public',8),(10,31,'project_data',NULL),(7,32,'public',NULL),(7,33,'public',NULL);`)
	previous := Db
	Db = db
	defer func() { Db = previous }()
	response := httptest.NewRecorder()
	getPermissions(response, httptest.NewRequest(http.MethodGet, "/api/dataset_permissions", nil))
	var rights []Permission
	if err := json.Unmarshal(response.Body.Bytes(), &rights); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || len(rights) != 3 {
		t.Fatalf("snapshot: %d %s", response.Code, response.Body.String())
	}
	scopes := map[int]Permission{}
	for _, right := range rights {
		if right.FunctionRoute != "/ui/view/article_view" {
			t.Fatalf("unexpected route: %+v", right)
		}
		scopes[right.AuthUserGroupID] = right
	}
	if scopes[7].TargetTableUID != 0 || scopes[9].TargetTableUID != 8 || scopes[9].TargetTableName != "snapshot_dataset" {
		t.Fatalf("scope identity lost: %+v", scopes)
	}
	if scopes[10].TargetTableUID != 0 || scopes[10].TargetSchemaName != "project_data" {
		t.Fatalf("schema-independent global grant lost: %+v", scopes[10])
	}
}
