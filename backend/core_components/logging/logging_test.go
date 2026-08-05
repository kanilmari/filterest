package logging

import (
	"bytes"
	"log"
	"log/slog"
	"os"
	"strings"
	"testing"
)

func captureStructuredLog(t *testing.T, fn func()) string {
	t.Helper()
	var buf bytes.Buffer
	SetOutput(&buf)
	t.Cleanup(func() {
		SetOutput(os.Stderr)
	})
	fn()
	return buf.String()
}

func TestErrorf_UppercaseEnforcement(t *testing.T) {
	out := captureStructuredLog(t, func() {
		Errorf("Something %s", "bad")
	})
	if !strings.Contains(out, "level=ERROR") {
		t.Fatalf("expected structured error level, got: %q", out)
	}
	if !strings.Contains(out, `msg="something bad"`) {
		t.Fatalf("expected lowercase message, got: %q", out)
	}
}

func TestErrorf_AlreadyLowercase(t *testing.T) {
	out := captureStructuredLog(t, func() {
		Errorf("something %s", "fine")
	})
	if !strings.Contains(out, `msg="something fine"`) {
		t.Fatalf("expected unchanged lowercase message, got: %q", out)
	}
}

func TestErrorf_EmptyString(t *testing.T) {
	// Should not panic
	captureStructuredLog(t, func() {
		Errorf("")
	})
}

func TestWarnAttrs_IncludeStructuredFields(t *testing.T) {
	out := captureStructuredLog(t, func() {
		WarnAttrs("queue pressure", slog.String("handler", "Audit"), slog.Int("dropped", 2))
	})
	if !strings.Contains(out, "level=WARN") {
		t.Fatalf("expected warn level, got: %q", out)
	}
	if !strings.Contains(out, "handler=Audit") {
		t.Fatalf("expected handler field, got: %q", out)
	}
	if !strings.Contains(out, "dropped=2") {
		t.Fatalf("expected dropped field, got: %q", out)
	}
}

func TestInfof_Passthrough(t *testing.T) {
	out := captureStructuredLog(t, func() {
		Infof("hello %s", "world")
	})
	if !strings.Contains(out, "level=INFO") {
		t.Fatalf("expected info level, got: %q", out)
	}
	if !strings.Contains(out, `msg="hello world"`) {
		t.Fatalf("expected passthrough message, got: %q", out)
	}
}

func TestLegacyStandardLoggerIsBridgedIntoStructuredOutput(t *testing.T) {
	out := captureStructuredLog(t, func() {
		log.Printf("\033[31merror: legacy path failed\033[0m")
	})
	if !strings.Contains(out, "level=ERROR") {
		t.Fatalf("expected bridged error level, got: %q", out)
	}
	if !strings.Contains(out, `msg="error: legacy path failed"`) {
		t.Fatalf("expected ANSI-stripped legacy message, got: %q", out)
	}
	if !strings.Contains(out, "legacy=true") {
		t.Fatalf("expected legacy marker, got: %q", out)
	}
}

func TestLegacyStandardLoggerWarnPrefixIsBridgedToWarn(t *testing.T) {
	out := captureStructuredLog(t, func() {
		log.Printf("[WARN] queue pressure")
	})
	if !strings.Contains(out, "level=WARN") {
		t.Fatalf("expected bridged warn level, got: %q", out)
	}
	if !strings.Contains(out, `msg="[WARN] queue pressure"`) {
		t.Fatalf("expected bridged warn message, got: %q", out)
	}
}

func TestSetOutput_UsesJSONWhenConfigured(t *testing.T) {
	t.Setenv("LOG_FORMAT", "json")

	out := captureStructuredLog(t, func() {
		InfoAttrs("structured info", slog.String("path", "/api/test"))
	})
	if !strings.Contains(out, `"level":"INFO"`) {
		t.Fatalf("expected JSON info level, got: %q", out)
	}
	if !strings.Contains(out, `"msg":"structured info"`) {
		t.Fatalf("expected JSON message, got: %q", out)
	}
	if !strings.Contains(out, `"path":"/api/test"`) {
		t.Fatalf("expected JSON path field, got: %q", out)
	}
}

func TestSetOutput_HonorsConfiguredLogLevel(t *testing.T) {
	t.Setenv("LOG_LEVEL", "error")

	out := captureStructuredLog(t, func() {
		Infof("hidden message")
		Errorf("Visible message")
	})
	if strings.Contains(out, "hidden message") {
		t.Fatalf("expected info message to be filtered, got: %q", out)
	}
	if !strings.Contains(out, `msg="visible message"`) {
		t.Fatalf("expected error message to remain visible, got: %q", out)
	}
}
