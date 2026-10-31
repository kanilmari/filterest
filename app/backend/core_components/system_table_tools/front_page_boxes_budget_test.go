// front_page_boxes_budget_test.go
// Proves Home's box budget cannot own the shared request transaction.
// Connects the complete facade, lazy transaction opener and a controlled clock.
// Keeps late reads private while preserving the request's deadline and box cap.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
)

func TestFrontPageBoxesDelegateKeepsOriginalTransactionContext(t *testing.T) {
	for _, late := range []bool{false, true} {
		t.Run(fmt.Sprintf("late=%t", late), func(t *testing.T) {
			stubFrontPageRead(t, []frontPageBlock{
				{Dataset: "app_service_catalog", ResultLimit: 1, Enabled: true},
				{Dataset: "later_box", ResultLimit: 1, Enabled: true},
			})
			now := time.Now()
			frontPageNow = func() time.Time { return now }
			lazy := rowGroupMockLazyTx(t)
			var beginContext context.Context
			lazy.SetAdmissionHook(func(ctx context.Context) (func() error, error) {
				beginContext = ctx
				return func() error { return nil }, nil
			})
			request := frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page")
			parent, cancel := context.WithTimeout(request.Context(), time.Minute)
			defer cancel()
			request = request.WithContext(dbutils.SetLazyTx(parent, lazy))
			var shared *sql.Tx
			calls := 0
			frontPageResultsHandler = func(w http.ResponseWriter, delegated *http.Request) {
				calls++
				if calls == 1 && lazy.WasStarted() {
					t.Fatal("transaction opened before the pilot delegate")
				}
				if read.ResultsPageSizeFromContext(delegated.Context()) != 1 {
					t.Fatal("box lost its trusted page size")
				}
				tx, err := dbutils.RequireTxWithError(delegated.Context())
				if err != nil || (shared != nil && shared != tx) {
					t.Fatal("delegate lost the shared transaction", err)
				}
				shared = tx
				deadline, _ := beginContext.Deadline()
				parentDeadline, _ := parent.Deadline()
				if beginContext.Done() != parent.Done() || deadline != parentDeadline {
					t.Fatal("box budget context owns the shared transaction")
				}
				fmt.Fprint(w, `{"columns":["id"],"types":{},"data":[{"id":7}]}`)
				if late {
					now = now.Add(3 * time.Second)
				}
			}
			response := httptest.NewRecorder()
			GetFrontPageHandler(response, request)
			var result struct {
				Blocks  []frontPageResultBlock `json:"blocks"`
				Partial bool                   `json:"partial"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || result.Partial != late {
				t.Fatal("invalid Home response", response.Body.String(), err)
			}
			want := 2
			if late {
				want = 0
				if calls != 1 {
					t.Fatal("attempted a box after the budget expired", calls)
				}
			}
			if len(result.Blocks) != want || beginContext == nil || beginContext.Err() != nil {
				t.Fatal("late box leaked or Home cancelled the transaction", response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "private, no-store" || response.Header().Get("Vary") != "Cookie" {
				t.Fatal("Home cache policy changed", response.Header())
			}
			if err := lazy.Commit(); err != nil {
				t.Fatal("Home invalidated its caller's transaction", err)
			}
			cancel()
			if beginContext.Err() != context.Canceled {
				t.Fatal("transaction context detached from the original request")
			}
		})
	}
}

func TestFrontPageBoxesReadCap(t *testing.T) {
	blocks := make([]frontPageBlock, 21)
	for index := range blocks {
		blocks[index] = frontPageBlock{Dataset: "content", ResultLimit: 1, Enabled: true}
	}
	stubFrontPageRead(t, blocks)
	calls := 0
	frontPageResultsHandler = func(w http.ResponseWriter, _ *http.Request) {
		calls++
		fmt.Fprint(w, `{"columns":["id"],"types":{},"data":[]}`)
	}
	response := httptest.NewRecorder()
	GetFrontPageHandler(response, frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page"))
	var result struct {
		Blocks  []frontPageResultBlock `json:"blocks"`
		Partial bool                   `json:"partial"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || calls != 20 || len(result.Blocks) != 20 || result.Partial {
		t.Fatal("Home box cap changed", calls, response.Body.String(), err)
	}
}
