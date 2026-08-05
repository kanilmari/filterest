// storage_read_authorization_test.go
// Locks the fail-closed storage-read contract across dataset, row, field, and relation permissions.
// Uses deterministic read-only SQL drivers so authorization behavior is tested without mutating a database.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"easelect/backend/core_components/dbutils"
)

type storageAuthorizationQueuedQuery struct {
	contains string
	columns  []string
	rows     [][]driver.Value
	err      error
}

type storageAuthorizationDriverState struct {
	mu      sync.Mutex
	queries []storageAuthorizationQueuedQuery
}

type storageAuthorizationTestDriver struct {
	state *storageAuthorizationDriverState
}

type storageAuthorizationTestConn struct {
	state *storageAuthorizationDriverState
}

type storageAuthorizationTestTx struct{}

type storageAuthorizationTestRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

var storageAuthorizationDriverCounter uint64

func (d storageAuthorizationTestDriver) Open(string) (driver.Conn, error) {
	return &storageAuthorizationTestConn{state: d.state}, nil
}

func (*storageAuthorizationTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare is not supported by storage authorization test driver")
}

func (*storageAuthorizationTestConn) Close() error { return nil }

func (*storageAuthorizationTestConn) Begin() (driver.Tx, error) {
	return &storageAuthorizationTestTx{}, nil
}

func (*storageAuthorizationTestTx) Commit() error   { return nil }
func (*storageAuthorizationTestTx) Rollback() error { return nil }

func (c *storageAuthorizationTestConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()
	if len(c.state.queries) == 0 {
		return nil, fmt.Errorf("unexpected storage authorization query: %s", query)
	}
	next := c.state.queries[0]
	c.state.queries = c.state.queries[1:]
	if next.contains != "" && !strings.Contains(query, next.contains) {
		return nil, fmt.Errorf("storage authorization query %q did not contain %q", query, next.contains)
	}
	if next.err != nil {
		return nil, next.err
	}
	return &storageAuthorizationTestRows{columns: next.columns, rows: next.rows}, nil
}

func (r *storageAuthorizationTestRows) Columns() []string { return r.columns }
func (*storageAuthorizationTestRows) Close() error        { return nil }

func (r *storageAuthorizationTestRows) Next(dest []driver.Value) error {
	if r.index >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}

func openStorageAuthorizationTestDB(t *testing.T, queries []storageAuthorizationQueuedQuery) (*sql.DB, *storageAuthorizationDriverState) {
	t.Helper()
	state := &storageAuthorizationDriverState{queries: append([]storageAuthorizationQueuedQuery(nil), queries...)}
	driverName := fmt.Sprintf("storage_authorization_%d", atomic.AddUint64(&storageAuthorizationDriverCounter, 1))
	sql.Register(driverName, storageAuthorizationTestDriver{state: state})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open(%s): %v", driverName, err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db, state
}

func assertStorageAuthorizationQueriesDrained(t *testing.T, state *storageAuthorizationDriverState) {
	t.Helper()
	state.mu.Lock()
	defer state.mu.Unlock()
	if len(state.queries) != 0 {
		t.Fatalf("%d expected storage authorization queries were not executed; next contains %q", len(state.queries), state.queries[0].contains)
	}
}

func storagePermissionLookup(tableName string) storageAuthorizationQueuedQuery {
	return storageAuthorizationQueuedQuery{
		contains: "FROM system_group_table_func_rights",
		columns:  []string{"allowed"},
		rows:     [][]driver.Value{{int64(1)}},
	}
}

func storageTableLookup(tableName string) storageAuthorizationQueuedQuery {
	return storageAuthorizationQueuedQuery{
		contains: "SELECT table_name",
		columns:  []string{"table_name"},
		rows:     [][]driver.Value{{tableName}},
	}
}

func emptyStorageRowPolicy() storageAuthorizationQueuedQuery {
	return storageAuthorizationQueuedQuery{
		contains: "must_be_true_unless_own = true",
		columns:  []string{"column_name"},
		rows:     nil,
	}
}

func storageRowVisibility(visible bool) storageAuthorizationQueuedQuery {
	return storageAuthorizationQueuedQuery{
		contains: "SELECT EXISTS",
		columns:  []string{"exists"},
		rows:     [][]driver.Value{{visible}},
	}
}

func storageSelectableQuery(columns ...string) storageAuthorizationQueuedQuery {
	rows := make([][]driver.Value, 0, len(columns))
	for _, column := range columns {
		rows = append(rows, []driver.Value{column})
	}
	return storageAuthorizationQueuedQuery{
		contains: "information_schema.column_privileges",
		columns:  []string{"column_name"},
		rows:     rows,
	}
}

