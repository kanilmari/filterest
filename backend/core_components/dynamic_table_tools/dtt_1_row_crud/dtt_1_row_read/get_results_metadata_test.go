package dtt_1_row_read

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
		{name: "unknown fallback", input: "floating", want: "conditional_multiline"},
		{name: "empty fallback", input: "", want: "conditional_multiline"},
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
		{name: "modern", input: "modern", want: "modern"},
		{name: "standard", input: "standard", want: "standard"},
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

func TestResolveOwnerColumnFromMetadataPrefersExplicitColumn(t *testing.T) {
	columns := map[string]bool{
		"created_by": true,
		"user_id":    true,
	}

	got := resolveOwnerColumnFromMetadata("user_id", columns)
	if got.Column != "user_id" {
		t.Fatalf("owner column = %q, want user_id", got.Column)
	}
	if got.Source != ownerColumnSourceExplicitMetadata {
		t.Fatalf("owner source = %q, want %q", got.Source, ownerColumnSourceExplicitMetadata)
	}
}

func TestResolveOwnerColumnWithLegacyShadowRecordsExplicitDivergence(t *testing.T) {
	columns := map[string]bool{
		"created_by": true,
		"user_id":    true,
	}

	got := resolveOwnerColumnWithLegacyShadow("user_id", columns)
	if got.Column != "user_id" {
		t.Fatalf("owner column = %q, want user_id", got.Column)
	}
	if got.LegacyFallbackColumn != "created_by" {
		t.Fatalf("legacy shadow owner = %q, want created_by", got.LegacyFallbackColumn)
	}
	if got.MatchesLegacyFallback {
		t.Fatalf("expected explicit user_id to diverge from legacy created_by")
	}
	if !got.ComparedWithLegacyFallback {
		t.Fatalf("expected legacy comparison to be marked")
	}
}

func TestResolveOwnerColumnWithLegacyShadowMatchesFallbackWhenExplicitInvalid(t *testing.T) {
	columns := map[string]bool{
		"created_by": true,
		"user_id":    true,
	}

	got := resolveOwnerColumnWithLegacyShadow("missing_owner", columns)
	if got.Column != "created_by" {
		t.Fatalf("owner column = %q, want created_by", got.Column)
	}
	if got.LegacyFallbackColumn != "created_by" {
		t.Fatalf("legacy shadow owner = %q, want created_by", got.LegacyFallbackColumn)
	}
	if !got.MatchesLegacyFallback {
		t.Fatalf("expected invalid explicit metadata to match legacy fallback")
	}
}

func TestResolveOwnerColumnFromMetadataFallsBackWhenExplicitColumnMissing(t *testing.T) {
	columns := map[string]bool{
		"created_by": true,
		"user_id":    true,
		"id":         true,
	}

	got := resolveOwnerColumnFromMetadata("missing_owner", columns)
	if got.Column != "created_by" {
		t.Fatalf("owner column = %q, want created_by", got.Column)
	}
	if got.Source != ownerColumnSourceLegacyFallback {
		t.Fatalf("owner source = %q, want %q", got.Source, ownerColumnSourceLegacyFallback)
	}
}

func TestResolveOwnerColumnFromMetadataKeepsLegacyFallbackOrder(t *testing.T) {
	tests := []struct {
		name    string
		columns map[string]bool
		want    string
	}{
		{name: "created_by first", columns: map[string]bool{"created_by": true, "user_id": true, "id": true}, want: "created_by"},
		{name: "user_id before id", columns: map[string]bool{"user_id": true, "id": true}, want: "user_id"},
		{name: "id compatibility", columns: map[string]bool{"id": true}, want: "id"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveOwnerColumnFromMetadata("", tt.columns)
			if got.Column != tt.want {
				t.Fatalf("owner column = %q, want %q", got.Column, tt.want)
			}
			if got.Source != ownerColumnSourceLegacyFallback {
				t.Fatalf("owner source = %q, want %q", got.Source, ownerColumnSourceLegacyFallback)
			}
		})
	}
}
