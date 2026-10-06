// setting_duration_test.go
// Verifies stored shapes, inclusive bounds, all units and calendar arithmetic.
// Connects the portable duration library to both legacy and future field names.
// Exists to prevent unit drift, fractional amounts and fixed-day calendar conversion.
package setting_duration

import (
	"fmt"
	"testing"
	"time"
)

func TestParseDurationUnitsAndBounds(t *testing.T) {
	definition := Definition{AmountField: "amount", UnitField: "unit", Bounds: map[string]Bounds{}}
	for _, unit := range []string{"seconds", "minutes", "hours", "days", "weeks", "months", "years"} {
		definition.Bounds[unit] = Bounds{Min: 2, Max: 10}
	}
	for unit := range definition.Bounds {
		for _, amount := range []int{1, 2, 10, 11} {
			value, err := Parse(fmt.Sprintf(`{"amount":%d,"unit":%q}`, amount, unit), definition)
			if (err == nil) != (amount >= 2 && amount <= 10) {
				t.Fatalf("%d %s: %v", amount, unit, err)
			}
			if err == nil && (value.Unit != unit || value.Amount != amount || !value.Enabled) {
				t.Fatalf("%+v", value)
			}
		}
	}
	for _, raw := range []string{`null`, `{}`, `{"amount":2.5,"unit":"days"}`, `{"amount":"2","unit":"days"}`, `{"amount":2,"unit":"fortnights"}`, `{"amount":null,"unit":"days"}`, `[]`} {
		if _, err := Parse(raw, definition); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	definition.EnabledField = "on"
	if _, err := Parse(`{"amount":2,"unit":"days"}`, definition); err == nil {
		t.Fatal("missing enabled field accepted")
	}
	if value, err := Parse(`{"on":false}`, definition); err != nil || value.Enabled {
		t.Fatalf("explicit off: %+v %v", value, err)
	}
	value, err := Parse(map[string]interface{}{"on": true, "amount": 2, "unit": " DAY "}, definition)
	if err != nil || value.Unit != "days" {
		t.Fatalf("legacy spelling: %+v %v", value, err)
	}
}

func TestDurationCalendarAndElapsedConversion(t *testing.T) {
	january := time.Date(2025, 1, 31, 9, 0, 0, 0, time.UTC)
	leapDay := time.Date(2024, 2, 29, 9, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		start time.Time
		unit  string
		want  time.Time
	}{
		{january, "months", time.Date(2025, 3, 3, 9, 0, 0, 0, time.UTC)},
		{leapDay, "years", time.Date(2025, 3, 1, 9, 0, 0, 0, time.UTC)},
		{january, "seconds", january.Add(time.Second)},
		{january, "minutes", january.Add(time.Minute)},
		{january, "hours", january.Add(time.Hour)},
		{january, "days", january.Add(24 * time.Hour)},
		{january, "weeks", january.Add(7 * 24 * time.Hour)},
	} {
		got, err := (Value{Amount: 1, Unit: test.unit, Enabled: true}).AddTo(test.start)
		if err != nil || !got.Equal(test.want) {
			t.Fatalf("%s: %v %v, want %v", test.unit, got, err, test.want)
		}
	}
	for _, value := range []Value{{Amount: -1, Unit: "days"}, {Amount: 10001, Unit: "years"}, {Amount: int(^uint(0) >> 1), Unit: "weeks"}, {Amount: 1, Unit: "unknown"}} {
		if _, err := value.AddTo(january); err == nil {
			t.Fatalf("accepted %+v", value)
		}
	}
}
