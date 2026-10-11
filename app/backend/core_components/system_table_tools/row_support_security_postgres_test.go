// row_support_security_postgres_test.go
// Proves parent-picture and geometry grants at actual response handlers on PostgreSQL.
// Reuses Home's isolated bootstrap; only the embedding HTTP provider is substituted.
// Authorized rows survive denied external picture columns with no gallery relation.
package system_table_tools

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"

	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
)

const rowSupportSecurityDataset = "wl162_support_rows"
const rowSupportSecuritySecret = "https://example.org/private-parent.png"

type rowSupportSecurityEmbeddingTransport struct{ calls int }

func (transport *rowSupportSecurityEmbeddingTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	transport.calls++
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}},
		Body: io.NopCloser(strings.NewReader(`{"data":[{"embedding":[1,0],"index":0}],"model":"text-embedding-3-small","usage":{}}`)), Request: request}, nil
}

func rowSupportSecurityPostgres(t *testing.T) *rowSupportSecurityEmbeddingTransport {
	t.Helper()
	owner := frontPageDisposableDB(t)
	frontPageExec(t, owner, `CREATE TABLE wl162_support_rows(id integer PRIMARY KEY,private_picture text,private_position point,embedding_vector vector(2));
        INSERT INTO wl162_support_rows VALUES(1,'https://example.org/private-parent.png',point(24,60),'[1,0]'),
            (2,'https://example.org/private-parent.png',point(25,61),'[1,0]'),
            (3,'https://example.org/private-parent.png',point(26,62),'[1,0]');
        INSERT INTO system_db_tables(table_name,schema_name,folder_id) VALUES('wl162_support_rows','public',1);
        INSERT INTO system_column_details(table_uid,column_name,data_type,co_number,card_element,hide_everywhere,show_value_on_card)
            SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,
                CASE col.column_name WHEN 'private_picture' THEN 'image' ELSE 'details' END,false,true
            FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
            WHERE col.table_schema='public' AND col.table_name='wl162_support_rows';
        INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
            SELECT 2,500000,table_uid FROM system_db_tables WHERE table_name='wl162_support_rows';
        INSERT INTO system_row_access_rules(table_uid,row_id,user_id,action_id,effect)
            SELECT registry.table_uid,3,42,action.id,'deny' FROM system_db_tables registry
            CROSS JOIN system_permission_actions action WHERE registry.table_name='wl162_support_rows'
                AND action.action_key='read' AND action.scope_type='row';
        UPDATE system_config SET boolean_value=true WHERE key IN ('separate_front_page','front_page_show_blocks');
        INSERT INTO system_front_page_blocks(table_uid,sort_order,result_limit)
            SELECT table_uid,1,5 FROM system_db_tables WHERE table_name='wl162_support_rows';`)
	reader := frontPageRuntimeDB(t, owner)
	frontPageExec(t, owner, `REVOKE SELECT ON wl162_support_rows FROM front_page_runtime;
        GRANT SELECT(id,embedding_vector) ON wl162_support_rows TO front_page_runtime;`)
	var private string
	if err := reader.QueryRow(`SELECT private_picture FROM wl162_support_rows LIMIT 1`).Scan(&private); err == nil {
		t.Fatal("fixture reader can select the private image")
	}
	var relations int
	if err := owner.QueryRow(`SELECT count(*) FROM system_foreign_key_relations_1_m WHERE target_table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='wl162_support_rows')`).Scan(&relations); err != nil || relations != 0 {
		t.Fatal("fixture must have no gallery relation", relations, err)
	}
	read.InvalidateSchemaCache(rowSupportSecurityDataset)
	read.InvalidatePermissionsCache(rowSupportSecurityDataset)
	for _, view := range []string{"table", "card", "article_view", "product_card", "map"} {
		read.InvalidateUserColumnSettingsCache(rowSupportSecurityDataset, view)
	}
	t.Cleanup(func() {
		read.InvalidateSchemaCache(rowSupportSecurityDataset)
		read.InvalidatePermissionsCache(rowSupportSecurityDataset)
		for _, view := range []string{"table", "card", "article_view", "product_card", "map"} {
			read.InvalidateUserColumnSettingsCache(rowSupportSecurityDataset, view)
		}
	})
	transport := &rowSupportSecurityEmbeddingTransport{}
	oldTransport := http.DefaultTransport
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = oldTransport })
	t.Setenv("OPENAI_API_KEY", "isolated-fixture")
	t.Setenv("EMBEDDING_PROVIDER", "openai")
	return transport
}

