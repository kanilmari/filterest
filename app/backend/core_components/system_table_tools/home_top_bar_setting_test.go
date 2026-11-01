// home_top_bar_setting_test.go
// Proves the site-wide Home switch round trip and legacy-client preservation.
// Connects the strict admin decoder, transactional saver and production reader.
// An isolated SQL fixture records writes without contacting any database.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
)

const homeTopBarSettingKey = "show_home_button_in_top_bar_on_wide_screens"

type homeTopBarSettingFixture map[string]driver.Value
type homeTopBarSettingConn struct{ values homeTopBarSettingFixture }
type homeTopBarSettingTx struct{}

func (f homeTopBarSettingFixture) Connect(context.Context) (driver.Conn, error) {
	return homeTopBarSettingConn{f}, nil
}
func (f homeTopBarSettingFixture) Driver() driver.Driver { return f }
func (f homeTopBarSettingFixture) Open(string) (driver.Conn, error) {
	return homeTopBarSettingConn{f}, nil
}
func (c homeTopBarSettingConn) Close() error { return nil }
func (c homeTopBarSettingConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("unexpected prepare")
}
func (c homeTopBarSettingConn) Begin() (driver.Tx, error) { return homeTopBarSettingTx{}, nil }
func (homeTopBarSettingTx) Commit() error                 { return nil }
func (homeTopBarSettingTx) Rollback() error               { return nil }
func (c homeTopBarSettingConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if !strings.Contains(query, "SELECT boolean_value FROM public.system_config WHERE key = $1") {
		return nil, fmt.Errorf("unexpected read: %s", query)
	}
	key := args[0].Value.(string)
	// A disabled Home must not even issue the optional setting query.
	if key == homeTopBarSettingKey && c.values["separate_front_page"] != true && c.values["display_index_html_at_startup"] != true {
		return nil, fmt.Errorf("disabled Home read its top-bar setting")
	}
	value, found := c.values[key]
	if !found {
		return queryfixture.Rows([]string{"boolean_value"}), nil
	}
	return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{value}), nil
}
func (c homeTopBarSettingConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(query, "INSERT INTO public.system_config") || !strings.Contains(query, "ON CONFLICT (key) DO UPDATE") || !strings.Contains(query, "jsonb_build_object('value',$2::boolean)") {
		return nil, fmt.Errorf("unexpected setting write: %s", query)
	}
	c.values[args[0].Value.(string)] = args[1].Value
	return driver.RowsAffected(1), nil
}

func TestHomeTopBarSettingReadWriteDefaultAndLegacyClient(t *testing.T) {
	values := homeTopBarSettingFixture{"separate_front_page": true}
	db := sql.OpenDB(values)
	defer db.Close()
	read := func(want bool) {
		t.Helper()
		settings, err := backend.ReadFrontPageSettings(context.Background(), db)
		if err != nil || settings.ShowHomeButtonInTopBarOnWideScreens != want {
			t.Fatalf("read: %+v, %v; want %t", settings, err, want)
		}
	}
	read(false)
	for _, value := range []bool{true, false, true} {
		request, err := decodeFrontPageAdminRequest(strings.NewReader(fmt.Sprintf(`{"settings":{"separate_front_page":true,"front_page_button_shows_site_name":false,"%s":%t}}`, homeTopBarSettingKey, value)))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := frontPageTestSave(db, request); err != nil {
			t.Fatal(err)
		}
		read(value)
	}
	legacy, err := decodeFrontPageAdminRequest(strings.NewReader(`{"settings":{"separate_front_page":true,"front_page_button_shows_site_name":false}}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := frontPageTestSave(db, legacy); err != nil {
		t.Fatal(err)
	}
	read(true)
	values["separate_front_page"] = false
	values[homeTopBarSettingKey] = nil
	read(false)
}

func TestHomeTopBarSettingRejectsNonBooleanAndPersonalScope(t *testing.T) {
	for _, value := range []string{`null`, `"true"`, `"false"`, `0`, `1`, `1.5`, `{}`, `[]`} {
		t.Run(value, func(t *testing.T) {
			body := fmt.Sprintf(`{"settings":{"separate_front_page":true,"front_page_button_shows_site_name":false,"%s":%s}}`, homeTopBarSettingKey, value)
			if _, err := decodeFrontPageAdminRequest(strings.NewReader(body)); !errors.Is(err, errFrontPageInput) {
				t.Fatal("invalid request accepted or validation error changed", body, err)
			}
			response := httptest.NewRecorder()
			AdminFrontPageHandler(response, httptest.NewRequest("POST", "/api/admin/front-page", strings.NewReader(body)))
			var payload map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || response.Code != 400 || payload["code"] != float64(400) || payload["error"] != errFrontPageInput.Error() {
				t.Fatal(response.Code, response.Body.String(), err)
			}
		})
	}
	body := `{"user_id":42,"settings":{"separate_front_page":true,"front_page_button_shows_site_name":false,"show_home_button_in_top_bar_on_wide_screens":true}}`
	if _, err := decodeFrontPageAdminRequest(strings.NewReader(body)); err == nil {
		t.Fatal("accepted personal scope", body)
	}
}

func TestHomeTopBarSettingSaverPreservesOmissionAndRejectsNonBooleans(t *testing.T) {
	for _, stored := range []bool{false, true} {
		for _, raw := range []string{"", "true", "false", "null", `"true"`, `"false"`, "0", "1", "1.5", "{}", "[]"} {
			t.Run(fmt.Sprintf("stored=%t/value=%s", stored, raw), func(t *testing.T) {
				values := homeTopBarSettingFixture{"separate_front_page": true, "front_page_button_shows_site_name": true, homeTopBarSettingKey: stored}
				before := homeTopBarSettingFixture{"separate_front_page": true, "front_page_button_shows_site_name": true, homeTopBarSettingKey: stored}
				db := sql.OpenDB(values)
				defer db.Close()
				on, off := true, false
				settings := frontPageAdminSettings{SeparateFrontPage: &on, FrontPageButtonShowsSiteName: &off}
				// Bypass the request validator to prove the save boundary independently.
				if raw != "" {
					if err := json.Unmarshal([]byte(fmt.Sprintf(`{"%s":%s}`, homeTopBarSettingKey, raw)), &settings); err != nil {
						t.Fatal(err)
					}
				}
				_, err := frontPageTestSave(db, frontPageAdminRequest{Settings: &settings})
				if raw != "" && raw != "true" && raw != "false" {
					if !errors.Is(err, errFrontPageInput) || !reflect.DeepEqual(values, before) {
						t.Fatalf("invalid save changed values: %v, %v", values, err)
					}
					return
				}
				want := stored
				if raw != "" {
					want = raw == "true"
				}
				if err != nil || values[homeTopBarSettingKey] != want {
					t.Fatalf("saved %v, %v; want %t", values, err, want)
				}
			})
		}
	}
}
