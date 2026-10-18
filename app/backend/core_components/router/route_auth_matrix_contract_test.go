// route_auth_matrix_contract_test.go
// Loads security-owned expectations and checks both directions of registry drift.
// Connects the real registration scenarios to layer A without running handlers.
// Keeps the oracle independent of the pipeline and makes layer B visible.
package router

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"easelect/backend/pipeline"
)

var matrixPersonas = []string{"anon", "guest", "user", "admin"}

type matrixExpectation struct {
	Path    string                     `json:"path"`
	Handler string                     `json:"handler"`
	Methods []string                   `json:"methods"`
	Match   RouteMatchType             `json:"match"`
	Profile string                     `json:"profile_production"`
	Scoped  bool                       `json:"dataset_scoped_default"`
	Class   string                     `json:"class"`
	Reason  string                     `json:"reason_code"`
	Expect  map[string]json.RawMessage `json:"expect"`
}

func matrixKey(path, handler string) string { return path + "\n" + handler }
func (e matrixExpectation) key() string     { return matrixKey(e.Path, e.Handler) }
func (e matrixExpectation) grants() []string {
	if e.Scoped {
		return []string{"nogrant", "granted", "other_dataset"}
	}
	return []string{"nogrant", "granted"}
}

func matrixValue(raw json.RawMessage, grant string) string {
	var value string
	if json.Unmarshal(raw, &value) == nil {
		return value
	}
	var values map[string]string
	if json.Unmarshal(raw, &values) != nil {
		return ""
	}
	if value = values[grant]; value != "" {
		return value
	}
	// Scoped admin rows declare a grant-independent DENY for non-admins.
	if grant == "other_dataset" && values["granted"] == values["nogrant"] {
		return values["nogrant"]
	}
	return ""
}

func (e matrixExpectation) expected(persona, grant string) string {
	if grant == "other_dataset" {
		var other map[string]string
		if json.Unmarshal(e.Expect["other_dataset"], &other) == nil && other[persona] != "" {
			return other[persona]
		}
	}
	return matrixValue(e.Expect[persona], grant)
}

func matrixPending(e matrixExpectation, expected string) bool {
	return e.Reason == "storage_row_rights" || slices.Contains([]string{
		"HANDLER_REFUSES_GUEST", "SECRET", "SYSTEM_TOKEN", "SYSTEM_NETWORK", "FIRST_RUN",
	}, expected)
}

// Check the README's complete top-level field contract before decoding values.
// Keep unused metadata and the manifest's identity/match fields; v3 has no xfails.
func decodeMatrixExpectation(data []byte) (matrixExpectation, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return matrixExpectation{}, err
	}
	for name := range fields {
		if strings.HasPrefix(strings.ToLower(name), "xfail") {
			return matrixExpectation{}, fmt.Errorf("oracle route %s (%s) contains unsupported xfail field %q", fields["path"], fields["handler"], name)
		}
		// app/testing/fixtures/route_auth_matrix/README.md owns this list.
		// Only the top level is checked here; expect keeps its persona/grant maps.
		switch name {
		case "path", "handler", "match", "methods", "profile_production",
			"dataset_scoped_default", "conditional_source", "expect", "class", "reason_code",
			"csrf_required_for_unsafe_methods", "wl164_guest_direct", "wl164_guest_via_grant", "conditional_profile":
		default:
			return matrixExpectation{}, fmt.Errorf("unknown oracle field %q for route %s (%s)", name, fields["path"], fields["handler"])
		}
	}
	var row matrixExpectation
	err := json.Unmarshal(data, &row)
	return row, err
}

