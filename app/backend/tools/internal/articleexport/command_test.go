// command_test.go
// Checks explicit connection selection and DSN-safe failures without a database.
// Connects both exporter commands to the same argument and diagnostic contract.
// A malformed connection or flag can never be echoed into operator output.
package articleexport

import (
	"bytes"
	"strings"
	"testing"
)

func TestExplicitDSNAndSanitizedErrors(t *testing.T) {
	marker := "private-connection-sentinel"
	t.Setenv("K388_TEST_DSN", "postgres://"+marker+":%invalid")
	for _, after := range []bool{false, true} {
		for _, test := range []struct {
			args []string
			want int
		}{
			{nil, 2}, {[]string{"--dsn-env", "K388_MISSING_DSN"}, 2},
			{[]string{"--dsn-env", "K388_TEST_DSN", "--timeout", "-1s"}, 2},
			{[]string{"--unknown=" + marker}, 2},
			{[]string{"--dsn-env", "K388_TEST_DSN"}, 1},
		} {
			var out, diag bytes.Buffer
			code := Run(test.args, &out, &diag, after)
			if code != test.want || out.Len() != 0 || strings.Contains(diag.String(), marker) {
				t.Fatalf("export code=%d, output=%q, diagnostics=%q", code, out.String(), diag.String())
			}
		}
	}
}