func storageMediaColumns(columns ...string) storageAuthorizationQueuedQuery {
	rows := make([][]driver.Value, 0, len(columns))
	for _, column := range columns {
		rows = append(rows, []driver.Value{column})
	}
	return storageAuthorizationQueuedQuery{
		contains: "SELECT DISTINCT scd.column_name",
		columns:  []string{"column_name"},
		rows:     rows,
	}
}

func storageRelations(rows ...[]driver.Value) storageAuthorizationQueuedQuery {
	return storageAuthorizationQueuedQuery{
		contains: "fk.target_insert_specs",
		columns:  []string{"id", "child_table", "parent_table", "source_column_name", "target_insert_specs"},
		rows:     rows,
	}
}

func canonicalStorageRequest() StorageReadRequest {
	return StorageReadRequest{TableUID: "104", ParentRowID: 7, Variant: "original", Filename: "104_7_9.png"}
}

func TestAuthorizeStorageReadAllowsVisibleSelectableParentCache(t *testing.T) {
	permissionDB, permissionState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		storageTableLookup("app_docs"),
		storagePermissionLookup("app_docs"),
		storageMediaColumns("cached_image"),
	})
	roleDB, roleState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		emptyStorageRowPolicy(),
		storageRowVisibility(true),
		storageSelectableQuery("id", "cached_image"),
		{
			contains: `SELECT "cached_image"::text FROM "app_docs"`,
			columns:  []string{"cached_image"},
			rows:     [][]driver.Value{{"104_7_9.png"}},
		},
	})

	decision, err := AuthorizeStorageRead(
		context.Background(),
		permissionDB,
		roleDB,
		dbutils.NewRequestActorContext(42, "basic"),
		canonicalStorageRequest(),
	)
	if err != nil || decision != StorageReadAllowed {
		t.Fatalf("AuthorizeStorageRead() = (%v, %v), want allowed nil", decision, err)
	}
	assertStorageAuthorizationQueriesDrained(t, permissionState)
	assertStorageAuthorizationQueriesDrained(t, roleState)
}

func TestAuthorizeStorageReadUsesRequestTransactionForRLSPilot(t *testing.T) {
	permissionDB, permissionState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		storageTableLookup("app_service_catalog"),
		storagePermissionLookup("app_service_catalog"),
		storageMediaColumns("cached_image"),
	})
	roleDB, roleState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		storageRowVisibility(true),
		storageSelectableQuery("id", "cached_image"),
		{
			contains: `SELECT "cached_image"::text FROM "app_service_catalog"`,
			columns:  []string{"cached_image"},
			rows:     [][]driver.Value{{"104_7_9.png"}},
		},
	})
	tx, err := roleDB.Begin()
	if err != nil {
		t.Fatalf("roleDB.Begin(): %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback() })
	ctx := dbutils.SetTx(context.Background(), tx)

	decision, err := AuthorizeStorageRead(
		ctx,
		permissionDB,
		roleDB,
		dbutils.NewRequestActorContext(42, "basic"),
		canonicalStorageRequest(),
	)
	if err != nil || decision != StorageReadAllowed {
		t.Fatalf("AuthorizeStorageRead(RLS pilot) = (%v, %v), want allowed nil", decision, err)
	}
	assertStorageAuthorizationQueriesDrained(t, permissionState)
	assertStorageAuthorizationQueriesDrained(t, roleState)
}

func TestAuthorizeStorageReadReusesSamePoolTransactionForRLSPilot(t *testing.T) {
	db, state := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		storageTableLookup("app_service_catalog"),
		storagePermissionLookup("app_service_catalog"),
		storageRowVisibility(true),
		storageSelectableQuery("id", "cached_image"),
		storageMediaColumns("cached_image"),
		{
			contains: `SELECT "cached_image"::text FROM "app_service_catalog"`,
			columns:  []string{"cached_image"},
			rows:     [][]driver.Value{{"104_7_9.png"}},
		},
	})
	ctx := dbutils.SetLazyTx(context.Background(), dbutils.NewLazyTx(db))

	decision, err := AuthorizeStorageRead(
		ctx,
		db,
		db,
		dbutils.NewRequestActorContext(42, "admin"),
		canonicalStorageRequest(),
	)
	if err != nil || decision != StorageReadAllowed {
		t.Fatalf("AuthorizeStorageRead(same-pool RLS pilot) = (%v, %v), want allowed nil", decision, err)
	}
	tx, ok := dbutils.PeekTx(ctx)
	if !ok {
		t.Fatal("same-pool RLS pilot did not open the request transaction")
	}
	t.Cleanup(func() { _ = tx.Rollback() })
	assertStorageAuthorizationQueriesDrained(t, state)
}

