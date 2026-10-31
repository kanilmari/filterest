// front_page_boxes_execution_budget_test.go
// Proves Home passes only its remaining budget to the database-operation boundary.
// Connects the facade to a saturated real database/sql pool without PostgreSQL.
// Keeps the original request lifetime while omitting an operation that cannot start.
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
)

func TestFrontPageBoxesDatabaseWorkUsesRemainingBudget(t *testing.T) {
	stubFrontPageRead(t, []frontPageBlock{{Dataset: "blocked", ResultLimit: 1, Enabled: true}})
	name := fmt.Sprintf("front_page_remaining_budget_%d", frontPageScopeDriverID.Add(1))
	sql.Register(name, frontPageScopeDriver{&frontPageScopeFixture{}})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	held, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	// Bounds a pre-fix failure as well; the fixed operation has only 20 ms left.
	release := time.AfterFunc(300*time.Millisecond, func() { held.Close() })
	defer release.Stop()
	now := time.Now()
	frontPageNow = func() time.Time { return now }
	frontPageCanRead = func(int, string) bool { now = now.Add(2980 * time.Millisecond); return true }
	request := frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page")
	frontPageResultsHandler = func(w http.ResponseWriter, delegated *http.Request) {
		if delegated.Context().Done() != request.Context().Done() {
			t.Fatal("operation budget replaced request cancellation")
		}
		q, finish, err := dbutils.BeginReadBudget(delegated.Context(), db)
		if err != nil {
			t.Fatal(err)
		}
		defer finish()
		rows, err := q.Query("blocked pool")
		if err == nil {
			rows.Close()
			t.Fatal("blocked operation unexpectedly completed")
		}
		w.WriteHeader(http.StatusInternalServerError)
	}
	start := time.Now()
	response := httptest.NewRecorder()
	GetFrontPageHandler(response, request)
	var result struct {
		Blocks  []frontPageResultBlock `json:"blocks"`
		Partial bool                   `json:"partial"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || len(result.Blocks) != 0 || !result.Partial {
		t.Fatal("blocked box was not omitted as partial", response.Code, response.Body.String(), err)
	}
	if elapsed := time.Since(start); elapsed > 200*time.Millisecond {
		t.Fatal("database operation exceeded the remaining Home budget", elapsed)
	}
}
