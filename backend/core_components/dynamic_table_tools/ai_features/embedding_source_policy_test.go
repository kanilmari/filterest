// embedding_source_policy_test.go
// Verifies the fail-closed outbound field boundary, content-free queue payload, and stale-result guards.
// Bridges policy composition, provider calls, queue persistence, and metadata-only diagnostics.
// Exists to keep disallowed customer content out of providers, logs, and durable job rows.
package ai_features

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"log"
	"strings"
	"testing"
	"time"
)

const embeddingSecretSentinel = "SECRET_SENTINEL_customer_private_value"

func TestComposeAuthorizedEmbeddingSourceOmitsDisallowedField(t *testing.T) {
	columns := []ExternalEmbeddingSourceColumn{
		{ColumnUID: 10, ColumnName: "public_title", Allowed: true},
		{ColumnUID: 11, ColumnName: "private_note", Allowed: false},
		{ColumnUID: 12, ColumnName: "translations", IsMultilingual: true, Allowed: true},
	}
	source := ComposeAuthorizedEmbeddingSource(columns, map[string]interface{}{
		"public_title": "Public service",
		"private_note": embeddingSecretSentinel,
		"translations": `{"en":"English description","fi":"Suomenkielinen kuvaus"}`,
	})

	for label, value := range map[string]string{
		"general": source.General,
		"en":      source.ByLanguage["en"],
		"fi":      source.ByLanguage["fi"],
	} {
		if strings.Contains(value, embeddingSecretSentinel) {
			t.Fatalf("%s source exposed disallowed field: %q", label, value)
		}
	}
	if !strings.Contains(source.General, "Public service") || !strings.Contains(source.General, "English description") {
		t.Fatalf("general source omitted allowed content: %q", source.General)
	}
}

func TestGenerateEmbeddingVectorSetNeverReceivesDisallowedSentinel(t *testing.T) {
	source := ComposeAuthorizedEmbeddingSource(
		[]ExternalEmbeddingSourceColumn{{ColumnUID: 1, ColumnName: "summary", Allowed: true}},
		map[string]interface{}{
			"summary":      "approved public summary",
			"private_note": embeddingSecretSentinel,
		},
	)
	providerCalls := 0
	provider := func(_ context.Context, input string) ([]float32, error) {
		providerCalls++
		if strings.Contains(input, embeddingSecretSentinel) {
			t.Fatalf("provider received disallowed sentinel: %q", input)
		}
		return []float32{0.1, 0.2}, nil
	}
	if _, err := generateEmbeddingVectorSet(
		context.Background(),
		source,
		embeddingCapabilities{General: true, Multilingual: true},
		provider,
	); err != nil {
		t.Fatalf("generateEmbeddingVectorSet returned error: %v", err)
	}
	if providerCalls == 0 {
		t.Fatal("provider was not called for approved content")
	}
}

type captureEmbeddingQueueExec struct {
	query string
	args  []interface{}
	err   error
}

func (capture *captureEmbeddingQueueExec) Exec(query string, args ...interface{}) (sql.Result, error) {
	capture.query = query
	capture.args = append([]interface{}(nil), args...)
	return fixedEmbeddingSQLResult(1), capture.err
}

type fixedEmbeddingSQLResult int64

func (result fixedEmbeddingSQLResult) LastInsertId() (int64, error) { return 0, nil }
func (result fixedEmbeddingSQLResult) RowsAffected() (int64, error) { return int64(result), nil }

func TestEmbeddingQueuePayloadContainsIdentifiersOnly(t *testing.T) {
	capture := &captureEmbeddingQueueExec{}
	if err := enqueueEmbeddingRefreshJob(capture, 41, 99); err != nil {
		t.Fatalf("enqueueEmbeddingRefreshJob returned error: %v", err)
	}
	if strings.Contains(capture.query, embeddingSecretSentinel) {
		t.Fatal("queue query contained secret sentinel")
	}
	if !strings.Contains(capture.query, "ON CONFLICT (table_uid, row_id)") ||
		!strings.Contains(capture.query, "generation = system_embedding_refresh_jobs.generation + 1") {
		t.Fatalf("queue query is not idempotent/generation-aware: %s", capture.query)
	}
	if len(capture.args) != 2 || capture.args[0] != int64(41) || capture.args[1] != int64(99) {
		t.Fatalf("queue args = %#v, want table and row identifiers only", capture.args)
	}
	for _, argument := range capture.args {
		if text, ok := argument.(string); ok && strings.Contains(text, embeddingSecretSentinel) {
			t.Fatalf("queue argument exposed secret sentinel: %q", text)
		}
	}
}

func TestEmbeddingSourceFieldsChangedRequiresAllowedIntersection(t *testing.T) {
	columns := []ExternalEmbeddingSourceColumn{
		{ColumnName: "description", Allowed: true},
		{ColumnName: "private_note", Allowed: false},
	}
	if !embeddingSourceFieldsChanged(columns, []string{"updated", "description"}) {
		t.Fatal("allowed changed field did not schedule refresh")
	}
	if embeddingSourceFieldsChanged(columns, []string{"updated", "private_note"}) {
		t.Fatal("disallowed changed field scheduled refresh")
	}
}

