// row_group_dedicated_api_test.go
// Proves generic mutations cannot bypass administrator classification APIs.
// Exercises the unconditional guard with signed guest, basic and administrator sessions.
// No database or session lookup is allowed before this refusal.
package dtt_1_row_delete

import (
	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRowGroupTablesRefuseGenericMutationForEveryActor(t *testing.T) {
	for _, table := range []string{"system_row_groups", "system_row_group_memberships", "system_row_group_classifications"} {
		for _, role := range []string{"guest", "basic", "admin"} {
			t.Run(table+"/"+role, func(t *testing.T) {
				previousStore, previousName := e_sessions.Store, e_sessions.SessionName
				store := sessions.NewCookieStore([]byte("wl103-dedicated-table-test-signing-key"))
				e_sessions.Store, e_sessions.SessionName = store, "wl103_session"
				t.Cleanup(func() { e_sessions.Store, e_sessions.SessionName = previousStore, previousName })
				request := httptest.NewRequest(http.MethodPost, "/api/test", nil)
				cookieResponse := httptest.NewRecorder()
				session, err := store.Get(request, e_sessions.SessionName)
				if err != nil {
					t.Fatal(err)
				}
				session.Values["user_id"], session.Values["user_role"] = 2, role
				if err := session.Save(request, cookieResponse); err != nil {
					t.Fatal(err)
				}
				for _, cookie := range cookieResponse.Result().Cookies() {
					request.AddCookie(cookie)
				}
				request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(2, role)))
				response := httptest.NewRecorder()
				DeleteRowsHandler(response, request, table)
				if response.Code != http.StatusForbidden {
					t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
				}
			})
		}
	}
}
