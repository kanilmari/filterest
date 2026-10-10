// reauthentication_saver_test.go
// Exercises proof issuance and consumption across PostgreSQL timestamp precision.
// Connects real persistence code to the scripted database without a live cluster.
// Prevents a fresh proof becoming future-dated or outliving its five-minute limit.
package application_updates

import (
	"context"
	"testing"
	"time"
)

func TestProofRoundTripKeepsFreshnessWithinFiveMinutes(t *testing.T) {
	for _, sample := range []struct {
		name       string
		nanosecond int
		zone       *time.Location
	}{
		{"exact microsecond", 123456000, time.UTC},
		{"rounds down", 123456100, time.UTC},
		{"below rounding midpoint", 123456499, time.UTC},
		{"above rounding midpoint", 123456501, time.UTC},
		{"rounds up", 123456900, time.UTC},
		{"rounds into next second", 999999900, time.UTC},
		{"non UTC clock", 123456900, time.FixedZone("UTC+3", 3*60*60)},
	} {
		t.Run(sample.name, func(t *testing.T) {
			issuedAt := time.Date(2026, 10, 10, 7, 48, 0, sample.nanosecond, sample.zone)
			for _, action := range []string{"request", "accept", "refuse"} {
				t.Run(action, func(t *testing.T) {
					binding := proofBinding{testActor(), action, "object-1", testTarget()}
					tx, state := scriptTx(t)
					response, err := createProof(context.Background(), tx, binding, "totp", issuedAt)
					if err != nil {
						t.Fatal(err)
					}
					// PostgreSQL's timestamptz input rounds the driver's nanoseconds to
					// microseconds. Read back the actual INSERT arguments at that precision.
					insert := state.executed[0]
					created := insert.args[2].Value.(time.Time).Round(time.Microsecond)
					expires := insert.args[3].Value.(time.Time).Round(time.Microsecond)
					for _, check := range []struct {
						name string
						at   time.Time
						code string
					}{
						{"immediately fresh", issuedAt, ""},
						{"last fresh nanosecond", expires.Add(-time.Nanosecond), ""},
						{"stored deadline", expires, "proof_expired"},
						{"five minutes since issuance", issuedAt.Add(5 * time.Minute), "proof_expired"},
						{"past five minutes", issuedAt.Add(5*time.Minute + time.Nanosecond), "proof_expired"},
						{"future creation", created.Add(-time.Nanosecond), "proof_expired"},
					} {
						t.Run(check.name, func(t *testing.T) {
							tx, readState := scriptTx(t, one("SELECT binding", jsonBytes(binding), created, expires, nil))
							_, err := consumeProof(context.Background(), tx, response.Proof, binding, check.at)
							if check.code != "" {
								assertCode(t, err, check.code)
								if len(readState.executed) != 0 {
									t.Fatal("expired proof was consumed")
								}
							} else if err != nil {
								t.Fatal(err)
							} else if len(readState.executed) != 1 {
								t.Fatal("fresh proof was not consumed exactly once")
							}
						})
					}
					if created.After(issuedAt) || expires.After(issuedAt.Add(5*time.Minute)) || expires.Sub(created) != 5*time.Minute {
						t.Fatalf("database proof window %s to %s exceeds issuance window starting %s", timestamp(created), timestamp(expires), timestamp(issuedAt))
					}
					if response.ExpiresAt != timestamp(expires) {
						t.Fatalf("returned expiry %s differs from stored expiry %s", response.ExpiresAt, timestamp(expires))
					}
				})
			}
		})
	}
}