func loadMatrixExpectations(t *testing.T) []matrixExpectation {
	t.Helper()
	file, err := os.Open(filepath.Join("..", "..", "..", "testing", "fixtures", "route_auth_matrix", "route_auth_matrix_expectations.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	var rows []matrixExpectation
	seen := map[string]bool{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		row, err := decodeMatrixExpectation(scanner.Bytes())
		if err != nil {
			t.Fatalf("expectation line %d: %v", len(rows)+1, err)
		}
		if row.Path == "" || row.Handler == "" || len(row.Methods) == 0 || seen[row.key()] {
			t.Fatalf("invalid or duplicate expectation line %d", len(rows)+1)
		}
		seen[row.key()] = true
		for _, persona := range matrixPersonas {
			for _, grant := range row.grants() {
				outcome := row.expected(persona, grant)
				if !slices.Contains([]string{"PASS", "SIGNIN", "DENY", "ABSENT", "HANDLER_REFUSES_GUEST", "SECRET", "SYSTEM_TOKEN", "SYSTEM_NETWORK", "FIRST_RUN"}, outcome) {
					t.Fatalf("%s %s/%s: missing or unknown expectation %q", row.Path, persona, grant, outcome)
				}
			}
		}
		rows = append(rows, row)
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		t.Fatal("empty route authorization oracle")
	}
	return rows
}

// Compare all scenarios, not just production: ABSENT rows must still identify a
// real conditional route. Comparing production alone would hide deleted routes.
func matrixSync(rows []matrixExpectation, manifest RouteManifest) error {
	want := map[string]matrixExpectation{}
	for _, row := range rows {
		want[row.key()] = row
	}
	for _, route := range manifest.Routes {
		key := matrixKey(route.PathPattern, route.HandlerName)
		row, ok := want[key]
		if !ok {
			return fmt.Errorf("registered route has no expectation: %s (%s)", route.PathPattern, route.HandlerName)
		}
		delete(want, key)
		methods, expectedMethods := slices.Clone(route.Methods), slices.Clone(row.Methods)
		slices.Sort(methods)
		slices.Sort(expectedMethods)
		if !slices.Equal(methods, expectedMethods) || route.MatchType != row.Match {
			return fmt.Errorf("route contract drift: %s (%s)", row.Path, row.Handler)
		}
		// The oracle represents an absent production profile as JSON null.
		production := ""
		for _, scenario := range route.Scenarios {
			if scenario.Name == "production" {
				production = scenario.ProfileName
			}
		}
		if production != row.Profile {
			return fmt.Errorf("production profile drift: %s: %s, expected %s", row.Path, production, row.Profile)
		}
	}
	if len(want) != 0 {
		var keys []string
		for key := range want {
			keys = append(keys, strings.ReplaceAll(key, "\n", " (")+")")
		}
		slices.Sort(keys)
		return fmt.Errorf("expectation route is gone: %s", strings.Join(keys, ", "))
	}
	return nil
}

func matrixRegistration(t *testing.T) ([]matrixExpectation, []RouteDefinition) {
	t.Helper()
	// Match the manifest's unconfigured production scenario, including optional
	// runner routes being absent. No development profile overrides can leak in.
	t.Setenv("ENVIRONMENT_TYPE", "production")
	t.Setenv("ENABLE_API_LANGUAGE", "")
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "")
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "")
	t.Setenv("EASELECT_SYSTEM_ENDPOINTS_ALLOW_PUBLIC", "")
	oldProfiles := pipeline.RouteProfiles
	oldDefinitions := GetRouteDefinitions()
	oldFrontend, oldStorage, oldApps := localFrontendDir, localStorageDir, localAppsDir
	t.Cleanup(func() {
		pipeline.RouteProfiles = oldProfiles
		routeDefinitions = oldDefinitions
		localFrontendDir, localStorageDir, localAppsDir = oldFrontend, oldStorage, oldApps
	})
	rows := loadMatrixExpectations(t)
	manifest, err := BuildDefaultRouteManifest()
	if err != nil {
		t.Fatal(err)
	}
	if err := matrixSync(rows, manifest); err != nil {
		t.Fatal(err)
	}
	pipeline.ResetRouteProfiles()
	RegisterRoutes("frontend", "storage")
	pipeline.ApplyDevOverrides()
	return rows, GetRouteDefinitions()
}

