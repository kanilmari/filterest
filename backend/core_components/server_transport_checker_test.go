// server_transport_checker_test.go
// Verifies direct TLS selection for local admin and hosted production runtimes.
// Bridges release-binary security mode with browser cookie transport expectations.
// Exists so admin installation cannot regress to insecure localhost sessions.
package backend

import "testing"

func TestShouldServeWithTLS(t *testing.T) {
	tests := []struct {
		name            string
		environmentType string
		localTLSSetting string
		want            bool
	}{
		{name: "development defaults to TLS", environmentType: "dev", want: true},
		{name: "hosted production stays behind TLS terminator", environmentType: "prod", want: false},
		{name: "local admin production enables direct TLS", environmentType: "prod", localTLSSetting: "true", want: true},
		{name: "local admin setting is normalized", environmentType: "PROD", localTLSSetting: "YES", want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ShouldServeWithTLS(test.environmentType, test.localTLSSetting); got != test.want {
				t.Fatalf("ShouldServeWithTLS(%q, %q) = %v, want %v", test.environmentType, test.localTLSSetting, got, test.want)
			}
		})
	}
}
