// attachment_linking_status_handler_test.go
// HTTP tests for the shared attachment-linking status endpoint.
// Bridges the handler surface and the shared file_upload relation reader.
// Exists so relation_kind/foreign_key_column changes do not drift behind helper-only coverage.
package dtt_asset_linking

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
	"sync"
	"testing"
	"time"

	backend "easelect/backend/core_components"
)

type attachmentStatusQueuedQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type attachmentStatusState struct {
	mu      sync.Mutex
	queries []attachmentStatusQueuedQuery
}

type attachmentStatusDriver struct{ state *attachmentStatusState }
type attachmentStatusConn struct{ state *attachmentStatusState }
type attachmentStatusRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var attachmentStatusDriverRegisterMu sync.Mutex

func (d *attachmentStatusDriver) Open(string) (driver.Conn, error) {
	return &attachmentStatusConn{state: d.state}, nil
}

func (c *attachmentStatusConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported in attachment status handler test driver")
}

func (c *attachmentStatusConn) Close() error { return nil }
func (c *attachmentStatusConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions not used")
}

func (c *attachmentStatusConn) QueryContext(_ context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	if len(c.state.queries) == 0 {
		return nil, errors.New("unexpected query")
	}

	next := c.state.queries[0]
	c.state.queries = c.state.queries[1:]
	if next.err != nil {
		return nil, next.err
	}

	rows := make([][]driver.Value, len(next.rows))
	for i, row := range next.rows {
		rows[i] = append([]driver.Value(nil), row...)
	}

	return &attachmentStatusRows{
		cols: append([]string(nil), next.cols...),
		rows: rows,
	}, nil
}

func (r *attachmentStatusRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *attachmentStatusRows) Close() error      { return nil }

func (r *attachmentStatusRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func openAttachmentStatusDB(t *testing.T, queries []attachmentStatusQueuedQuery) *sql.DB {
	t.Helper()
	attachmentStatusDriverRegisterMu.Lock()
	defer attachmentStatusDriverRegisterMu.Unlock()

	state := &attachmentStatusState{
		queries: append([]attachmentStatusQueuedQuery(nil), queries...),
	}
	driverName := fmt.Sprintf("attachment_status_handler_%d", time.Now().UnixNano())
	sql.Register(driverName, &attachmentStatusDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	t.Cleanup(func() {
		_ = db.Close()
	})

	return db
}

func TestGetAttachmentLinkingStatusHandlerReturnsRelationMetadata(t *testing.T) {
	sharedSpecs, err := json.Marshal(BuildTargetInsertSpecs(SetProfileUploadConfig(
		BuildImageFileUploadConfig("services", 10, []string{"png"}),
		AssetProfileAttachment,
		BuildAttachmentProfileConfig("services", 25, []string{"pdf", "docx"}),
	)))
	if err != nil {
		t.Fatalf("json.Marshal(sharedSpecs): %v", err)
	}

	db := openAttachmentStatusDB(t, []attachmentStatusQueuedQuery{
		{
			cols: []string{"id", "child_table", "parent_table", "source_column_name", "target_insert_specs"},
			rows: [][]driver.Value{{
				int64(17),
				"services_assets",
				"services",
				"services_id",
				sharedSpecs,
			}},
		},
	})

	previousDB := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = previousDB
	})

	req := httptest.NewRequest(http.MethodGet, "/api/asset-linking/attachments/status?table=services", nil)
	rec := httptest.NewRecorder()

	GetAttachmentLinkingStatusHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body map[string][]AttachmentLinkingInfo
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	linkings := body["asset_linkings"]
	if len(linkings) != 1 {
		t.Fatalf("len(asset_linkings) = %d, want 1", len(linkings))
	}
	if linkings[0].ForeignKeyColumn != "services_id" {
		t.Fatalf("ForeignKeyColumn = %q, want services_id", linkings[0].ForeignKeyColumn)
	}
	if linkings[0].RelationKind != RelationKindSharedAsset {
		t.Fatalf("RelationKind = %q, want %q", linkings[0].RelationKind, RelationKindSharedAsset)
	}
}
