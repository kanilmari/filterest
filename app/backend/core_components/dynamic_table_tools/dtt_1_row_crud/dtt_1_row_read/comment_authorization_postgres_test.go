// comment_authorization_postgres_test.go
// Proves comment authorization against real grants, flags and exact-row rules.
// Reuses the opt-in disposable owner-resolver fixture, never an application DB.
// Gives the supervising runner a database proof for the offline handler regressions.
package dtt_1_row_read

import (
	backend "easelect/backend/core_components"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCommentsAuthorizationPostgres(t *testing.T) {
	owner, reader := ownerResolverPostgres(t)
	if _, err := owner.Exec(`
CREATE TABLE system_functions(id integer PRIMARY KEY,url_route_endpoint text,disabled boolean);
CREATE TABLE system_group_table_func_rights(user_group_id bigint,function_id integer,target_table_uid bigint);
CREATE TABLE system_comments(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,table_name text,row_id integer,comment_text text,created_by integer,created timestamptz DEFAULT now());
INSERT INTO system_functions VALUES(1,'/api/get-results',false);
INSERT INTO system_group_table_func_rights VALUES(2,1,10);
INSERT INTO system_user_group_memberships VALUES(4,2);
INSERT INTO system_comments(table_name,row_id,comment_text,created_by) VALUES('owned_notes',1,'visible',4),('owned_notes',3,'hidden',12),('plain_notes',1,'unreadable',12),('owned_notes',1,'guest',1),('owned_notes',1,'removed author',NULL);
INSERT INTO system_row_access_rules(table_uid,action_id,row_id,user_id,effect) VALUES(10,1,3,4,'allow');
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wl58_reader;`); err != nil {
		t.Fatal(err)
	}
	oldDB, oldBasic := backend.Db, backend.DbBasic
	backend.Db, backend.DbBasic = owner, reader
	t.Cleanup(func() { backend.Db, backend.DbBasic = oldDB, oldBasic })
	count := func() int {
		t.Helper()
		var n int
		if err := owner.QueryRow(`SELECT count(*) FROM system_comments`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	for _, operation := range []string{"list", "count", "create"} {
		for _, test := range []struct {
			name, dataset string
			row, status   int
		}{
			{"unreadable", "plain_notes", 1, 403},
			{"hidden despite direct allow", "owned_notes", 3, 404},
			{"nonexistent", "owned_notes", 999, 404},
			{"visible", "owned_notes", 1, 200},
			{"own hidden", "owned_notes", 2, 200},
		} {
			t.Run(operation+"/"+test.name, func(t *testing.T) {
				before := count()
				var handler http.HandlerFunc
				method, target, body := "POST", "", ""
				switch operation {
				case "list":
					handler = CommentListHandler
					method = "GET"
					target = fmt.Sprintf("/api/comments?dataset=%s&row_id=%d", test.dataset, test.row)
				case "count":
					handler = CommentCountHandler
					target = "/api/comment-counts"
					body = fmt.Sprintf(`{"dataset":%q,"row_ids":[%d]}`, test.dataset, test.row)
				case "create":
					handler = CommentCreateHandler
					target = "/api/comments/create"
					body = fmt.Sprintf(`{"dataset":%q,"row_id":%d,"comment_text":"new"}`, test.dataset, test.row)
				}
				rec := httptest.NewRecorder()
				handler(rec, commentTestRequest(t, method, target, body, 4, "basic"))
				if rec.Code != test.status {
					t.Fatalf("status=%d want=%d: %s", rec.Code, test.status, rec.Body.String())
				}
				if test.status != 200 && count() != before {
					t.Fatal("denial changed comments")
				}
			})
		}
	}
	// A direct deny must also hide a normally published parent.
	if _, err := owner.Exec(`INSERT INTO system_row_access_rules(table_uid,action_id,row_id,user_id,effect) VALUES(10,1,1,4,'deny')`); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	CommentListHandler(rec, commentTestRequest(t, "GET", "/api/comments?dataset=owned_notes&row_id=1", "", 4, "basic"))
	if rec.Code != 404 {
		t.Fatalf("exact-row deny escaped: %d %s", rec.Code, rec.Body.String())
	}
	for _, test := range []struct {
		name             string
		user, id, status int
		role             string
	}{
		{"guest", 1, 4, 403, "guest"}, {"owner", 4, 1, 200, "basic"}, {"admin any", 2, 2, 200, "admin"}, {"admin removed author", 2, 5, 200, "admin"},
	} {
		t.Run("delete/"+test.name, func(t *testing.T) {
			before := count()
			rec := httptest.NewRecorder()
			CommentDeleteHandler(rec, commentTestRequest(t, "DELETE", fmt.Sprintf("/api/comments/delete?id=%d", test.id), "", test.user, test.role))
			if rec.Code != test.status {
				t.Fatalf("status=%d want=%d: %s", rec.Code, test.status, rec.Body.String())
			}
			want := before
			if test.status == 200 {
				want--
			}
			if count() != want {
				t.Fatal("unexpected deletion count")
			}
		})
	}
}
