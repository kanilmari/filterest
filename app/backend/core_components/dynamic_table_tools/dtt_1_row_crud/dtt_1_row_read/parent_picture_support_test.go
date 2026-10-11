// parent_picture_support_test.go
// Proves optional picture read failures preserve rows without a privileged retry.
// Complements actual handler/grant regressions with a grant-to-read failure race.
// Counts parent content queries separately from permitted gallery metadata reads.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

type parentPictureFailureDriver struct {
	calls *int
	deny  bool
}
type parentPictureFailureConn struct {
	canonicalAssetMockConn
	parentPictureFailureDriver
}

func (d parentPictureFailureDriver) Open(string) (driver.Conn, error) {
	return &parentPictureFailureConn{parentPictureFailureDriver: d}, nil
}

func (c *parentPictureFailureConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, `FROM "wl162_parent_picture"`) {
		*c.calls++
		if c.deny {
			return nil, fmt.Errorf("parent picture read denied")
		}
		return &legacyImageMockRows{columns: []string{"id", "cached_image"}, rows: [][]driver.Value{{int64(1), supportFixtureImage}}}, nil
	}
	return c.canonicalAssetMockConn.QueryContext(ctx, query, args)
}

func TestParentPictureSupportReadFailureNeverRetriesOwner(t *testing.T) {
	open := func(calls *int, deny bool) *sql.DB {
		t.Helper()
		name := fmt.Sprintf("parent_picture_failure_%d", atomic.AddInt64(&legacyImageMockCounter, 1))
		sql.Register(name, parentPictureFailureDriver{calls, deny})
		db, err := sql.Open(name, "")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		return db
	}
	var readerCalls, ownerCalls int
	reader, owner := open(&readerCalls, true), open(&ownerCalls, false)
	old := backend.Db
	backend.Db = owner
	t.Cleanup(func() { backend.Db = old })
	rows := []map[string]interface{}{{"id": int64(1)}}
	columns := map[int]dtt_models.ColumnInfo{2: {ColumnName: "cached_image", CardElement: "image"}}
	support := resolveRowSupportRequest(url.Values{"view_key": {"card"}})
	if err := prepareRowsForResponse(reader, "wl162_parent_picture", rows, columns, []string{"id"},
		dbutils.NewRequestActorContext(4, "basic"), support, nil); err != nil {
		t.Fatal("optional picture read rejected authorized row", err)
	}
	if readerCalls != 1 || ownerCalls != 0 || !reflect.DeepEqual(rows, []map[string]interface{}{{"id": int64(1)}}) {
		t.Fatal("picture read failure disclosed owner content or changed row", readerCalls, ownerCalls, rows)
	}
}