func TestAuthorizeStorageReadRejectsHiddenParentAndDeniedDataset(t *testing.T) {
	t.Run("hidden parent", func(t *testing.T) {
		permissionDB, permissionState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
			storageTableLookup("app_docs"),
			storagePermissionLookup("app_docs"),
		})
		roleDB, roleState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
			emptyStorageRowPolicy(),
			storageRowVisibility(false),
		})

		decision, err := AuthorizeStorageRead(context.Background(), permissionDB, roleDB, dbutils.NewRequestActorContext(42, "basic"), canonicalStorageRequest())
		if err != nil || decision != StorageReadNotFound {
			t.Fatalf("AuthorizeStorageRead(hidden parent) = (%v, %v), want not-found nil", decision, err)
		}
		assertStorageAuthorizationQueriesDrained(t, permissionState)
		assertStorageAuthorizationQueriesDrained(t, roleState)
	})

	t.Run("dataset denied", func(t *testing.T) {
		permissionDB, permissionState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
			storageTableLookup("app_docs"),
			{
				contains: "FROM system_group_table_func_rights",
				columns:  []string{"allowed"},
				rows:     nil,
			},
		})
		roleDB, roleState := openStorageAuthorizationTestDB(t, nil)

		decision, err := AuthorizeStorageRead(context.Background(), permissionDB, roleDB, dbutils.NewRequestActorContext(42, "basic"), canonicalStorageRequest())
		if err != nil || decision != StorageReadForbidden {
			t.Fatalf("AuthorizeStorageRead(dataset denied) = (%v, %v), want forbidden nil", decision, err)
		}
		assertStorageAuthorizationQueriesDrained(t, permissionState)
		assertStorageAuthorizationQueriesDrained(t, roleState)
	})
}

func TestAuthorizeStorageReadRequiresSelectableParentMediaField(t *testing.T) {
	permissionDB, permissionState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		storageTableLookup("app_docs"),
		storagePermissionLookup("app_docs"),
		storageMediaColumns("cached_image"),
		storageRelations(),
	})
	roleDB, roleState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		emptyStorageRowPolicy(),
		storageRowVisibility(true),
		storageSelectableQuery("id"),
	})

	decision, err := AuthorizeStorageRead(context.Background(), permissionDB, roleDB, dbutils.NewRequestActorContext(42, "basic"), canonicalStorageRequest())
	if err != nil || decision != StorageReadNotFound {
		t.Fatalf("AuthorizeStorageRead(denied field) = (%v, %v), want not-found nil", decision, err)
	}
	assertStorageAuthorizationQueriesDrained(t, permissionState)
	assertStorageAuthorizationQueriesDrained(t, roleState)
}

func TestAuthorizeStorageReadAllowsExactVisibleChildRelation(t *testing.T) {
	relationConfig := []byte(`{"file_upload":{"enabled":true,"filename_column":"filename"}}`)
	permissionDB, permissionState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		storageTableLookup("app_docs"),
		storagePermissionLookup("app_docs"),
		storageMediaColumns(),
		storageRelations([]driver.Value{int64(5), "app_docs_assets", "app_docs", "app_docs_id", relationConfig}),
		storagePermissionLookup("app_docs_assets"),
	})
	roleDB, roleState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		emptyStorageRowPolicy(),
		storageRowVisibility(true),
		storageSelectableQuery("id"),
		emptyStorageRowPolicy(),
		storageSelectableQuery("app_docs_id", "filename"),
		{
			contains: `SELECT "app_docs_id", "filename"::text FROM "app_docs_assets"`,
			columns:  []string{"app_docs_id", "filename"},
			rows:     [][]driver.Value{{int64(7), "104/7/original/104_7_9.png"}},
		},
	})

	decision, err := AuthorizeStorageRead(context.Background(), permissionDB, roleDB, dbutils.NewRequestActorContext(42, "basic"), canonicalStorageRequest())
	if err != nil || decision != StorageReadAllowed {
		t.Fatalf("AuthorizeStorageRead(child relation) = (%v, %v), want allowed nil", decision, err)
	}
	assertStorageAuthorizationQueriesDrained(t, permissionState)
	assertStorageAuthorizationQueriesDrained(t, roleState)
}

