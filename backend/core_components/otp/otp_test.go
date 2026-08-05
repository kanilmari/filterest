// otp_test.go
// Unit tests for the otp package.
// Covers the three pure functions (GenerateCode, FormatCode, HashCode) exhaustively.
// The DB-coupled functions (CreateOTP, VerifyOTP, etc.) are not tested here because they depend on backend.DbConfidential.
package otp

import (
	"strings"
	"testing"
	"time"
)

// ── GenerateCode ──────────────────────────────────────────────────────

func TestGenerateCodeLength(t *testing.T) {
	code, err := GenerateCode()
	if err != nil {
		t.Fatalf("GenerateCode() error: %v", err)
	}
	if len(code) != CodeLength {
		t.Fatalf("len = %d, want %d", len(code), CodeLength)
	}
}

func TestGenerateCodeCharset(t *testing.T) {
	code, err := GenerateCode()
	if err != nil {
		t.Fatalf("GenerateCode() error: %v", err)
	}
	for i, ch := range code {
		if !strings.ContainsRune(Charset, ch) {
			t.Fatalf("code[%d] = %c, not in Charset", i, ch)
		}
	}
}

func TestGenerateCodeUniqueness(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 50; i++ {
		code, err := GenerateCode()
		if err != nil {
			t.Fatalf("GenerateCode() error: %v", err)
		}
		if seen[code] {
			t.Fatalf("duplicate code after %d iterations: %s", i, code)
		}
		seen[code] = true
	}
}

// ── FormatCode ────────────────────────────────────────────────────────

func TestFormatCodeNineChars(t *testing.T) {
	got := FormatCode("abcdefghj")
	want := "abc def ghj"
	if got != want {
		t.Fatalf("FormatCode = %q, want %q", got, want)
	}
}

func TestFormatCodeShortPassthrough(t *testing.T) {
	got := FormatCode("abc")
	if got != "abc" {
		t.Fatalf("FormatCode(short) = %q, want %q", got, "abc")
	}
}

func TestFormatCodeLongPassthrough(t *testing.T) {
	got := FormatCode("abcdefghijk")
	if got != "abcdefghijk" {
		t.Fatalf("FormatCode(long) = %q, want %q", got, "abcdefghijk")
	}
}

func TestFormatCodeEmpty(t *testing.T) {
	got := FormatCode("")
	if got != "" {
		t.Fatalf("FormatCode(\"\") = %q, want \"\"", got)
	}
}

// ── HashCode ──────────────────────────────────────────────────────────

func TestHashCodeDeterministic(t *testing.T) {
	h1 := HashCode("abc def ghj")
	h2 := HashCode("abc def ghj")
	if h1 != h2 {
		t.Fatalf("HashCode not deterministic: %s != %s", h1, h2)
	}
}

func TestHashCodeStripsSpaces(t *testing.T) {
	h1 := HashCode("abcdefghj")
	h2 := HashCode("abc def ghj")
	if h1 != h2 {
		t.Fatalf("HashCode should strip spaces: %s != %s", h1, h2)
	}
}

func TestHashCodeCaseInsensitive(t *testing.T) {
	h1 := HashCode("ABCDEFGHJ")
	h2 := HashCode("abcdefghj")
	if h1 != h2 {
		t.Fatalf("HashCode should be case-insensitive: %s != %s", h1, h2)
	}
}

func TestHashCodeHexLength(t *testing.T) {
	h := HashCode("test")
	// SHA-256 hex = 64 chars
	if len(h) != 64 {
		t.Fatalf("HashCode hex len = %d, want 64", len(h))
	}
}

func TestHashCodeDifferentInputs(t *testing.T) {
	h1 := HashCode("abc")
	h2 := HashCode("xyz")
	if h1 == h2 {
		t.Fatal("HashCode should differ for different inputs")
	}
}

// ── Constants ─────────────────────────────────────────────────────────

func TestCharsetNoAmbiguous(t *testing.T) {
	ambiguous := "0OoIi1Ll"
	for _, ch := range ambiguous {
		if strings.ContainsRune(Charset, ch) {
			t.Fatalf("Charset contains ambiguous char %c", ch)
		}
	}
}

func TestCodeLengthNine(t *testing.T) {
	if CodeLength != 9 {
		t.Fatalf("CodeLength = %d, want 9", CodeLength)
	}
}

func TestCoreProfilesOwnSecurityLimits(t *testing.T) {
	for _, name := range []ProfileName{
		ProfileLogin,
		ProfilePasswordReset,
		ProfileEmailChange,
		ProfilePasswordChange,
	} {
		profile, ok := GetProfile(name)
		if !ok {
			t.Fatalf("profile %q not found", name)
		}
		if !profile.CoreEnabled || profile.MaxVerifyAttempts != 5 || profile.UserSendLimit != 3 {
			t.Fatalf("unexpected core security profile %#v", profile)
		}
		if profile.TTL != 5*time.Minute || profile.UserSendWindow != 5*time.Minute {
			t.Fatalf("unexpected core timing profile %#v", profile)
		}
	}
}

func TestRegFetchProfileRequiresItsOwnAdapter(t *testing.T) {
	profile, ok := GetProfile(ProfileRegFetchLogin)
	if !ok {
		t.Fatal("regfetch profile not found")
	}
	if profile.CoreEnabled {
		t.Fatal("regfetch profile must not silently use the core adapter")
	}
	if profile.MinimumSendSpacing != time.Minute || profile.IPSendLimit != 10 {
		t.Fatalf("regfetch-specific limits missing: %#v", profile)
	}
}
