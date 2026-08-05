// logging.go
// Provides centralized logging utilities for the Easelect backend.
// Bridges Easelect call sites and the standard library logger into structured slog output.
// Exists to provide machine-parsable levels/fields while still capturing legacy log.Printf usage.

package logging

import (
	"context"
	"fmt"
	"io"
	"log"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"sync"
	"unicode"
)

var ansiEscapePattern = regexp.MustCompile(`\x1b\[[0-9;]*m`)

var (
	loggerMu      sync.RWMutex
	currentLogger *slog.Logger
)

func init() {
	SetOutput(os.Stderr)
}

type legacyLogWriter struct{}

// SetOutput reconfigures the structured logger destination and keeps the stdlib
// logger bridged into the same handler so legacy log.Printf output stays structured.
func SetOutput(output io.Writer) {
	if output == nil {
		output = io.Discard
	}

	handler := newHandler(output)
	logger := slog.New(handler)

	loggerMu.Lock()
	currentLogger = logger
	loggerMu.Unlock()

	slog.SetDefault(logger)
	log.SetFlags(0)
	log.SetOutput(legacyLogWriter{})
}

func newHandler(output io.Writer) slog.Handler {
	options := &slog.HandlerOptions{
		Level: parseConfiguredLevel(os.Getenv("LOG_LEVEL")),
	}

	if strings.EqualFold(os.Getenv("LOG_FORMAT"), "json") {
		return slog.NewJSONHandler(output, options)
	}

	return slog.NewTextHandler(output, options)
}

func parseConfiguredLevel(raw string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func getLogger() *slog.Logger {
	loggerMu.RLock()
	logger := currentLogger
	loggerMu.RUnlock()
	if logger != nil {
		return logger
	}

	SetOutput(os.Stderr)

	loggerMu.RLock()
	defer loggerMu.RUnlock()
	return currentLogger
}

func logMessage(level slog.Level, message string) {
	getLogger().LogAttrs(context.Background(), level, message)
}

func logAttrs(level slog.Level, message string, attrs ...slog.Attr) {
	getLogger().LogAttrs(context.Background(), level, message, attrs...)
}

func inferLegacyLevel(message string) slog.Level {
	lower := strings.ToLower(message)

	switch {
	case strings.Contains(lower, "fatal"),
		strings.Contains(lower, "panic"),
		strings.Contains(lower, "error"),
		strings.Contains(message, "❌"):
		return slog.LevelError
	case strings.Contains(lower, "warning"),
		strings.Contains(lower, "warn"),
		strings.Contains(message, "⚠"):
		return slog.LevelWarn
	case strings.Contains(lower, "debug"):
		return slog.LevelDebug
	default:
		return slog.LevelInfo
	}
}

func stripANSI(message string) string {
	return ansiEscapePattern.ReplaceAllString(message, "")
}

func (legacyLogWriter) Write(p []byte) (int, error) {
	message := strings.TrimSpace(stripANSI(string(p)))
	if message == "" {
		return len(p), nil
	}

	logAttrs(
		inferLegacyLevel(message),
		message,
		slog.Bool("legacy", true),
	)
	return len(p), nil
}

// Errorf logs an error-level message and enforces lowercase-first formatting.
func Errorf(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)

	// Enforce lowercase start
	runes := []rune(msg)
	if len(runes) > 0 && unicode.IsUpper(runes[0]) {
		runes[0] = unicode.ToLower(runes[0])
		msg = string(runes)
	}

	logMessage(slog.LevelError, msg)
}

// Warnf logs a warning-level message.
func Warnf(format string, v ...interface{}) {
	logMessage(slog.LevelWarn, fmt.Sprintf(format, v...))
}

// Infof logs an informational message.
func Infof(format string, v ...interface{}) {
	logMessage(slog.LevelInfo, fmt.Sprintf(format, v...))
}

// Debugf logs a debug-level message.
func Debugf(format string, v ...interface{}) {
	logMessage(slog.LevelDebug, fmt.Sprintf(format, v...))
}

// ErrorAttrs logs an error message with machine-parsable structured fields.
func ErrorAttrs(message string, attrs ...slog.Attr) {
	logAttrs(slog.LevelError, normalizeErrorMessage(message), attrs...)
}

// WarnAttrs logs a warning message with machine-parsable structured fields.
func WarnAttrs(message string, attrs ...slog.Attr) {
	logAttrs(slog.LevelWarn, message, attrs...)
}

// InfoAttrs logs an informational message with machine-parsable structured fields.
func InfoAttrs(message string, attrs ...slog.Attr) {
	logAttrs(slog.LevelInfo, message, attrs...)
}

// DebugAttrs logs a debug message with machine-parsable structured fields.
func DebugAttrs(message string, attrs ...slog.Attr) {
	logAttrs(slog.LevelDebug, message, attrs...)
}

func normalizeErrorMessage(message string) string {
	runes := []rune(message)
	if len(runes) == 0 {
		return message
	}

	if unicode.IsUpper(runes[0]) {
		runes[0] = unicode.ToLower(runes[0])
		return string(runes)
	}

	return message
}
