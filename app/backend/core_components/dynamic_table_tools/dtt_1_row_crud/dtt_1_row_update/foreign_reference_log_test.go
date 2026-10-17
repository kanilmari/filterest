package dtt_1_row_update

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/lib/pq"
)

func TestForeignReferenceErrorClassNeverCarriesTheMessage(t *testing.T) {
	submitted := "2147483648"
	cases := []struct {
		err  error
		want string
	}{
		{fmt.Errorf("resolve foreign row: %w", &pq.Error{Code: "22003", Message: `value "` + submitted + `" is out of range for type integer`}), "sqlstate 22003"},
		{fmt.Errorf("resolve foreign row: %w", sql.ErrNoRows), "no rows"},
		{fmt.Errorf("query: %w", context.Canceled), "context canceled"},
		{fmt.Errorf("query: %w", context.DeadlineExceeded), "context deadline exceeded"},
		{errors.New("value " + submitted + " rejected"), "*errors.errorString"},
	}
	for _, c := range cases {
		got := foreignReferenceErrorClass(c.err)
		if got != c.want {
			t.Errorf("foreignReferenceErrorClass(%q) = %q, want %q", c.err, got, c.want)
		}
		if strings.Contains(got, submitted) {
			t.Errorf("class %q carries the submitted value", got)
		}
	}
}
