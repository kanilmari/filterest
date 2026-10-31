// results_metadata_budget_test.go
// Proves canonical cold metadata reads inherit Home's remaining pool deadline.
// Connects the real results handler to a context-recording database/sql driver.
// The original request remains usable after an unavailable metadata read.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
)

type resultsMetadataBudgetDriver struct{ seen *context.Context }
type resultsMetadataBudgetConn struct {
	canonicalAssetMockConn
	seen *context.Context
}

func (d resultsMetadataBudgetDriver) Open(string) (driver.Conn, error) {
	return &resultsMetadataBudgetConn{seen: d.seen}, nil
}
func (c *resultsMetadataBudgetConn) QueryContext(ctx context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "dataset.ui_hidden") {
		return &legacyImageMockRows{columns: []string{"hidden"}, rows: [][]driver.Value{{false}}}, nil
	}
	*c.seen = ctx
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(300 * time.Millisecond):
		return nil, fmt.Errorf("unbounded cold metadata read")
	}
}

func TestResultsColdMetadataPoolReadReceivesDeadline(t *testing.T) {
	var seen context.Context
	name := fmt.Sprintf("results_metadata_budget_%d", atomic.AddInt64(&legacyImageMockCounter, 1))
	sql.Register(name, resultsMetadataBudgetDriver{&seen})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	old, basic := backend.Db, backend.DbBasic
	backend.Db, backend.DbBasic = db, db
	t.Cleanup(func() { backend.Db, backend.DbBasic = old, basic })
	request := kindRequest(t, "/api/get-results?dataset=cold_budget_metadata")
	budget, cancel := context.WithTimeout(request.Context(), 20*time.Millisecond)
	defer cancel()
	request = request.WithContext(dbutils.WithReadBudget(request.Context(), budget))
	response := httptest.NewRecorder()
	start := time.Now()
	GetResultsHandlerWrapper(response, request)
	if response.Code != 500 || seen == nil || request.Context().Err() != nil || time.Since(start) > 200*time.Millisecond {
		t.Fatal("cold metadata escaped the operation budget", response.Code, time.Since(start), response.Body.String())
	}
	deadline, bounded := seen.Deadline()
	want, _ := budget.Deadline()
	if !bounded || deadline != want {
		t.Fatal("pool read lacked remaining deadline", deadline, want)
	}
}