func assertRowSupportSecurityRows(t *testing.T, rows []map[string]interface{}, wantIDs []int) {
	t.Helper()
	var gotIDs []int
	for _, row := range rows {
		id, ok := row["id"].(float64)
		if !ok || len(row) != 1 {
			t.Fatal("denied picture/geometry disclosed or row identity lost", row)
		}
		gotIDs = append(gotIDs, int(id))
	}
	sort.Ints(gotIDs)
	if !reflect.DeepEqual(gotIDs, wantIDs) {
		t.Fatal("authorized rows changed", gotIDs, wantIDs)
	}
}

func TestRowSupportDeniedParentPictureHandlersPostgres(t *testing.T) {
	transport := rowSupportSecurityPostgres(t)
	for _, mode := range []string{"listing", "blocking", "stream"} {
		for _, params := range []string{"view_key=card", "view_key=article_view", "view_key=product_card", "view_key=map", "view_key=map&include_card_support=1", "view_key=card&include_map_support=1"} {
			t.Run(mode+"/"+params, func(t *testing.T) {
				target := "/api/get-results?dataset=" + rowSupportSecurityDataset + "&row_count=0&" + params
				if mode != "listing" {
					target = "/api/get-intelligent-results?dataset=" + rowSupportSecurityDataset + "&query=1&" + params
					if mode == "stream" {
						target += "&stream=1"
					}
				}
				request := frontPageSessionRequest(t, 42, "basic", "GET", target)
				response := httptest.NewRecorder()
				callsBefore := transport.calls
				if mode == "listing" {
					read.GetResultsHandlerWrapper(response, request)
				} else {
					read.GetIntelligentResultsHandlerWrapper(response, request)
				}
				if response.Code != http.StatusOK || strings.Contains(response.Body.String(), rowSupportSecuritySecret) {
					t.Fatal("denied support broke or leaked through response", response.Code, response.Body.String())
				}
				if mode != "listing" && transport.calls != callsBefore+1 {
					t.Fatal("semantic stage did not run", transport.calls, callsBefore)
				}
				stages := []string{""}
				if mode == "stream" {
					stages = []string{"text", "ai"}
				}
				decoder := json.NewDecoder(response.Body)
				for _, stage := range stages {
					var packet struct {
						Stage   string
						Columns []string
						Data    []map[string]interface{}
					}
					if err := decoder.Decode(&packet); err != nil {
						t.Fatal(err, response.Body)
					}
					if packet.Stage != stage || !reflect.DeepEqual(packet.Columns, []string{"id"}) {
						t.Fatal("stage or presented columns changed", packet)
					}
					wantIDs := []int{1, 2}
					if stage == "text" {
						wantIDs = []int{1}
					} else if stage == "ai" {
						wantIDs = []int{2}
					}
					assertRowSupportSecurityRows(t, packet.Data, wantIDs)
				}
				var extra interface{}
				if err := decoder.Decode(&extra); err != io.EOF {
					t.Fatal("unexpected packet or trailing 500", extra, err)
				}
			})
		}
	}
}

func TestHomeDeniedParentPictureSupportPostgres(t *testing.T) {
	rowSupportSecurityPostgres(t)
	request := frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page")
	// Checking the delegate itself exposes an inner 500 even if Home hides it.
	block, ok := delegateFrontPageBlock(request, frontPageBlock{Dataset: rowSupportSecurityDataset, ResultLimit: 5, Enabled: true})
	if !ok || len(block.Data) != 2 {
		t.Fatal("Home's readable block disappeared", ok, block)
	}
	response := httptest.NewRecorder()
	GetFrontPageHandler(response, request)
	var packet struct{ Blocks []frontPageResultBlock }
	if err := json.Unmarshal(response.Body.Bytes(), &packet); err != nil || response.Code != http.StatusOK || len(packet.Blocks) != 1 || packet.Blocks[0].Dataset != rowSupportSecurityDataset {
		t.Fatal("Home lost the authorized dataset", err, response.Code, response.Body)
	}
	var rows []map[string]interface{}
	for _, raw := range packet.Blocks[0].Data {
		var row map[string]interface{}
		if err := json.Unmarshal(raw, &row); err != nil {
			t.Fatal(err)
		}
		rows = append(rows, row)
	}
	assertRowSupportSecurityRows(t, rows, []int{1, 2})
}
