package system_table_tools

import "testing"

func TestNormalizeCardDetailsLayout(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "single line", input: "single_line", want: "single_line"},
		{name: "stacked", input: "stacked", want: "stacked"},
		{name: "inline", input: "inline", want: "inline"},
		{name: "conditional multiline", input: "conditional_multiline", want: "conditional_multiline"},
		{name: "legacy multiline", input: "multiline", want: "conditional_multiline"},
		{name: "unknown fallback", input: "legacy", want: "conditional_multiline"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeCardDetailsLayout(tt.input); got != tt.want {
				t.Fatalf("normalizeCardDetailsLayout(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeCardStyleVariant(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "standard", input: "standard", want: "standard"},
		{name: "modern", input: "modern", want: "modern"},
		{name: "unknown fallback", input: "floating", want: "standard"},
		{name: "empty fallback", input: "", want: "standard"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeCardStyleVariant(tt.input); got != tt.want {
				t.Fatalf("normalizeCardStyleVariant(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeCardDetailIconKey(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "lowercase valid key", input: "Calendar-Clock", want: "calendar-clock"},
		{name: "allows underscore", input: "custom_key", want: "custom_key"},
		{name: "rejects spaces", input: "bad key", want: ""},
		{name: "empty fallback", input: "", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeCardDetailIconKey(tt.input); got != tt.want {
				t.Fatalf("normalizeCardDetailIconKey(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeNullableCardDetailIconKey(t *testing.T) {
	empty := normalizeNullableCardDetailIconKey("")
	if empty.Valid {
		t.Fatalf("empty icon key should normalize to NULL, got %q", empty.String)
	}

	valid := normalizeNullableCardDetailIconKey(" Bolt-Pattern ")
	if !valid.Valid || valid.String != "bolt-pattern" {
		t.Fatalf("valid icon key = (%q, %v), want (%q, true)", valid.String, valid.Valid, "bolt-pattern")
	}
}
