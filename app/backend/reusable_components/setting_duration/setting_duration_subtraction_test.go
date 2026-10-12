// setting_duration_subtraction_test.go
// Verifies past durations retain the shared elapsed and calendar rules.
// Connects backward retention cutoffs to the existing duration arithmetic.
// Protects DST, leap-day and overflow behavior without a database.
package setting_duration

import (
	"testing"
	"time"
)

func TestDurationSubtractFromElapsedDaysAndCalendarYears(t *testing.T) {
	location, err := time.LoadLocation("Europe/Helsinki")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2024, 2, 29, 12, 0, 0, 0, location)
	for _, value := range []Value{{Amount: 90, Unit: "days"}, {Amount: 1, Unit: "years"}} {
		got, err := value.SubtractFrom(start)
		if err != nil {
			t.Fatal(err)
		}
		want := start.Add(-90 * 24 * time.Hour)
		if value.Unit == "years" {
			want = start.AddDate(-1, 0, 0)
		}
		if !got.Equal(want) {
			t.Fatal(value, got, want)
		}
	}
	for _, value := range []Value{{Amount: -1, Unit: "days"}, {Amount: 106752, Unit: "days"}, {Amount: 10001, Unit: "years"}} {
		if _, err := value.SubtractFrom(start); err == nil {
			t.Fatal("invalid duration accepted", value)
		}
	}
}
