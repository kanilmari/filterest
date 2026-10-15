// error_disclosure_test.go
// Preserves deliberate validation feedback while hiding internal error diagnostics.
// Bridges real HTTP handlers, a failing SQL driver, server logs and a source scan.
// Exists to prevent internal database diagnostics from reaching API clients.
package agent_tools

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"easelect/backend/core_components/httpresponse"
	"easelect/backend/pipeline"
)

func TestAgentToolValidationMessagesReachClients(t *testing.T) {
	store := setupAgentToolAuthGuardTestStore(t)
	setupAgentToolSecurityStages(t)
	routes := map[string]agentToolRouteFixture{}
	for _, route := range agentToolRegisteredRoutes() {
		routes[strings.TrimPrefix(route.path, "/api/app/agent-tools/")] = route
	}
	for _, test := range []struct {
		name, route, method, query, payload, message string
	}{
		{"task-filter-status", "tasks", "GET", "status=invalid", "", "invalid status"},
		{"task-status", "tasks", "PATCH", "", `{"id":4,"status":"invalid"}`, "invalid status"},
		{"task-title", "tasks", "PATCH", "", `{"id":4,"title":" "}`, "title cannot be empty"},
		{"task-empty-patch", "tasks", "PATCH", "", `{"id":4}`, "no fields to update"},
		{"task-unknown-group", "tasks", "PATCH", "", `{"id":4,"group_slugs":["missing"]}`, `unknown group "missing"`},
		{"task-unknown-queue", "tasks", "POST", "", `{"title":"Task","queue_slug":"missing"}`, `unknown queue "missing"`},
		{"task-unknown-queue-id", "tasks", "POST", "", `{"title":"Task","queue_id":999}`, "unknown queue_id 999"},
		{"todo-status", "task-todos", "PATCH", "", `{"id":4,"status":"invalid"}`, "invalid status"},
		{"todo-text", "task-todos", "PATCH", "", `{"id":4,"todo_text":" "}`, "todo_text must be 1-5000 characters"},
		{"workline-limit", "worklines", "GET", "limit=101", "", "limit must be between 1 and 100"},
		{"workline-title", "worklines", "POST", "", `{"title":"` + strings.Repeat("x", maxWorklineTitleRunes+1) + `"}`, "title must be 1-300 characters"},
		{"workline-tags", "worklines", "POST", "", `{"title":"Valid title","tags":[""]}`, "each tag must be 1-64 characters"},
		{"workline-status", "worklines", "PATCH", "", `{"id":4,"status":"invalid"}`, "invalid status"},
		{"report-phase", "workline-reports", "POST", "", `{"workline_id":4,"title":"Report","context":"Context","plain_language":"Delivered","technical":"Implementation","phase_gate":"3-4"}`, "current_phase is required"},
		{"handover-items", "handover-reports", "POST", "", `{"title":"Handover"}`, "items must contain 1-50 workline reports"},
		{"handover-comment", "handover-reports", "PATCH", "", `{"id":4,"comment":" "}`, "comment must be 1-5000 characters"},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := &agentToolSQLFixture{admin: true, grant: true, loginToBrowse: true}
			installAgentToolSQLFixture(t, fixture)
			route := routes[test.route]
			request := agentToolMethodRequest(t, store, route, test.method, 43)
			request.URL.RawQuery = test.query
			request.Body = io.NopCloser(strings.NewReader(test.payload))
			response := httptest.NewRecorder()
			ctx := pipeline.RouteContext{URLPattern: route.path, HandlerName: route.name}
			pipeline.BuildHandler(route.handler, ctx, pipeline.GetProfile(route.name))(response, request)
			var body httpresponse.ErrorBody
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("expected JSON validation error: %s", response.Body.String())
			}
			if response.Code != http.StatusBadRequest || body.Error != test.message || body.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%+v, want validation message %q", response.Code, body, test.message)
			}
		})
	}
}

func TestAgentToolRequestErrorExposesOnlyDirectValidation(t *testing.T) {
	for _, test := range []struct {
		name    string
		err     error
		status  int
		message string
	}{
		{"validation", validationErrorf("invalid %s", "status"), 400, "invalid status"},
		{"conflict", validationErrorf("checkpoint_workline_status_is_stale"), 409, "checkpoint_workline_status_is_stale"},
		{"untyped-lookalike", errors.New("invalid status"), 400, "invalid_request"},
		{"database", errors.New(agentToolForcedDBError), 400, "invalid_request"},
		{"wrapped-database", fmt.Errorf("lookup failed: %w", errors.New(agentToolForcedDBError)), 400, "invalid_request"},
		{"wrapped-validation", fmt.Errorf("internal checkpoint: %w", validationErrorf("invalid status")), 409, "invalid_request"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var serverLog bytes.Buffer
			previousLog := log.Writer()
			log.SetOutput(&serverLog)
			t.Cleanup(func() { log.SetOutput(previousLog) })
			response := httptest.NewRecorder()
			respondAgentToolRequestError(response, test.status, "validation test", test.err)
			var body httpresponse.ErrorBody
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != test.status || body.Code != test.status || body.Error != test.message {
				t.Fatalf("status=%d body=%+v, want %d/%q", response.Code, body, test.status, test.message)
			}
			if test.message == "invalid_request" && !strings.Contains(serverLog.String(), test.err.Error()) {
				t.Fatal("unknown or wrapped error was not logged on the server")
			}
			if test.message != "invalid_request" && serverLog.Len() != 0 {
				t.Fatal("ordinary validation feedback should not be logged as an internal failure")
			}
		})
	}
}

