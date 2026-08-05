package security

import "testing"

func TestSanitizeIdentifier(t *testing.T) {
	tests := []struct {
		name        string
		identifier  string
		want        string
		wantErrPart string
	}{
		{
			name:       "accepts simple identifier",
			identifier: "valid_identifier_2",
			want:       "valid_identifier_2",
		},
		{
			name:        "rejects leading digit",
			identifier:  "1table",
			wantErrPart: "invalid identifier",
		},
		{
			name:        "rejects hyphen",
			identifier:  "bad-name",
			wantErrPart: "invalid identifier",
		},
		{
			name:        "rejects whitespace",
			identifier:  "bad name",
			wantErrPart: "invalid identifier",
		},
		{
			name:        "rejects nordic characters",
			identifier:  "käyttäjät",
			wantErrPart: "nordic characters not allowed",
		},
		{
			name:        "rejects empty string",
			identifier:  "",
			wantErrPart: "invalid identifier",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := SanitizeIdentifier(tt.identifier)
			if tt.wantErrPart == "" {
				if err != nil {
					t.Fatalf("SanitizeIdentifier(%q) returned unexpected error: %v", tt.identifier, err)
				}
				if got != tt.want {
					t.Fatalf("SanitizeIdentifier(%q) = %q, want %q", tt.identifier, got, tt.want)
				}
				return
			}

			if err == nil {
				t.Fatalf("SanitizeIdentifier(%q) returned nil error, want containing %q", tt.identifier, tt.wantErrPart)
			}
			if got != "" {
				t.Fatalf("SanitizeIdentifier(%q) = %q on error, want empty string", tt.identifier, got)
			}
			if err != nil && !contains(err.Error(), tt.wantErrPart) {
				t.Fatalf("SanitizeIdentifier(%q) error = %q, want containing %q", tt.identifier, err.Error(), tt.wantErrPart)
			}
		})
	}
}

func contains(haystack, needle string) bool {
	return len(needle) == 0 || (len(haystack) >= len(needle) && stringIndex(haystack, needle) >= 0)
}

func stringIndex(s, sep string) int {
	for i := 0; i+len(sep) <= len(s); i++ {
		if s[i:i+len(sep)] == sep {
			return i
		}
	}
	return -1
}
