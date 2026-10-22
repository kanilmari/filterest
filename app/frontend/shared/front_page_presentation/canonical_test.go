// canonical_test.go
// Proves the downgrade-safe v2/v3/v4/v5 storage rule independently of persistence.
// Connects strict old/new requests, inactive timings and restore round trips.
// Keeps default-style sites readable by binaries that accept only v2.
package front_page_presentation

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strconv"
	"testing"
)

func TestCanonicalStoredPreservesLegacyCanonicalBytes(t *testing.T) {
	for _, version := range []int{2, 3, 4} {
		for _, alignment := range []string{"left", "center", "right", "justify"} {
			fields, _ := presentationFields(Rules().Default)
			fields["schema_version"], _ = json.Marshal(version)
			fields["alignment"], _ = json.Marshal(alignment)
			delete(fields, "phone_story_size")
			if version == 4 {
				fields["phone_alignment"] = json.RawMessage(`"center"`)
				fields["alignment"], _ = json.Marshal(map[string]string{"left": "start", "right": "end", "center": "center", "justify": "justify"}[alignment])
			} else {
				delete(fields, "phone_alignment")
			}
			if version == 2 {
				delete(fields, "text_style")
			} else {
				style := Rules().Default.TextStyle
				style.Preset = "serif_story_v1"
				fields["text_style"], _ = json.Marshal(style)
			}
			original, _ := json.Marshal(fields)
			read, err := ParseStored(original)
			if err != nil {
				t.Fatal(err)
			}
			stored, canonical, err := CanonicalStored(original)
			if err != nil || !canonical || !bytes.Equal(stored, original) {
				t.Fatal("old canonical bytes changed", string(stored), err)
			}
			roundTrip, _, err := CanonicalStored(read)
			if err != nil || !bytes.Equal(roundTrip, original) {
				t.Fatal("read/save changed legacy bytes", string(roundTrip), err)
			}
			// A rollback through the palette must restore today's exact canonical bytes.
			for size := 12; size <= 18; size++ {
				read.PhoneStorySize = size
				sized, _, err := CanonicalStored(read)
				if err != nil {
					t.Fatal(err)
				}
				storedFields, _ := presentationFields(sized)
				wantVersion := 5
				if size == 15 {
					wantVersion = version
				}
				if string(storedFields["schema_version"]) != strconv.Itoa(wantVersion) {
					t.Fatal("wrong stored version", string(sized))
				}
				readBack, err := ParseStored(sized)
				if err != nil {
					t.Fatal(err)
				}
				readBack.PhoneStorySize = 15
				rolledBack, _, err := CanonicalStored(readBack)
				if err != nil || !bytes.Equal(rolledBack, original) {
					t.Fatal("rollback changed legacy bytes", string(rolledBack), err)
				}
			}
		}
	}
}

func TestCanonicalStoredFormsAndRestore(t *testing.T) {
	for _, tc := range []struct {
		name, preset, mode string
		start, interval    int
		version            int
		phone              string
		size               int
	}{
		{"absent style", "", "", 0, 0, 2, "inherit", 15},
		{"default timings", "default", "none", 3000, 800, 2, "inherit", 15},
		{"inactive custom timings", "default", "none", 1234, 567, 2, "inherit", 15},
		{"serif without reveal", "serif_story_v1", "none", 1234, 567, 3, "inherit", 15},
		{"default with reveal", "default", "lines", 1234, 567, 3, "inherit", 15},
		{"serif with reveal", "serif_story_v1", "lines", 3000, 800, 3, "inherit", 15},
		{"default phone start", "default", "none", 1234, 567, 4, "start", 15},
		{"serif phone centre", "serif_story_v1", "lines", 3000, 800, 4, "center", 15},
		{"small story", "default", "none", 3000, 800, 5, "inherit", 12},
		{"large story", "serif_story_v1", "lines", 3000, 800, 5, "center", 18},
	} {
		t.Run(tc.name, func(t *testing.T) {
			value := Rules().Default
			value.Alignment, value.PhoneAlignment, value.PhoneStorySize = "end", tc.phone, tc.size
			value.Anchor, value.HorizontalMarginPx, value.DarkWash = "bottom-right", 73, 19
			fields, _ := presentationFields(value)
			if tc.preset == "" {
				fields["schema_version"] = json.RawMessage(`2`)
				fields["alignment"] = json.RawMessage(`"right"`)
				delete(fields, "phone_alignment")
				delete(fields, "phone_story_size")
				delete(fields, "text_style")
			} else {
				value.TextStyle = TextStyle{tc.preset, LineReveal{tc.mode, tc.start, tc.interval}}
				fields, _ = presentationFields(value)
			}
			stored, canonical, err := CanonicalStored(fields)
			if err != nil || canonical != (tc.preset == "" || tc.version == 5) {
				t.Fatal(canonical, err)
			}
			gotFields, _ := presentationFields(stored)
			wantCount := 10
			if tc.version >= 3 {
				wantCount = tc.version + 8
			}
			if len(gotFields) != wantCount || string(gotFields["schema_version"]) != strconv.Itoa(tc.version) ||
				(gotFields["text_style"] != nil) != (tc.version >= 3) ||
				(gotFields["phone_alignment"] != nil) != (tc.version >= 4) ||
				(gotFields["phone_story_size"] != nil) != (tc.version == 5) {
				t.Fatal(string(stored))
			}
			wantAlignment := `"right"`
			if tc.version >= 4 {
				wantAlignment = `"end"`
			}
			if string(gotFields["alignment"]) != wantAlignment {
				t.Fatal(string(stored))
			}
			read, err := ParseStored(stored)
			if tc.version == 2 {
				value.TextStyle = Rules().Default.TextStyle
			}
			if err != nil || read != value {
				t.Fatal(read, value, err)
			}
			// Restores use the complete v5 GET value even when the row is v2/v3.
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
	delete(fields, "phone_alignment")
	delete(fields, "phone_story_size")
	fields["alignment"] = json.RawMessage(`"left"`)
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

func TestCanonicalStoredRejectsInvalidPhoneSizes(t *testing.T) {
	fields, _ := presentationFields(Rules().Default)
	for _, bad := range []string{`11`, `19`, `15.5`, `"15"`, `null`} {
		fields["phone_story_size"] = json.RawMessage(bad)
		if _, _, err := CanonicalStored(fields); err == nil {
			t.Fatal("invalid phone size accepted", bad)
		}
	}
	delete(fields, "phone_story_size")
	if _, _, err := CanonicalStored(fields); err == nil {
		t.Fatal("missing v5 phone size accepted")
	}
	fields["schema_version"] = json.RawMessage(`4`)
	fields["phone_story_size"] = json.RawMessage(`15`)
	if _, _, err := CanonicalStored(fields); err == nil {
		t.Fatal("v4 with phone size accepted")
	}
}
