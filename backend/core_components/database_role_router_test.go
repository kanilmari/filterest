package backend

import (
	"database/sql"
	"net/http/httptest"
	"testing"
)

func TestGetRequestDBForRolePrefersRoleSpecificPools(t *testing.T) {
	savedAdmin, savedBasic, savedGuest, savedDb := DbAdmin, DbBasic, DbGuest, Db
	t.Cleanup(func() {
		DbAdmin, DbBasic, DbGuest, Db = savedAdmin, savedBasic, savedGuest, savedDb
	})

	adminDB := &sql.DB{}
	basicDB := &sql.DB{}
	guestDB := &sql.DB{}
	fallbackDB := &sql.DB{}

	DbAdmin = adminDB
	DbBasic = basicDB
	DbGuest = guestDB
	Db = fallbackDB

	if got := GetRequestDBForRole("admin"); got != adminDB {
		t.Fatalf("GetRequestDBForRole(admin) = %p, want admin pool %p", got, adminDB)
	}
	if got := GetRequestDBForRole("basic"); got != basicDB {
		t.Fatalf("GetRequestDBForRole(basic) = %p, want basic pool %p", got, basicDB)
	}
	if got := GetRequestDBForRole("guest"); got != guestDB {
		t.Fatalf("GetRequestDBForRole(guest) = %p, want guest pool %p", got, guestDB)
	}
	if got := GetRequestDBForRole("unknown"); got != guestDB {
		t.Fatalf("GetRequestDBForRole(unknown) = %p, want guest pool %p", got, guestDB)
	}
}

func TestGetRequestDBForRoleFallsBackToDbWhenRolePoolMissing(t *testing.T) {
	savedAdmin, savedBasic, savedGuest, savedDb := DbAdmin, DbBasic, DbGuest, Db
	t.Cleanup(func() {
		DbAdmin, DbBasic, DbGuest, Db = savedAdmin, savedBasic, savedGuest, savedDb
	})

	fallbackDB := &sql.DB{}
	DbAdmin = nil
	DbBasic = nil
	DbGuest = nil
	Db = fallbackDB

	for _, role := range []string{"admin", "basic", "guest", "unknown"} {
		if got := GetRequestDBForRole(role); got != fallbackDB {
			t.Fatalf("GetRequestDBForRole(%q) = %p, want fallback Db %p", role, got, fallbackDB)
		}
	}
}

func TestGetRequestDBForRequestUsesBasicPoolForPilotAdminDataset(t *testing.T) {
	savedAdmin, savedBasic, savedGuest, savedDb := DbAdmin, DbBasic, DbGuest, Db
	t.Cleanup(func() {
		DbAdmin, DbBasic, DbGuest, Db = savedAdmin, savedBasic, savedGuest, savedDb
	})

	adminDB := &sql.DB{}
	basicDB := &sql.DB{}
	guestDB := &sql.DB{}
	fallbackDB := &sql.DB{}

	DbAdmin = adminDB
	DbBasic = basicDB
	DbGuest = guestDB
	Db = fallbackDB

	pilotReq := httptest.NewRequest("GET", "/api/get-results?dataset=app_service_catalog", nil)
	if got := GetRequestDBForRequest("admin", pilotReq); got != basicDB {
		t.Fatalf("GetRequestDBForRequest(admin, pilot) = %p, want basic pool %p", got, basicDB)
	}

	otherReq := httptest.NewRequest("GET", "/api/get-results?dataset=some_other_table", nil)
	if got := GetRequestDBForRequest("admin", otherReq); got != adminDB {
		t.Fatalf("GetRequestDBForRequest(admin, non-pilot) = %p, want admin pool %p", got, adminDB)
	}

	if got := GetRequestDBForRequest("basic", pilotReq); got != basicDB {
		t.Fatalf("GetRequestDBForRequest(basic, pilot) = %p, want basic pool %p", got, basicDB)
	}
}

func TestGetRequestDBForRequestFallsBackWhenPilotBasicPoolMissing(t *testing.T) {
	savedAdmin, savedBasic, savedGuest, savedDb := DbAdmin, DbBasic, DbGuest, Db
	t.Cleanup(func() {
		DbAdmin, DbBasic, DbGuest, Db = savedAdmin, savedBasic, savedGuest, savedDb
	})

	adminDB := &sql.DB{}
	DbAdmin = adminDB
	DbBasic = nil
	DbGuest = nil
	Db = &sql.DB{}

	pilotReq := httptest.NewRequest("GET", "/api/get-results?dataset=app_service_catalog", nil)
	if got := GetRequestDBForRequest("admin", pilotReq); got != adminDB {
		t.Fatalf("GetRequestDBForRequest(admin, pilot) = %p, want admin fallback pool %p", got, adminDB)
	}
}
