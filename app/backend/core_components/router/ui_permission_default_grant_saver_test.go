// ui_permission_default_grant_saver_test.go
// Verifies first-creation-only article defaults through a database-driver insert fixture.
// Connects startup's transaction and real grant branches with existing/revoked permissions.
// Prevents a repeat reconciliation from granting defaults after an administrator changes them.
package router

import (
	"errors"
	"strings"
	"testing"
)

func TestArticleUIPermissionDefaultsAndRevocationSurviveReconciliation(t *testing.T) {
	state := &uiPermissionRouteTestState{createdRoutes: map[string]int64{}, defaultGrants: map[int64]string{}}
	db, _ := newUIPermissionRouteTestDB(t, state)
	if err := ReactivateUIRoutes(db); err != nil {
		t.Fatal(err)
	}
	if len(state.createdRoutes) != 8 || len(state.defaultGrants) != 8 {
		t.Fatalf("created/default routes = %v/%v", state.createdRoutes, state.defaultGrants)
	}
	for _, route := range canonicalUIPermissionRoutes {
		if !strings.HasPrefix(route.Name, "ui.article.") {
			if route.DefaultGrantGroups != "" {
				t.Fatalf("other view defaults changed: %s", route.Name)
			}
			continue
		}
		want := "admins"
		if route.Name == "ui.article.section.details" {
			want = "readers"
		}
		if route.DefaultGrantGroups != want || route.SpecificTableRelated {
			t.Fatalf("article default/scope: %#v", route)
		}
		if state.defaultGrants[state.createdRoutes[route.Name]] != want {
			t.Fatalf("missing default: %s", route.Name)
		}
	}
	// Model a revoked Details default and an explicit grant on another route.
	detailsID := state.createdRoutes["ui.article.section.details"]
	imagesID := state.createdRoutes["ui.article.section.images"]
	delete(state.defaultGrants, detailsID)
	state.defaultGrants[imagesID] = "custom administrator choice"
	before := len(state.execCalls)
	if err := ReactivateUIRoutes(db); err != nil {
		t.Fatal(err)
	}
	if _, granted := state.defaultGrants[detailsID]; granted {
		t.Fatal("revoked default was recreated")
	}
	if state.defaultGrants[imagesID] != "custom administrator choice" {
		t.Fatal("custom grant overwritten")
	}
	for _, call := range state.execCalls[before:] {
		if call.query == grantNewUIPermissionDefaultsSQL {
			t.Fatal("repeat startup attempted to grant defaults")
		}
	}
}

func TestUIFirstCreationGrantSQLKeepsSiteGroupIdentityAndGlobalScope(t *testing.T) {
	for _, sql := range []string{"ON CONFLICT (name) DO NOTHING", "RETURNING id"} {
		if !strings.Contains(insertMissingUIPermissionRouteSQL, sql) {
			t.Fatalf("creation boundary missing %s", sql)
		}
	}
	for _, sql := range []string{"groups.name = 'admins'", "groups.name IN ('users', 'guests')", "$2 = 'readers'", "NULL", "'public'"} {
		if !strings.Contains(grantNewUIPermissionDefaultsSQL, sql) {
			t.Fatalf("default policy missing %s", sql)
		}
	}
}

func TestUIFirstCreationFailureRollsBackReconciliation(t *testing.T) {
	// Each preceding route executes reconciliation and, when configured, a
	// first-creation grant. Locate Details rather than assuming registry order.
	detailsGrantExec := 0
	precedingDefaultGrants := 0
	for index, route := range canonicalUIPermissionRoutes {
		if route.Name == "ui.article.section.details" {
			detailsGrantExec = index + precedingDefaultGrants + 1
			break
		}
		if route.DefaultGrantGroups != "" {
			precedingDefaultGrants++
		}
	}
	if detailsGrantExec == 0 {
		t.Fatal("Details route missing from registry")
	}

	for _, testCase := range []struct {
		name        string
		state       *uiPermissionRouteTestState
		wantContext string
	}{
		{"insert", &uiPermissionRouteTestState{queryErr: errors.New("insert unavailable")}, "insert missing UI permission"},
		{"grant", &uiPermissionRouteTestState{createdRoutes: map[string]int64{}, failExecAt: detailsGrantExec}, "grant first-creation UI defaults"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			db, state := newUIPermissionRouteTestDB(t, testCase.state)
			err := ReactivateUIRoutes(db)
			if err == nil || !strings.Contains(err.Error(), "/ui/article/section/details") || !strings.Contains(err.Error(), testCase.wantContext) {
				t.Fatalf("missing failure context: %v", err)
			}
			if state.commitCount != 0 || state.rollbackCount != 1 {
				t.Fatalf("failed defaults were not rolled back: %#v", state)
			}
		})
	}
}
