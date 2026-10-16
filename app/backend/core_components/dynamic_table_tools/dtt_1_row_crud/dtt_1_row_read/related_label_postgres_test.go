// related_label_postgres_test.go
// Reproduces exact-row label denial through the real related-rows HTTP handler.
// Uses the disposable owner/reader fixture and the migration's shared resolver.
// Covers incoming and outgoing hydration without touching installation data.
package dtt_1_row_read

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
)

func TestRelatedLabelReadPathsPostgres(t *testing.T) {
	owner, _ := installRelatedPool(t, relatedPoolPostgresConnector(t))
	baselineExec(t, owner, `
CREATE TABLE parents(id integer PRIMARY KEY);
CREATE TABLE targets(id integer PRIMARY KEY,title text);
CREATE TABLE children(id integer PRIMARY KEY,parent_id integer REFERENCES parents(id),target_id integer REFERENCES targets(id));
CREATE TABLE origins(id integer PRIMARY KEY,child_id integer REFERENCES children(id));
INSERT INTO system_db_tables(table_uid,table_name,fk_display_column) VALUES
 (201,'parents',NULL),(202,'children',NULL),(203,'targets','title'),(204,'origins',NULL);
INSERT INTO parents VALUES(1);
INSERT INTO targets VALUES(7,'confidential'),(8,'readable');
INSERT INTO children VALUES(1,1,7),(2,1,8);
INSERT INTO origins VALUES(1,1),(2,2);
INSERT INTO system_user_group_memberships VALUES(4,2),(2,2);
INSERT INTO system_group_table_func_rights
 SELECT 2,function_id,table_uid FROM (VALUES(1),(2)) f(function_id)
 CROSS JOIN (VALUES(201),(202),(203),(204)) d(table_uid);
INSERT INTO system_row_access_rules(table_uid,action_id,row_id,user_id,effect) VALUES(203,1,7,4,'deny');
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wl58_reader;
`)
	var socket, port string
	if err := owner.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	reader, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%s user=wl58_reader dbname=postgres sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reader.Close() })
	backend.DbBasic = reader

	// An empty mandatory policy is essential: the old admission test mistook
	// this for permission to disclose every target's title.
	policy, err := getLegacyMustTrueReadPolicy(reader, "targets")
	if err != nil || policy.hasFlagColumns() {
		t.Fatalf("target must have no mandatory flags: %+v %v", policy, err)
	}
	for _, role := range []string{"basic", "admin"} {
		for _, direction := range []string{"incoming", "outgoing"} {
			t.Run(role+"/"+direction, func(t *testing.T) {
				parentIDs := []int{1}
				parentDataset := "parents"
				if direction == "outgoing" {
					parentDataset, parentIDs = "origins", []int{1, 2}
				}
				seen := map[string]bool{}
				for _, parentID := range parentIDs {
					request := httptest.NewRequest("POST", "/api/fetch-dynamic-children?dataset="+parentDataset,
						strings.NewReader(fmt.Sprintf(`{"parent_dataset":%q,"parent_pk_value":%q,"child_table":"children"}`, parentDataset, fmt.Sprint(parentID))))
					actorID := 4
					if role == "admin" {
						actorID = 2
					}
					request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(actorID, role)))
					response := httptest.NewRecorder()
					GetDynamicRelatedItemsHandler(response, request)
					if response.Code != http.StatusOK {
						t.Fatalf("status=%d body=%s", response.Code, response.Body)
					}
					var body struct {
						Children []RelatedTableResult `json:"child_tables"`
					}
					if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
						t.Fatal(err)
					}
					for _, related := range body.Children {
						if related.Table_name != "children" || related.ReferenceDirection != direction {
							continue
						}
						for _, row := range related.Rows {
							id := fmt.Sprint(row["target_id"])
							seen[id] = true
							var want interface{} = "readable"
							if id == "7" {
								want = nil
								if role == "admin" {
									want = "confidential"
								}
							}
							label, present := row["target_name"]
							if !present || label != want {
								t.Fatalf("target %s label=%#v present=%v want=%#v row=%v", id, label, present, want, row)
							}
						}
					}
					if role != "admin" && strings.Contains(response.Body.String(), "confidential") {
						t.Fatal("denied live label escaped through another response field", response.Body)
					}
				}
				if len(seen) != 2 || !seen["7"] || !seen["8"] {
					t.Fatal("source rows or keys lost", seen)
				}
			})
		}
	}
}
