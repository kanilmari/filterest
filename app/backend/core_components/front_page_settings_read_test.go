// front_page_settings_read_test.go
// Proves Home box defaults and malformed boolean refusal without PostgreSQL.
// Uses a narrow in-memory SQL driver for the real settings reader's site-wide keys.
// Distinguishes an absent row from a stored false value and an invalid null.
package backend

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"sync/atomic"
	"testing"
)

type frontPageSwitchDriver struct{ values map[string]driver.Value }
type frontPageSwitchConn struct{ values map[string]driver.Value }
type frontPageSwitchRows struct {
	value driver.Value
	done  bool
}

var frontPageSwitchDriverID atomic.Int64

func (d frontPageSwitchDriver) Open(string) (driver.Conn, error) {
	return frontPageSwitchConn{d.values}, nil
}
func (c frontPageSwitchConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (c frontPageSwitchConn) Close() error { return nil }
func (c frontPageSwitchConn) Begin() (driver.Tx, error) {
	return nil, errors.New("unexpected transaction")
}
func (c frontPageSwitchConn) QueryContext(_ context.Context, _ string, args []driver.NamedValue) (driver.Rows, error) {
	value, found := c.values[args[0].Value.(string)]
	return &frontPageSwitchRows{value: value, done: !found}, nil
}
func (r *frontPageSwitchRows) Columns() []string { return []string{"boolean_value"} }
func (r *frontPageSwitchRows) Close() error      { return nil }
func (r *frontPageSwitchRows) Next(values []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	values[0] = r.value
	return nil
}
func TestReadFrontPageBoxSwitchMissingFalseAndInvalid(t *testing.T) {
	for _, tc := range []struct {
		values  map[string]driver.Value
		boxes   bool
		invalid bool
	}{
		{map[string]driver.Value{}, true, false},
		{map[string]driver.Value{"front_page_show_blocks": false}, false, false},
		{map[string]driver.Value{"front_page_show_blocks": true}, true, false},
		{map[string]driver.Value{"front_page_show_blocks": nil}, false, true},
	} {
		name := fmt.Sprintf("front_page_switch_%d", frontPageSwitchDriverID.Add(1))
		sql.Register(name, frontPageSwitchDriver{tc.values})
		db, err := sql.Open(name, "")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		settings, err := ReadFrontPageSettings(context.Background(), db)
		if (err != nil) != tc.invalid || (!tc.invalid && (settings.FrontPageShowBlocks != tc.boxes || settings.SeparateFrontPage || settings.FrontPageButtonShowsSiteName)) {
			t.Fatal(settings, err, tc)
		}
	}
}

func TestHomeTopBarSwitchDefaultAndDisabledReadBoundary(t *testing.T) {
	const key = "show_home_button_in_top_bar_on_wide_screens"
	for _, tc := range []struct {
		name              string
		values            map[string]driver.Value
		expected, invalid bool
	}{
		{"missing", map[string]driver.Value{"separate_front_page": true}, false, false},
		{"false", map[string]driver.Value{"separate_front_page": true, key: false}, false, false},
		{"true", map[string]driver.Value{"separate_front_page": true, key: true}, true, false},
		{"invalid enabled", map[string]driver.Value{"separate_front_page": true, key: nil}, false, true},
		{"disabled ignores malformed", map[string]driver.Value{key: nil}, false, false},
		{"disabled ignores true", map[string]driver.Value{key: true}, false, false},
		{"custom root", map[string]driver.Value{"display_index_html_at_startup": true, key: true}, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			name := fmt.Sprintf("front_page_switch_%d", frontPageSwitchDriverID.Add(1))
			sql.Register(name, frontPageSwitchDriver{tc.values})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			settings, err := ReadFrontPageSettings(context.Background(), db)
			if (err != nil) != tc.invalid || (!tc.invalid && settings.ShowHomeButtonInTopBarOnWideScreens != tc.expected) {
				t.Fatal(settings, err)
			}
		})
	}
}