func TestEmbeddingQueuePropagatesPersistenceFailure(t *testing.T) {
	capture := &captureEmbeddingQueueExec{err: errors.New("queue unavailable")}
	if err := enqueueEmbeddingRefreshJob(capture, 1, 2); err == nil {
		t.Fatal("expected queue persistence error")
	}
}

func TestValidateExternalEmbeddingColumnUIDsRejectsUnknownAndSorts(t *testing.T) {
	columns := []ExternalEmbeddingSourceColumn{
		{ColumnUID: 3, ColumnName: "description"},
		{ColumnUID: 7, ColumnName: "header"},
	}
	got, err := validateExternalEmbeddingColumnUIDs(columns, []int64{7, 3, 7})
	if err != nil {
		t.Fatalf("validate returned error: %v", err)
	}
	if len(got) != 2 || got[0] != 3 || got[1] != 7 {
		t.Fatalf("validated UIDs = %#v, want [3 7]", got)
	}
	if _, err := validateExternalEmbeddingColumnUIDs(columns, []int64{99}); err == nil {
		t.Fatal("unknown column UID was accepted")
	}
}

func TestEffectiveExternalEmbeddingSourceColumnsUsesTableSwitchAndFirstUseDefaults(t *testing.T) {
	columns := []ExternalEmbeddingSourceColumn{
		{ColumnUID: 3, ColumnName: "description", Allowed: false},
		{ColumnUID: 7, ColumnName: "header", Allowed: true},
	}

	if got := effectiveExternalEmbeddingSourceColumns(false, false, columns); len(got) != 0 {
		t.Fatalf("disabled dataset exposed %d fields", len(got))
	}
	firstUse := effectiveExternalEmbeddingSourceColumns(true, false, columns)
	if len(firstUse) != 2 || !firstUse[0].Allowed || !firstUse[1].Allowed {
		t.Fatalf("first-use fields = %#v, want every eligible field allowed", firstUse)
	}
	explicit := effectiveExternalEmbeddingSourceColumns(true, true, columns)
	if len(explicit) != 1 || explicit[0].ColumnUID != 7 {
		t.Fatalf("configured fields = %#v, want only explicit UID 7", explicit)
	}
	if columns[0].Allowed {
		t.Fatal("policy helper mutated source metadata")
	}
}

func TestEmbeddingRefreshResultRejectsStaleGenerationFingerprintOrLease(t *testing.T) {
	capabilities := embeddingCapabilities{General: true, Multilingual: true}
	if !embeddingRefreshResultIsCurrent(2, 2, "lease", "lease", "hash", "hash", capabilities, capabilities) {
		t.Fatal("current result was rejected")
	}
	tests := []struct {
		name              string
		claimedGeneration int64
		currentGeneration int64
		claimedLease      string
		currentLease      string
		claimedHash       string
		currentHash       string
	}{
		{name: "generation", claimedGeneration: 2, currentGeneration: 3, claimedLease: "lease", currentLease: "lease", claimedHash: "hash", currentHash: "hash"},
		{name: "lease", claimedGeneration: 2, currentGeneration: 2, claimedLease: "old", currentLease: "new", claimedHash: "hash", currentHash: "hash"},
		{name: "fingerprint", claimedGeneration: 2, currentGeneration: 2, claimedLease: "lease", currentLease: "lease", claimedHash: "old", currentHash: "new"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if embeddingRefreshResultIsCurrent(
				test.claimedGeneration,
				test.currentGeneration,
				test.claimedLease,
				test.currentLease,
				test.claimedHash,
				test.currentHash,
				capabilities,
				capabilities,
			) {
				t.Fatal("stale result was accepted")
			}
		})
	}
}

func TestEmbeddingRetryDelayIsBounded(t *testing.T) {
	if got := embeddingRetryDelay(1); got != 5*time.Second {
		t.Fatalf("first retry delay = %s, want 5s", got)
	}
	if got := embeddingRetryDelay(99); got != 640*time.Second {
		t.Fatalf("capped retry delay = %s, want 10m40s", got)
	}
}

func TestEmbeddingRefreshFailureLogOmitsTableNameAndContent(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	})

	logEmbeddingRefreshFailure(embeddingRefreshJob{
		ID:         8,
		TableUID:   4,
		TableName:  embeddingSecretSentinel,
		RowID:      22,
		Generation: 3,
	}, "provider_error")
	logged := output.String()
	if strings.Contains(logged, embeddingSecretSentinel) {
		t.Fatalf("worker log exposed secret sentinel: %q", logged)
	}
	if !strings.Contains(logged, "job_id=8") || !strings.Contains(logged, "code=provider_error") {
		t.Fatalf("worker log omitted safe diagnostics: %q", logged)
	}
}
