// route_auth_matrix_runner_test.go
// Exercises production middleware with named stubs from the live route table.
// Connects the security oracle, request cross-cuts and durable TSV triage output.
// No profile, stage or product handler is modified for this test.
package router

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"easelect/backend/pipeline"
)

type matrixReport struct {
	file   *os.File
	writer *csv.Writer
	counts map[string]int
}

func newMatrixReport(t *testing.T, name string) *matrixReport {
	t.Helper()
	dir := os.Getenv("FILTEREST_ROUTE_AUTH_MATRIX_OUTPUT_DIR")
	if dir == "" {
		dir = filepath.Join("..", "..", "..", "..", "data", "runtime", "test_outputs", "route_auth_matrix")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	report := &matrixReport{file: file, writer: csv.NewWriter(file), counts: map[string]int{}}
	report.writer.Comma = '\t'
	if err := report.writer.Write([]string{"persona", "grant", "route", "method", "expected", "got", "status", "class", "handler", "detail"}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		report.writer.Flush()
		if err := report.writer.Error(); err != nil {
			t.Error(err)
		}
		if err := file.Close(); err != nil {
			t.Error(err)
		}
		t.Logf("matrix TSV: %s; statuses: %v", file.Name(), report.counts)
	})
	return report
}

func (r *matrixReport) write(t *testing.T, row matrixExpectation, persona, grant, method, expected, got, status, class, detail string) {
	t.Helper()
	if err := r.writer.Write([]string{persona, grant, row.Path, method, expected, got, status, class, row.Handler, detail}); err != nil {
		t.Fatal(err)
	}
	r.counts[status]++
}

func matrixStubMux(routes []RouteDefinition, fixture *matrixFixture) *http.ServeMux {
	mux := http.NewServeMux()
	for _, route := range routes {
		stub := func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Matrix-Handler", route.HandlerName)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"handler": route.HandlerName})
		}
		// The same method wrapper as functionRegisterConditionalHandler, inside
		// the same pipeline wrapper as RegisterAllRoutesAndUpdateFunctions.
		methodHandler := enforceRouteMethods(stub, route.HandlerName, RouteMethodContract{Methods: route.Methods, Source: route.MethodSource})
		ctx := pipeline.RouteContext{URLPattern: route.UrlPattern, HandlerName: route.HandlerName, DB: fixture.db}
		mux.HandleFunc(route.UrlPattern, pipeline.BuildHandler(methodHandler, ctx, pipeline.GetProfile(route.HandlerName)))
	}
	return mux
}

func matrixRequestPath(row matrixExpectation, grant string) string {
	path := row.Path
	for strings.Contains(path, "{") {
		start := strings.Index(path, "{")
		end := strings.Index(path[start:], "}")
		if end < 0 {
			break
		}
		path = path[:start] + "1" + path[start+end+1:]
	}
	if row.Scoped {
		dataset := "matrix_dataset_a"
		if grant == "other_dataset" {
			dataset = "matrix_dataset_b"
		}
		path += "?dataset=" + dataset
	}
	return path
}

func matrixUnsafe(method string) bool {
	return slices.Contains([]string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete}, method)
}

func matrixResult(response *matrixResponse, handler string) string {
	if response.diagnostic != "" {
		return "ERROR: " + response.diagnostic
	}
	var body struct {
		AuthFailure bool   `json:"auth_failure"`
		Handler     string `json:"handler"`
		Error       string `json:"error"`
		Code        int    `json:"code"`
	}
	jsonErr := json.Unmarshal(response.Body.Bytes(), &body)
	if response.Code == http.StatusForbidden {
		if jsonErr != nil || body.Code != http.StatusForbidden {
			return "ERROR: malformed refusal response"
		}
		if body.AuthFailure && body.Error == "session_no_longer_valid" && response.decision == "SIGNIN" {
			return "SIGNIN"
		}
		if !body.AuthFailure {
			if body.Error == "missing CSRF token" {
				return "403 missing CSRF token"
			}
			if response.decision == "DENY" && slices.Contains([]string{
				"403 - Forbidden (function-level)", "403 - Forbidden (single table)",
				"403 - Forbidden (multiple datasets)", "403 - Forbidden (admin access not allowed)",
			}, body.Error) {
				return "DENY"
			}
		}
		return "ERROR: unrecognized authorization refusal"
	}
	if response.Code >= 200 && response.Code < 300 && response.Header().Get("X-Matrix-Handler") == handler && jsonErr == nil && body.Handler == handler {
		return "PASS"
	}
	if response.Code == 404 {
		return "ABSENT"
	}
	return fmt.Sprintf("HTTP_%d", response.Code)
}

