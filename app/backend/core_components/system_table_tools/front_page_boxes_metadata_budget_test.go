// front_page_boxes_metadata_budget_test.go
// Proves Home reference validation uses deadline-aware pool queries.
// Connects the full facade to a context-recording database/sql driver.
// Covers languages, categories and sort references before canonical delegation.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
)

type homeReferenceBudgetDriver struct{ contexts *[]context.Context }
type homeReferenceBudgetConn struct {
	frontPageScopeConn
	contexts *[]context.Context
}

func (d homeReferenceBudgetDriver) Open(string) (driver.Conn, error) {
	return &homeReferenceBudgetConn{contexts: d.contexts}, nil
}

func (c *homeReferenceBudgetConn) QueryContext(ctx context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "system_languages") || strings.Contains(query, "count(DISTINCT category.slug)") || strings.Contains(query, "information_schema.columns") {
		*c.contexts = append(*c.contexts, ctx)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(300 * time.Millisecond):
			return nil, fmt.Errorf("unbounded reference read")
		}
	}
	return nil, fmt.Errorf("unused site setting")
}

func TestFrontPageBoxReferencePoolReadsReceiveRemainingDeadline(t *testing.T) {
	for _, field := range []string{"title language", "category", "sort column"} {
		t.Run(field, func(t *testing.T) {
			block := frontPageBlock{Dataset: "content", ResultLimit: 1, Enabled: true}
			switch field {
			case "title language":
				block.Title = json.RawMessage(`{"en":"Title"}`)
			case "category":
				block.Query = json.RawMessage(`{"row_group":["public-home"]}`)
			case "sort column":
				block.Query = json.RawMessage(`{"sort_column":"title"}`)
			}
			stubFrontPageRead(t, []frontPageBlock{block})
			var contexts []context.Context
			name := fmt.Sprintf("home_reference_budget_%d", frontPageScopeDriverID.Add(1))
			sql.Register(name, homeReferenceBudgetDriver{&contexts})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			old := backend.Db
			backend.Db = db
			t.Cleanup(func() { backend.Db = old })
			now := time.Now()
			frontPageNow = func() time.Time { return now }
			frontPageCanRead = func(int, string) bool { now = now.Add(2980 * time.Millisecond); return true }
			frontPageResultsHandler = func(http.ResponseWriter, *http.Request) { t.Fatal("validation delegated after timeout") }
			request := frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page")
			response := httptest.NewRecorder()
			start := time.Now()
			GetFrontPageHandler(response, request)
			var result struct {
				Blocks  []frontPageResultBlock `json:"blocks"`
				Partial bool                   `json:"partial"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || len(result.Blocks) != 0 || !result.Partial {
				t.Fatal("blocked references were not omitted", response.Code, response.Body.String(), err)
			}
			if len(contexts) != 1 {
				t.Fatal("expected one blocked reference read", len(contexts))
			}
			deadline, bounded := contexts[0].Deadline()
			if !bounded || deadline.Sub(start) > 50*time.Millisecond || time.Since(start) > 200*time.Millisecond || request.Context().Err() != nil {
				t.Fatal("reference pool escaped the remaining budget", bounded, deadline.Sub(start), time.Since(start))
			}
		})
	}
}
