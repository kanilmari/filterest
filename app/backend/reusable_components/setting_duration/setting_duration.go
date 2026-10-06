// setting_duration.go
// Parses, validates and applies an integer amount with a named time unit.
// Connects setting-specific JSON field names and bounds with calendar arithmetic.
// Exists so settings writers and readers use the same duration rule.
package setting_duration

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
)

// Bounds is the inclusive amount range for one unit of one setting.
type Bounds struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

// Definition preserves a setting's existing stored names, defaults and limits.
// An empty EnabledField describes a duration that cannot be switched off.
type Definition struct {
	AmountField  string            `json:"amount_field"`
	UnitField    string            `json:"unit_field"`
	EnabledField string            `json:"enabled_field"`
	Default      json.RawMessage   `json:"default"`
	Bounds       map[string]Bounds `json:"bounds"`
}

// Value is a parsed duration; months and years need a starting calendar date.
type Value struct {
	Amount  int
	Unit    string
	Enabled bool
}

// Parse accepts database JSON, a browser object or the JSON text used by CSV.
// Missing fields and fractional amounts are refused rather than becoming zero.
func Parse(raw interface{}, definition Definition) (Value, error) {
	var data []byte
	switch value := raw.(type) {
	case string:
		data = []byte(value)
	case []byte:
		data = value
	case json.RawMessage:
		data = value
	default:
		var err error
		data, err = json.Marshal(raw)
		if err != nil {
			return Value{}, err
		}
	}
	var stored map[string]json.RawMessage
	if err := json.Unmarshal(data, &stored); err != nil {
		return Value{}, err
	}
	value := Value{Enabled: true}
	if definition.EnabledField != "" {
		field := stored[definition.EnabledField]
		if len(field) == 0 || string(field) == "null" {
			return Value{}, fmt.Errorf("%s must say whether the setting is enabled", definition.EnabledField)
		}
		if err := json.Unmarshal(field, &value.Enabled); err != nil {
			return Value{}, err
		}
	}
	// An explicitly disabled setting describes no duration. Retain this legacy
	// contract, but an enabled setting always needs a valid amount and unit.
	if !value.Enabled {
		return value, nil
	}
	if err := json.Unmarshal(stored[definition.AmountField], &value.Amount); err != nil {
		return Value{}, err
	}
	if err := json.Unmarshal(stored[definition.UnitField], &value.Unit); err != nil {
		return Value{}, err
	}
	value.Unit = NormalizeUnit(value.Unit)
	if err := Validate(value, definition); err != nil {
		return Value{}, err
	}
	return value, nil
}

// NormalizeUnit retains the singular, case and whitespace spellings old readers accepted.
func NormalizeUnit(unit string) string {
	unit = strings.ToLower(strings.TrimSpace(unit))
	return strings.TrimSuffix(unit, "s") + "s"
}

// Validate checks setting-specific bounds before any multiplication or AddDate.
func Validate(value Value, definition Definition) error {
	if !value.Enabled {
		return nil
	}
	unit := NormalizeUnit(value.Unit)
	bounds, allowed := definition.Bounds[unit]
	if !allowed {
		return fmt.Errorf("unit %q is not allowed", value.Unit)
	}
	if value.Amount < bounds.Min || value.Amount > bounds.Max {
		return fmt.Errorf("amount must be between %d and %d %s", bounds.Min, bounds.Max, unit)
	}
	_, err := value.AddTo(time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC))
	return err
}

// AddTo uses Go's calendar normalization for months and years (31 January plus
// one month can enter March). Smaller units measure elapsed time, including days.
func (value Value) AddTo(start time.Time) (time.Time, error) {
	if value.Amount < 0 {
		return time.Time{}, fmt.Errorf("negative duration")
	}
	var unit time.Duration
	switch NormalizeUnit(value.Unit) {
	case "seconds":
		unit = time.Second
	case "minutes":
		unit = time.Minute
	case "hours":
		unit = time.Hour
	case "days":
		unit = 24 * time.Hour
	case "weeks":
		unit = 7 * 24 * time.Hour
	case "months", "years":
		// Bound calendar arithmetic too; no setting can overflow a year count.
		if value.Amount > 10000 {
			return time.Time{}, fmt.Errorf("calendar duration is too large")
		}
		if NormalizeUnit(value.Unit) == "months" {
			return start.AddDate(0, value.Amount, 0), nil
		}
		return start.AddDate(value.Amount, 0, 0), nil
	default:
		return time.Time{}, fmt.Errorf("unknown duration unit %q", value.Unit)
	}
	if int64(value.Amount) > math.MaxInt64/int64(unit) {
		return time.Time{}, fmt.Errorf("duration overflows")
	}
	return start.Add(time.Duration(value.Amount) * unit), nil
}