func matrixVerdict(expected, got string) string {
	if expected == got {
		return "PASS"
	}
	return "FAIL"
}

func matrixAssert(t *testing.T, report *matrixReport, row matrixExpectation, persona, grant, method, expected, got, class string) {
	t.Helper()
	status := matrixVerdict(expected, got)
	report.write(t, row, persona, grant, method, expected, got, status, class, row.Reason)
	if status == "FAIL" {
		t.Errorf("%s %s/%s %s %s (%s): expected %s, got %s", status, persona, grant, method, row.Path, row.Handler, expected, got)
	}
}

func TestRouteAuthorizationMatrixPostgres(t *testing.T) {
	rows, routes := matrixRegistration(t)
	// The opt-in helper refuses before connecting or starting a cluster.
	fixture := newMatrixFixture(t, routes)
	mux := matrixStubMux(routes, fixture)
	report := newMatrixReport(t, "route_auth_matrix.tsv")
	registered := map[string]bool{}
	for _, route := range routes {
		registered[matrixKey(route.UrlPattern, route.HandlerName)] = true
	}
	for _, row := range rows {
		for _, grant := range row.grants() {
			fixture.setGrant(t, row, grant)
			for _, persona := range matrixPersonas {
				fixture.setPersona(t, persona)
				expected := row.expected(persona, grant)
				for _, method := range row.Methods {
					if matrixPending(row, expected) {
						report.write(t, row, persona, grant, method, expected, "not executed", "layer-B-pending", row.Class, row.Reason)
						continue
					}
					if expected == "ABSENT" {
						// Unknown paths fall through to the real public / prefix.
						// The security oracle requires registry absence, not 404.
						got := "ABSENT"
						if registered[row.key()] {
							got = "REGISTERED"
						}
						matrixAssert(t, report, row, persona, grant, method, expected, got, row.Class)
						continue
					}
					request := fixture.request(t, row, persona, grant, method, true)
					response := matrixServeHTTP(mux, request)
					got := matrixResult(response, row.Handler)
					matrixAssert(t, report, row, persona, grant, method, expected, got, row.Class)
				}
			}
		}
		if !registered[row.key()] {
			continue
		}
		fixture.setGrant(t, row, "granted")
		// Authentication and access control run before the method contract.
		// A fully authorized admin isolates the 405 contract on every route.
		fixture.setPersona(t, "admin")
		// OPTIONS, TRACE and CONNECT belong to the earlier firewall boundary.
		for _, method := range []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"} {
			if slices.Contains(row.Methods, method) {
				continue
			}
			response := matrixServeHTTP(mux, fixture.request(t, row, "admin", "granted", method, true))
			got := fmt.Sprint(response.Code)
			if response.diagnostic != "" {
				got = matrixResult(response, row.Handler)
			}
			if response.diagnostic == "" && response.Code == 405 && response.Header().Get("Allow") == "" {
				got = "405 without Allow"
			}
			matrixAssert(t, report, row, "admin", "granted", method, "405", got, "METHOD")
		}
		if row.Profile == "public" {
			continue
		}
		for _, method := range row.Methods {
			if !matrixUnsafe(method) {
				continue
			}
			for _, persona := range []string{"guest", "user", "admin"} {
				fixture.setPersona(t, persona)
				response := matrixServeHTTP(mux, fixture.request(t, row, persona, "granted", method, false))
				got := matrixResult(response, row.Handler)
				matrixAssert(t, report, row, persona, "granted", method, "403 missing CSRF token", got, "CSRF")
			}
		}
	}
}

func TestRouteAuthorizationMatrixVerdicts(t *testing.T) {
	for _, test := range []struct{ expected, got, status string }{
		{"PASS", "PASS", "PASS"}, {"PASS", "DENY", "FAIL"},
		{"DENY", "ERROR", "FAIL"}, {"SIGNIN", "ERROR", "FAIL"},
	} {
		if got := matrixVerdict(test.expected, test.got); got != test.status {
			t.Errorf("%+v: got %s", test, got)
		}
	}
}