func TestAgentToolLookupFailuresStayGeneric(t *testing.T) {
	store := setupAgentToolAuthGuardTestStore(t)
	setupAgentToolSecurityStages(t)
	for _, route := range agentToolRegisteredRoutes() {
		if !strings.HasSuffix(route.path, "/tasks") {
			continue
		}
		for _, payload := range []string{
			`{"title":"Task","queue_slug":"missing"}`,
			`{"title":"Task","queue_id":999}`,
			`{"title":"Task","group_slugs":["missing"]}`,
		} {
			t.Run(payload, func(t *testing.T) {
				fixture := &agentToolSQLFixture{admin: true, grant: true, loginToBrowse: true, rowFault: "iteration"}
				installAgentToolSQLFixture(t, fixture)
				var serverLog bytes.Buffer
				previousLog := log.Writer()
				log.SetOutput(&serverLog)
				t.Cleanup(func() { log.SetOutput(previousLog) })
				request := agentToolMethodRequest(t, store, route, http.MethodPost, 43)
				request.Body = io.NopCloser(strings.NewReader(payload))
				response := httptest.NewRecorder()
				ctx := pipeline.RouteContext{URLPattern: route.path, HandlerName: route.name}
				pipeline.BuildHandler(route.handler, ctx, pipeline.GetProfile(route.name))(response, request)
				var body httpresponse.ErrorBody
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != 400 || body.Error != "invalid_request" || body.Code != 400 {
					t.Fatalf("lookup failure must stay generic: status=%d body=%s", response.Code, response.Body.String())
				}
				if fixture.businessCalls == 0 || !strings.Contains(serverLog.String(), agentToolForcedDBError) {
					t.Fatal("lookup database failure was not executed and logged")
				}
			})
		}
	}
}

func TestAgentToolDatabaseErrorsStayOnServer(t *testing.T) {
	store := setupAgentToolAuthGuardTestStore(t)
	setupAgentToolSecurityStages(t)
	for _, route := range agentToolRegisteredRoutes() {
		for _, method := range route.methods {
			t.Run(route.name+"/"+method, func(t *testing.T) {
				fixture := &agentToolSQLFixture{admin: true, grant: true, loginToBrowse: true, fail: true}
				installAgentToolSQLFixture(t, fixture)
				var serverLog bytes.Buffer
				previousLog := log.Writer()
				log.SetOutput(&serverLog)
				t.Cleanup(func() { log.SetOutput(previousLog) })
				response := httptest.NewRecorder()
				request := agentToolMethodRequest(t, store, route, method, 43)
				ctx := pipeline.RouteContext{URLPattern: route.path, HandlerName: route.name}
				pipeline.BuildHandler(route.handler, ctx, pipeline.GetProfile(route.name))(response, request)
				var body httpresponse.ErrorBody
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
					t.Fatalf("expected generic JSON error: %s", response.Body.String())
				}
				if response.Code != http.StatusInternalServerError || body.Error != "database_error" || body.Code != http.StatusInternalServerError {
					t.Fatalf("status=%d body=%+v, want generic database_error", response.Code, body)
				}
				if strings.Contains(response.Body.String(), "sec1_fixture") || strings.Contains(response.Body.String(), agentToolForcedDBError) {
					t.Fatalf("internal database diagnostics escaped: %s", response.Body.String())
				}
				if fixture.businessCalls == 0 || !strings.Contains(serverLog.String(), agentToolForcedDBError) {
					t.Fatal("forced database error was not executed and logged on the server")
				}
			})
		}
	}
}

func TestAgentToolsNeverSerializeErrorText(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	files := token.NewFileSet()
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		source, err := parser.ParseFile(files, name, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		// The stronger package-wide rule also catches concatenation and aliases
		// before the HTTP call: errors are passed to the generic logging helpers.
		ast.Inspect(source, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if ok && selector.Sel.Name == "Error" && len(call.Args) == 0 {
				t.Errorf("%s: error text conversion can escape through a response; use the generic responder", files.Position(call.Pos()))
			}
			return true
		})
	}
}

func TestAgentToolReadFailuresAreGeneric(t *testing.T) {
	store := setupAgentToolAuthGuardTestStore(t)
	setupAgentToolSecurityStages(t)
	for _, route := range agentToolRegisteredRoutes() {
		modes := []string{"scan", "iteration"}
		if strings.HasSuffix(route.path, "/tasks") || strings.HasSuffix(route.path, "/task-runs") {
			modes = append(modes, "single-record")
		}
		for _, mode := range modes {
			t.Run(route.name+"/"+mode, func(t *testing.T) {
				fixture := &agentToolSQLFixture{admin: true, grant: true, loginToBrowse: true, rowFault: mode, fail: mode == "single-record"}
				installAgentToolSQLFixture(t, fixture)
				request := agentToolMethodRequest(t, store, route, http.MethodGet, 43)
				if mode == "single-record" {
					request.URL.RawQuery = "id=4&run_id=sec1-run"
				}
				response := httptest.NewRecorder()
				ctx := pipeline.RouteContext{URLPattern: route.path, HandlerName: route.name}
				pipeline.BuildHandler(route.handler, ctx, pipeline.GetProfile(route.name))(response, request)
				var body httpresponse.ErrorBody
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != 500 || body.Error != "database_error" {
					t.Fatalf("read failure must be generic: status=%d body=%s", response.Code, response.Body.String())
				}
			})
		}
	}
}
