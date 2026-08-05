package backend

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type instanceRoleMockDriver struct {
	role string
}

type instanceRoleMockConn struct {
	role string
}

type instanceRoleMockRows struct {
	cols []string
	vals []driver.Value
	done bool
}

var instanceRoleMockDriverCounter int64

func (d *instanceRoleMockDriver) Open(_ string) (driver.Conn, error) {
	return &instanceRoleMockConn{role: d.role}, nil
}

func (c *instanceRoleMockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}

func (c *instanceRoleMockConn) Close() error              { return nil }
func (c *instanceRoleMockConn) Begin() (driver.Tx, error) { return nil, fmt.Errorf("tx not supported") }

func (r *instanceRoleMockRows) Columns() []string { return r.cols }
func (r *instanceRoleMockRows) Close() error      { return nil }
func (r *instanceRoleMockRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	copy(dest, r.vals)
	return nil
}

func (c *instanceRoleMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "FROM system_config") &&
		len(args) > 0 &&
		args[0].Value == easelectInstanceRoleConfigKey {
		return &instanceRoleMockRows{
			cols: []string{"text_value"},
			vals: []driver.Value{c.role},
		}, nil
	}
	return nil, fmt.Errorf("unexpected query: %s", query)
}

func withInstanceRoleDB(t *testing.T, role string) {
	t.Helper()

	orig := Db
	name := fmt.Sprintf("instance_role_%d_%d", time.Now().UnixNano(), atomic.AddInt64(&instanceRoleMockDriverCounter, 1))
	sql.Register(name, &instanceRoleMockDriver{role: role})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	Db = db
	ResetEaselectInstanceRoleCache()
	t.Cleanup(func() {
		db.Close()
		Db = orig
		ResetEaselectInstanceRoleCache()
	})
}

func TestCloudManagementUIEnabledRequiresManagementRole(t *testing.T) {
	withInstanceRoleDB(t, EaselectInstanceRoleApplication)
	t.Setenv("CLOUD_MANAGEMENT_UI_ENABLED", "1")

	if CloudManagementUIEnabled() {
		t.Fatal("CLOUD_MANAGEMENT_UI_ENABLED=1 must not expose cloud management on an application instance")
	}
}

func TestCloudManagementUIEnabledAllowsManagementRoleByDefault(t *testing.T) {
	t.Setenv("CLOUD_MANAGEMENT_UI_ENABLED", "")
	withInstanceRoleDB(t, EaselectInstanceRoleManagement)

	if !CloudManagementUIEnabled() {
		t.Fatal("management instance role should expose cloud management when the legacy env gate is unset")
	}
}

func TestCloudManagementUIEnabledAllowsManagementRoleWithLegacyOptIn(t *testing.T) {
	t.Setenv("CLOUD_MANAGEMENT_UI_ENABLED", "true")
	withInstanceRoleDB(t, EaselectInstanceRoleManagement)

	if !CloudManagementUIEnabled() {
		t.Fatal("management instance role should expose cloud management with CLOUD_MANAGEMENT_UI_ENABLED=true")
	}
}

func TestCloudManagementUIEnabledSupportsExplicitLegacyDisable(t *testing.T) {
	t.Setenv("CLOUD_MANAGEMENT_UI_ENABLED", "0")
	withInstanceRoleDB(t, EaselectInstanceRoleManagement)

	if CloudManagementUIEnabled() {
		t.Fatal("CLOUD_MANAGEMENT_UI_ENABLED=0 should explicitly disable cloud management even on management")
	}
}

func TestShouldExposeCloudManagementDatasetName(t *testing.T) {
	withInstanceRoleDB(t, EaselectInstanceRoleApplication)
	t.Setenv("CLOUD_MANAGEMENT_UI_ENABLED", "0")
	if !ShouldExposeCloudManagementDatasetName("app_service_catalog") {
		t.Fatal("ordinary app datasets should remain exposed")
	}
	if ShouldExposeCloudManagementDatasetName("app_cloud_services") {
		t.Fatal("cloud-management datasets should be hidden on application instances")
	}
}

func TestShouldExposeCloudManagementDatasetNameOnManagement(t *testing.T) {
	withInstanceRoleDB(t, EaselectInstanceRoleManagement)
	t.Setenv("CLOUD_MANAGEMENT_UI_ENABLED", "1")
	if !ShouldExposeCloudManagementDatasetName("app_cloud_services") {
		t.Fatal("cloud-management datasets should be exposed on management instances")
	}
}