func TestAuthorizeStorageReadRejectsUnrelatedOrFieldDeniedChild(t *testing.T) {
	relationConfig := []byte(`{"file_upload":{"enabled":true,"filename_column":"filename"}}`)
	for _, testCase := range []struct {
		name              string
		selectableColumns []string
		childRows         [][]driver.Value
		expectsChildQuery bool
	}{
		{name: "unrelated filename", selectableColumns: []string{"app_docs_id", "filename"}, childRows: [][]driver.Value{{int64(7), "104_7_10.png"}}, expectsChildQuery: true},
		{name: "filename field denied", selectableColumns: []string{"app_docs_id"}, expectsChildQuery: false},
		{name: "hidden child row", selectableColumns: []string{"app_docs_id", "filename"}, childRows: nil, expectsChildQuery: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			permissionDB, permissionState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
				storageTableLookup("app_docs"),
				storagePermissionLookup("app_docs"),
				storageMediaColumns(),
				storageRelations([]driver.Value{int64(5), "app_docs_assets", "app_docs", "app_docs_id", relationConfig}),
				storagePermissionLookup("app_docs_assets"),
			})
			roleQueries := []storageAuthorizationQueuedQuery{
				emptyStorageRowPolicy(),
				storageRowVisibility(true),
				storageSelectableQuery("id"),
				emptyStorageRowPolicy(),
				storageSelectableQuery(testCase.selectableColumns...),
			}
			if testCase.expectsChildQuery {
				roleQueries = append(roleQueries, storageAuthorizationQueuedQuery{
					contains: `SELECT "app_docs_id", "filename"::text FROM "app_docs_assets"`,
					columns:  []string{"app_docs_id", "filename"},
					rows:     testCase.childRows,
				})
			}
			roleDB, roleState := openStorageAuthorizationTestDB(t, roleQueries)

			decision, err := AuthorizeStorageRead(context.Background(), permissionDB, roleDB, dbutils.NewRequestActorContext(42, "basic"), canonicalStorageRequest())
			if err != nil || decision != StorageReadNotFound {
				t.Fatalf("AuthorizeStorageRead(%s) = (%v, %v), want not-found nil", testCase.name, decision, err)
			}
			assertStorageAuthorizationQueriesDrained(t, permissionState)
			assertStorageAuthorizationQueriesDrained(t, roleState)
		})
	}
}

func TestAuthorizeStorageReadRejectsChildDatasetWithoutReadPermission(t *testing.T) {
	relationConfig := []byte(`{"file_upload":{"enabled":true,"filename_column":"filename"}}`)
	permissionDB, permissionState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		storageTableLookup("app_docs"),
		storagePermissionLookup("app_docs"),
		storageMediaColumns(),
		storageRelations([]driver.Value{int64(5), "app_docs_assets", "app_docs", "app_docs_id", relationConfig}),
		{
			contains: "FROM system_group_table_func_rights",
			columns:  []string{"allowed"},
			rows:     nil,
		},
	})
	roleDB, roleState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		emptyStorageRowPolicy(),
		storageRowVisibility(true),
		storageSelectableQuery("id"),
	})

	decision, err := AuthorizeStorageRead(context.Background(), permissionDB, roleDB, dbutils.NewRequestActorContext(42, "basic"), canonicalStorageRequest())
	if err != nil || decision != StorageReadNotFound {
		t.Fatalf("AuthorizeStorageRead(child dataset denied) = (%v, %v), want not-found nil", decision, err)
	}
	assertStorageAuthorizationQueriesDrained(t, permissionState)
	assertStorageAuthorizationQueriesDrained(t, roleState)
}

