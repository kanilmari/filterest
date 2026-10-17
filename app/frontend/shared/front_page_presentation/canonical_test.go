// canonical_test.go
// Proves the downgrade-safe v2/v3 storage rule independently of persistence.
// Connects strict old/new requests, inactive timings and restore round trips.
// Keeps default-style sites readable by binaries that accept only v2.
package front_page_presentation

import (
	"encoding/json"
	"reflect"
	"strconv"
	"testing"
)

func TestCanonicalStoredFormsAndRestore(t *testing.T) {
	for _, tc := range []struct {
		name, preset, mode string
		start, interval    int
		version            int
	}{
		{"absent style", "", "", 0, 0, 2},
		{"default timings", "default", "none", 3000, 800, 2},
		{"inactive custom timings", "default", "none", 1234, 567, 2},
		{"serif without reveal", "serif_story_v1", "none", 1234, 567, 3},
		{"default with reveal", "default", "lines", 1234, 567, 3},
		{"serif with reveal", "serif_story_v1", "lines", 3000, 800, 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			value := Rules().Default
			value.Anchor, value.HorizontalMarginPx, value.DarkWash = "bottom-right", 73, 19
			fields, _ := presentationFields(value)
			if tc.preset == "" {
				fields["schema_version"] = json.RawMessage(`2`)
				delete(fields, "text_style")
			} else {
				value.TextStyle = TextStyle{tc.preset, LineReveal{tc.mode, tc.start, tc.interval}}
				fields, _ = presentationFields(value)
			}
			stored, canonical, err := CanonicalStored(fields)
			if err != nil || canonical != (tc.preset == "" || tc.version == 3) {
				t.Fatal(canonical, err)
			}
			gotFields, _ := presentationFields(stored)
			wantCount := 10
			if tc.version == 3 {
				wantCount = 11
			}
			if len(gotFields) != wantCount || string(gotFields["schema_version"]) != strconv.Itoa(tc.version) ||
				(gotFields["text_style"] != nil) != (tc.version == 3) {
				t.Fatal(string(stored))
			}
			read, err := ParseStored(stored)
			if tc.version == 2 {
				value.TextStyle = Rules().Default.TextStyle
			}
			if err != nil || read != value {
				t.Fatal(read, value, err)
			}
			// T16 restores the complete GET value, which is v3 even when the row is v2.
			restored, _, err := CanonicalStored(read)
			if err != nil {
				t.Fatal(err)
			}
			var before, after any
			json.Unmarshal(stored, &before)
			json.Unmarshal(restored, &after)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("restore changed fields", string(stored), string(restored))
			}
		})
	}
}

func TestCanonicalStoredRejectsMalformedRequests(t *testing.T) {
	for _, raw := range []string{`null`, `{}`, `[]`, `{"schema_version":1,"anchor":"top-left","margin_px":40,"paragraph_layout":"normal","max_width_px":1120}`} {
		if _, _, err := CanonicalStored(raw); err == nil {
			t.Fatal("accepted", raw)
		}
	}
	fields, _ := presentationFields(Rules().Default)
	fields["schema_version"] = json.RawMessage(`2`)
	if _, _, err := CanonicalStored(fields); err == nil {
		t.Fatal("v2 with text_style accepted")
	}
	delete(fields, "text_style")
	for _, change := range []struct {
		key   string
		value json.RawMessage
	}{
		{"extra", json.RawMessage(`true`)}, {"anchor", json.RawMessage(`null`)}, {"max_width_px", json.RawMessage(`321`)},
	} {
		original := fields[change.key]
		fields[change.key] = change.value
		if _, _, err := CanonicalStored(fields); err == nil {
			t.Fatal("malformed v2 accepted", fields)
		}
		if original == nil {
			delete(fields, change.key)
		} else {
			fields[change.key] = original
		}
	}
}