func TestRouteAuthorizationMatrixContract(t *testing.T) {
	rows, routes := matrixRegistration(t)
	report := newMatrixReport(t, "route_auth_matrix_plan.tsv")
	cells, requests, pending, pendingRoutes := 0, 0, 0, map[string]bool{}
	for _, row := range rows {
		for _, persona := range matrixPersonas {
			for _, grant := range row.grants() {
				cells++
				expected := row.expected(persona, grant)
				for _, method := range row.Methods {
					requests++
					status := "NOT-RUN"
					if matrixPending(row, expected) {
						status = "layer-B-pending"
						pending++
						pendingRoutes[row.key()] = true
					}
					report.write(t, row, persona, grant, method, expected, "not executed", status, row.Class, row.Reason)
				}
			}
		}
	}
	t.Logf("%d inventory routes; %d production routes; %d persona×grant cells; %d method cells; %d layer-B-pending method cells across %d routes", len(rows), len(routes), cells, requests, pending, len(pendingRoutes))
}

func TestRouteAuthorizationMatrixSyncRejectsMissingAndStale(t *testing.T) {
	rows, _ := matrixRegistration(t)
	manifest, err := BuildDefaultRouteManifest()
	if err != nil {
		t.Fatal(err)
	}
	if err := matrixSync(rows[1:], manifest); err == nil || !strings.Contains(err.Error(), "no expectation") {
		t.Fatalf("unreviewed route accepted: %v", err)
	}
	stale := append(slices.Clone(rows), matrixExpectation{Path: "/gone", Handler: "gone.Handler"})
	if err := matrixSync(stale, manifest); err == nil || !strings.Contains(err.Error(), "route is gone") {
		t.Fatalf("deleted route accepted: %v", err)
	}
}

func TestRouteAuthorizationMatrixRejectsXfailFields(t *testing.T) {
	for _, data := range []string{
		`{"xfail":false}`, `{"xfail_desired":{}}`, `{"xfail_reason":""}`, `{"xfail_future":null}`,
	} {
		if _, err := decodeMatrixExpectation([]byte(data)); err == nil {
			t.Fatalf("legacy expected-failure field accepted: %s", data)
		}
	}
}

func matrixRootOracleFields(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "testing", "fixtures", "route_auth_matrix", "route_auth_matrix_expectations.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	for line := range strings.Lines(string(data)) {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal([]byte(line), &fields); err != nil {
			t.Fatal(err)
		}
		if string(fields["path"]) == `"/"` && string(fields["handler"]) == `"router.rootHandler"` {
			return fields
		}
	}
	t.Fatal("root-route oracle row is missing")
	return nil
}

func TestRouteAuthorizationMatrixRejectsUnknownFields(t *testing.T) {
	for _, field := range []string{"unexpected_field", "Path", "xfail", "XFAIL_future"} {
		t.Run(field, func(t *testing.T) {
			fields := matrixRootOracleFields(t)
			fields[field] = json.RawMessage(`true`)
			data, err := json.Marshal(fields)
			if err != nil {
				t.Fatal(err)
			}
			_, err = decodeMatrixExpectation(data)
			if err == nil {
				t.Fatalf("root-route oracle accepted unsupported field %q", field)
			}
			for _, detail := range []string{field, `"/"`, "router.rootHandler"} {
				if !strings.Contains(err.Error(), detail) {
					t.Fatalf("loader error %q does not identify %q", err, detail)
				}
			}
		})
	}
}

func TestRouteAuthorizationMatrixAcceptsDocumentedFields(t *testing.T) {
	rows := loadMatrixExpectations(t)
	t.Logf("loaded %d unchanged oracle rows", len(rows))
	fields := matrixRootOracleFields(t)
	// The root row already covers identity, match, reason and persona expectations.
	// Supply every remaining README field, including metadata unused by layer A.
	fields["conditional_source"] = json.RawMessage(`"setting"`)
	fields["conditional_profile"] = json.RawMessage(`"default"`)
	fields["csrf_required_for_unsafe_methods"] = json.RawMessage(`true`)
	data, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeMatrixExpectation(data); err != nil {
		t.Fatalf("documented oracle fields rejected: %v", err)
	}
}
