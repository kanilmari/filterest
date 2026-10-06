// asset_enable_completion_test.go
// Exercises new tables, new relations, existing plain relations and early returns.
// Reuses the handler driver and empty policy catalogue, counting real boundaries.
// Grant comparison must follow persisted configuration on every successful path.
package dtt_asset_linking

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/runtime_grants/granttest"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

type assetEnableState struct {
	t                               *testing.T
	table, relation, profile, saved bool
	config                          string
	seeds, creates, comparisons     int
}
type assetEnableDriver struct{ state *assetEnableState }
type assetEnableConn struct {
	imageAssetLinkingMockConn
	state *assetEnableState
}

func (d assetEnableDriver) Open(string) (driver.Conn, error) {
	return &assetEnableConn{state: d.state}, nil
}
func (c *assetEnableConn) QueryContext(_ context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(q, "FROM actual WHERE wanted IS DISTINCT FROM present") {
		if !c.state.saved {
			c.state.t.Fatal("grant comparison preceded final configuration")
		}
		c.state.comparisons++
	}
	if rows, ok := granttest.BoundaryQuery(q, args); ok {
		return rows, nil
	}
	rows := func(n int, values ...[]driver.Value) driver.Rows {
		return &legacyAssetEnableRows{columns: n, values: values}
	}
	switch {
	case strings.Contains(q, "SELECT table_uid"):
		if args[0].Value == "parent" {
			return rows(1, []driver.Value{int64(10)}), nil
		}
		if c.state.table {
			return rows(1, []driver.Value{int64(20)}), nil
		}
		return rows(1), nil
	case strings.Contains(q, "SELECT COUNT(*) FROM information_schema.columns"):
		return rows(1, []driver.Value{int64(1)}), nil
	case strings.Contains(q, "fk.target_insert_specs::text"):
		if !c.state.relation {
			return rows(4), nil
		}
		var specs driver.Value
		if c.state.profile {
			specs = c.state.config
		}
		return rows(4, []driver.Value{int64(30), "parent", "parent_id", specs}), nil
	case strings.Contains(q, "ORDER BY src.table_name"):
		if c.state.profile {
			return rows(5, []driver.Value{int64(30), "parent_assets", "parent", "parent_id", c.state.config}), nil
		}
		return rows(5), nil
	case strings.Contains(q, "WHERE parent_id IS NULL"), strings.Contains(q, "WHERE parent_id = $1"):
		return rows(1, []driver.Value{int64(4)}), nil
	case strings.Contains(q, "SELECT c.oid, n.nspname AS schema_name"):
		return rows(3), nil
	case strings.Contains(q, "SELECT table_name, table_uid"):
		return rows(2), nil
	default:
		return nil, fmt.Errorf("unexpected asset query: %s", q)
	}
}
func (c *assetEnableConn) ExecContext(_ context.Context, q string, _ []driver.NamedValue) (driver.Result, error) {
	if granttest.IsPolicyLock(q) {
		return driver.RowsAffected(0), nil
	}
	if strings.Contains(q, "GRANT ") || strings.Contains(q, "REVOKE ") {
		c.state.t.Fatal("asset code copied ACLs", q)
	}
	if strings.HasPrefix(q, "CREATE TABLE") {
		c.state.table = true
		c.state.creates++
	}
	if strings.Contains(q, "INSERT INTO system_foreign_key_relations_1_m") {
		c.state.relation = true
		c.state.profile = true
	}
	if strings.Contains(q, "INSERT INTO system_group_table_func_rights") {
		c.state.seeds++
	}
	if strings.Contains(q, "SET target_insert_specs = $1") {
		c.state.saved = true
	}
	return driver.RowsAffected(1), nil
}

// Reuse the existing rows implementation for iteration and dynamic column counts.
type legacyAssetEnableRows struct {
	columns int
	values  [][]driver.Value
	imageAssetLinkingMockRows
}

func (r *legacyAssetEnableRows) Columns() []string { return make([]string, r.columns) }
func (r *legacyAssetEnableRows) Next(dest []driver.Value) error {
	r.imageAssetLinkingMockRows.rows = r.values
	err := r.imageAssetLinkingMockRows.Next(dest)
	return err
}

func TestAssetEnableCompletesEveryRelationPath(t *testing.T) {
	for _, profile := range []string{AssetProfileImage, AssetProfileAttachment} {
		for _, test := range []struct {
			name                        string
			table, relation, configured bool
			status, seeds, creates      int
		}{
			{"new table", false, false, false, 201, 1, 1}, {"existing table, new relation", true, false, false, 201, 1, 0},
			{"existing plain relation", true, true, false, 201, 1, 0}, {"existing profile early return", true, true, true, 200, 0, 0},
		} {
			t.Run(profile+"/"+test.name, func(t *testing.T) {
				granttest.ConfigureRoles(t)
				config := BuildImageFileUploadConfig("parent", 10, nil)
				handler := http.HandlerFunc(EnableImageAssetLinkingHandler)
				if profile == AssetProfileAttachment {
					config = BuildAttachmentFileUploadConfig("parent", 25, nil)
					handler = EnableAttachmentLinkingHandler
				}
				specs, err := BuildTargetInsertSpecsJSON(config)
				if err != nil {
					t.Fatal(err)
				}
				state := &assetEnableState{t: t, table: test.table, relation: test.relation, profile: test.configured, config: string(specs)}
				name := fmt.Sprintf("asset_enable_completion_%d", atomic.AddInt64(&imageAssetLinkingDriverCounter, 1))
				sql.Register(name, assetEnableDriver{state})
				db, err := sql.Open(name, "")
				if err != nil {
					t.Fatal(err)
				}
				defer db.Close()
				req := withImageLinkingTx(httptest.NewRequest("POST", "/api/asset-enable", strings.NewReader(`{"parent_table":"parent"}`)), db)
				rec := httptest.NewRecorder()
				handler(granttest.Recorder{ResponseRecorder: rec}, req)
				if rec.Code != test.status {
					t.Fatal(rec.Code, rec.Body)
				}
				if state.seeds != test.seeds || state.creates != test.creates || state.comparisons != 3 {
					t.Fatal("asset completion mismatch", state)
				}
			})
		}
	}
}