func TestAuthorizeStorageReadAllowsLegacyFilenameRootOnlyThroughVisibleRelation(t *testing.T) {
	relationConfig := []byte(`{"file_upload":{"enabled":true,"filename_column":"filename"}}`)
	request := StorageReadRequest{TableUID: "612", ParentRowID: 7, Variant: "original", Filename: "612_7_7.png"}
	permissionDB, permissionState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		{contains: "SELECT table_name", columns: []string{"table_name"}, rows: nil},
		storageRelations([]driver.Value{int64(8), "app_tasks_assets", "app_tasks", "app_tasks_id", relationConfig}),
		{contains: "SELECT table_uid", columns: []string{"table_uid"}, rows: [][]driver.Value{{int64(346)}}},
		storagePermissionLookup("app_tasks_assets"),
		storagePermissionLookup("app_tasks"),
	})
	roleDB, roleState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		emptyStorageRowPolicy(),
		storageSelectableQuery("app_tasks_id", "filename"),
		{
			contains: `SELECT "app_tasks_id", "filename"::text FROM "app_tasks_assets"`,
			columns:  []string{"app_tasks_id", "filename"},
			rows:     [][]driver.Value{{int64(7), "612_7_7.png"}},
		},
		emptyStorageRowPolicy(),
		storageRowVisibility(true),
	})

	decision, err := AuthorizeStorageRead(context.Background(), permissionDB, roleDB, dbutils.NewRequestActorContext(42, "basic"), request)
	if err != nil || decision != StorageReadAllowed {
		t.Fatalf("AuthorizeStorageRead(legacy relation) = (%v, %v), want allowed nil", decision, err)
	}
	assertStorageAuthorizationQueriesDrained(t, permissionState)
	assertStorageAuthorizationQueriesDrained(t, roleState)
}

func TestAuthorizeStorageReadFailsClosedOnMalformedRelationMetadata(t *testing.T) {
	permissionDB, permissionState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		storageTableLookup("app_docs"),
		storagePermissionLookup("app_docs"),
		storageMediaColumns(),
		storageRelations([]driver.Value{int64(5), "app_docs_assets", "app_docs", "app_docs_id", []byte(`{"file_upload":`)}),
	})
	roleDB, roleState := openStorageAuthorizationTestDB(t, []storageAuthorizationQueuedQuery{
		emptyStorageRowPolicy(),
		storageRowVisibility(true),
		storageSelectableQuery("id"),
	})

	decision, err := AuthorizeStorageRead(context.Background(), permissionDB, roleDB, dbutils.NewRequestActorContext(42, "basic"), canonicalStorageRequest())
	if err == nil || decision != StorageReadNotFound {
		t.Fatalf("AuthorizeStorageRead(malformed relation) = (%v, %v), want not-found error", decision, err)
	}
	assertStorageAuthorizationQueriesDrained(t, permissionState)
	assertStorageAuthorizationQueriesDrained(t, roleState)
}

func TestNormalizeStorageReferenceSupportsCanonicalAndLegacyShapes(t *testing.T) {
	testCases := []struct {
		name      string
		stored    string
		defaultID string
		rowID     int64
		wantUID   string
		wantRow   int64
		wantFile  string
		wantOK    bool
	}{
		{name: "flat canonical", stored: "104_7_9.png", defaultID: "104", rowID: 7, wantUID: "104", wantRow: 7, wantFile: "104_7_9.png", wantOK: true},
		{name: "structured", stored: "104/7/300/104_7_9.png", defaultID: "104", rowID: 7, wantUID: "104", wantRow: 7, wantFile: "104_7_9.png", wantOK: true},
		{name: "full storage URL", stored: "https://example.test/storage/104/7/original/104_7_9.png?download=1", defaultID: "104", rowID: 7, wantUID: "104", wantRow: 7, wantFile: "104_7_9.png", wantOK: true},
		{name: "arbitrary external URL rejected", stored: "https://evil.test/not-storage/104_7_9.png", defaultID: "104", rowID: 7, wantOK: false},
		{name: "arbitrary prefix rejected", stored: "not-storage/104_7_9.png", defaultID: "104", rowID: 7, wantOK: false},
		{name: "unknown variant rejected", stored: "104/7/private/104_7_9.png", defaultID: "104", rowID: 7, wantOK: false},
		{name: "legacy encoded root", stored: "612_7_7.png", defaultID: "346", rowID: 7, wantUID: "612", wantRow: 7, wantFile: "612_7_7.png", wantOK: true},
		{name: "simple leaf uses parent", stored: "hero.png", defaultID: "104", rowID: 7, wantUID: "104", wantRow: 7, wantFile: "hero.png", wantOK: true},
		{name: "traversal rejected", stored: "../hero.png", defaultID: "104", rowID: 7, wantOK: false},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			uid, rowID, filename, ok := normalizeStorageReference(testCase.stored, testCase.defaultID, testCase.rowID)
			if uid != testCase.wantUID || rowID != testCase.wantRow || filename != testCase.wantFile || ok != testCase.wantOK {
				t.Fatalf("normalizeStorageReference(%q) = (%q, %d, %q, %v), want (%q, %d, %q, %v)", testCase.stored, uid, rowID, filename, ok, testCase.wantUID, testCase.wantRow, testCase.wantFile, testCase.wantOK)
			}
		})
	}
}
