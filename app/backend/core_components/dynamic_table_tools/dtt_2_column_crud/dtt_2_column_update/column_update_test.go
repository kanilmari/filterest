// column_update_test.go
// Unit tests for column renaming, type changes, actor protection, and nilIfEmpty.
// Between UpdateColumns and the shared database/sql driver double.
// Verifies column changes and refusals without a live PostgreSQL instance.
package dtt_2_column_update

import (
	"database/sql"
	"database/sql/driver"
	dtt_2_column_crud "easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	"easelect/backend/core_components/httpresponse"
	"errors"
	"strings"
	"testing"
)

func TestNilIfEmptyReturnsPointerForValidString(t *testing.T) {
	result := nilIfEmpty(sql.NullString{String: "text", Valid: true})
	if result == nil || *result != "text" {
		t.Fatalf("nilIfEmpty(Valid) = %v, want pointer to \"text\"", result)
	}
}

func TestNilIfEmptyReturnsNilForInvalidString(t *testing.T) {
	result := nilIfEmpty(sql.NullString{Valid: false})
	if result != nil {
		t.Fatalf("nilIfEmpty(Invalid) = %v, want nil", result)
	}
}

func TestUpdateColumnsReturnsNilForEmptySlice(t *testing.T) {
	_, tx, _ := openColUpdateTx(t, nil, nil)

	err := UpdateColumns(tx, "users", nil, goodSanitize)
	if err != nil {
		t.Fatalf("UpdateColumns returned error for empty slice: %v", err)
	}
}

func TestUpdateColumnsRejectsInvalidOriginalName(t *testing.T) {
	_, tx, state := openColUpdateTx(t, nil, nil)

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "bad-orig", NewName: "new_col", DataType: "text"},
	}, rejectBadNames)
	if err == nil || !strings.Contains(err.Error(), "invalid identifier: bad-orig") {
		t.Fatalf("err = %v, want invalid identifier error for original name", err)
	}
	if len(state.execCalls) != 0 {
		t.Fatalf("exec calls = %d, want 0", len(state.execCalls))
	}
}

func TestUpdateColumnsRejectsInvalidNewName(t *testing.T) {
	_, tx, state := openColUpdateTx(t, nil, nil)

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "ok_orig", NewName: "bad-new", DataType: "text"},
	}, rejectBadNames)
	if err == nil || !strings.Contains(err.Error(), "invalid identifier: bad-new") {
		t.Fatalf("err = %v, want invalid identifier error for new name", err)
	}
	if len(state.execCalls) != 0 {
		t.Fatalf("exec calls = %d, want 0", len(state.execCalls))
	}
}

func TestUpdateColumnsRenameAndTypeChangeHappyPath(t *testing.T) {
	// Rename: ALTER TABLE RENAME COLUMN → exec 1
	// Lang source_low update → exec 2
	// Lang column_value source_high update → exec 3
	// Lang usage_explanation update → exec 4
	// Lang column_value usage_explanation update → exec 5
	// Type change: ALTER TABLE ALTER COLUMN TYPE → exec 6
	_, tx, state := openColUpdateTx(t,
		[]queuedQuery{currentTypeQuery("text")},
		[]queuedExec{{}, {}, {}, {}, {}, {}})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "old_col", NewName: "new_col", DataType: "text"},
	}, goodSanitize)
	if err != nil {
		t.Fatalf("UpdateColumns returned error: %v", err)
	}

	if len(state.execCalls) != 6 {
		t.Fatalf("exec calls = %d, want 6", len(state.execCalls))
	}
	if got := state.execCalls[0]; got != "ALTER TABLE users RENAME COLUMN old_col TO new_col" {
		t.Fatalf("exec[0] = %q, want RENAME statement", got)
	}
	if got := state.execCalls[5]; got != "ALTER TABLE users ALTER COLUMN new_col TYPE TEXT" {
		t.Fatalf("exec[5] = %q, want ALTER TYPE statement", got)
	}
}

func TestUpdateColumnsSameNameTypeOnly(t *testing.T) {
	_, tx, state := openColUpdateTx(t,
		[]queuedQuery{currentTypeQuery("text")}, []queuedExec{{}})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "col", NewName: "col", DataType: "boolean"},
	}, goodSanitize)
	if err != nil {
		t.Fatalf("UpdateColumns returned error: %v", err)
	}

	if len(state.execCalls) != 1 {
		t.Fatalf("exec calls = %d, want 1", len(state.execCalls))
	}
	if got := state.execCalls[0]; got != "ALTER TABLE users ALTER COLUMN col TYPE BOOLEAN" {
		t.Fatalf("exec[0] = %q, want BOOLEAN type change", got)
	}
}

func TestUpdateColumnsVarcharWithLength(t *testing.T) {
	length := 255
	_, tx, state := openColUpdateTx(t,
		[]queuedQuery{currentTypeQuery("text")}, []queuedExec{{}})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "col", NewName: "col", DataType: "varchar", Length: &length},
	}, goodSanitize)
	if err != nil {
		t.Fatalf("UpdateColumns returned error: %v", err)
	}

	if len(state.execCalls) != 1 {
		t.Fatalf("exec calls = %d, want 1", len(state.execCalls))
	}
	if got := state.execCalls[0]; got != "ALTER TABLE users ALTER COLUMN col TYPE VARCHAR(255)" {
		t.Fatalf("exec[0] = %q, want VARCHAR(255) type change", got)
	}
}

func TestUpdateColumnsConvertsJSONColumnToNumeric(t *testing.T) {
	// A stored JSON value has no automatic conversion into a number, so the
	// statement reads it out as text before the cast.
	_, tx, state := openColUpdateTx(t,
		[]queuedQuery{currentTypeQuery("jsonb")}, []queuedExec{{}})

	err := UpdateColumns(tx, "subscriptions", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "price", NewName: "price", DataType: "NUMERIC(18,2)"},
	}, goodSanitize)
	if err != nil {
		t.Fatalf("UpdateColumns returned error: %v", err)
	}

	want := "ALTER TABLE subscriptions ALTER COLUMN price TYPE NUMERIC(18,2) " +
		"USING NULLIF(price #>> '{}', '')::NUMERIC(18,2)"
	if got := state.execCalls[0]; got != want {
		t.Fatalf("exec[0] = %q, want %q", got, want)
	}
}

func TestUpdateColumnsKeepsPlainStatementForJSONTarget(t *testing.T) {
	// JSON to JSON needs no conversion clause, and neither does any pair of
	// types PostgreSQL already converts on its own.
	_, tx, state := openColUpdateTx(t,
		[]queuedQuery{currentTypeQuery("json")}, []queuedExec{{}})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "settings", NewName: "settings", DataType: "jsonb"},
	}, goodSanitize)
	if err != nil {
		t.Fatalf("UpdateColumns returned error: %v", err)
	}

	if got := state.execCalls[0]; got != "ALTER TABLE users ALTER COLUMN settings TYPE JSONB" {
		t.Fatalf("exec[0] = %q, want a statement without a conversion clause", got)
	}
}

func TestUpdateColumnsPropagatesRenameExecError(t *testing.T) {
	wantErr := errors.New("rename boom")
	_, tx, _ := openColUpdateTx(t, nil, []queuedExec{{err: wantErr}})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "old_col", NewName: "new_col", DataType: "text"},
	}, goodSanitize)
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want %v", err, wantErr)
	}
}

func TestUpdateColumnsPropagatesTypeChangeExecError(t *testing.T) {
	wantErr := errors.New("type boom")
	_, tx, _ := openColUpdateTx(t,
		[]queuedQuery{currentTypeQuery("text")}, []queuedExec{{err: wantErr}})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "col", NewName: "col", DataType: "text"},
	}, goodSanitize)
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want %v", err, wantErr)
	}
}

func TestUpdateColumnsIgnoresLangCleanupFailure(t *testing.T) {
	// Rename exec succeeds, lang 1st exec fails → non-fatal, type exec succeeds
	_, tx, state := openColUpdateTx(t, []queuedQuery{currentTypeQuery("text")}, []queuedExec{
		{},                                    // ALTER RENAME
		{err: errors.New("lang source boom")}, // lang source_low update fails → non-fatal
		{},                                    // ALTER TYPE
	})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "old_col", NewName: "new_col", DataType: "text"},
	}, goodSanitize)
	if err != nil {
		t.Fatalf("UpdateColumns returned error: %v", err)
	}

	if len(state.execCalls) != 3 {
		t.Fatalf("exec calls = %d, want 3 (rename + failed lang + type)", len(state.execCalls))
	}
}

func TestActorColumnChangesRefusedBeforeAnyAlter(t *testing.T) {
	for _, tc := range []struct{ name, typ string }{{"renamed", "bigint"}, {"created_by", "text"}} {
		_, tx, state := openColUpdateTx(t, []queuedQuery{currentTypeQuery("bigint")}, nil)
		state.actorRows = [][]driver.Value{{"created_by", "creator"}, {"user_id", "owner"}}
		err := UpdateColumns(tx, "notes", []dtt_2_column_crud.ModifiedCol{{OriginalName: "ordinary", NewName: "renamed_ordinary", DataType: "text"}, {OriginalName: "created_by", NewName: tc.name, DataType: tc.typ}}, func(s string) (string, error) { return s, nil })
		var refusal *httpresponse.Refusal
		if !errors.As(err, &refusal) || refusal.Status != 400 || refusal.LangKey != "error_owner_column_protected" {
			t.Fatalf("%+v: %v", tc, err)
		}
		if len(state.execCalls) != 0 {
			t.Fatal("actor refusal changed an earlier column")
		}
	}
	_, tx, state := openColUpdateTx(t, []queuedQuery{currentTypeQuery("bigint")}, nil)
	state.actorRows = [][]driver.Value{{"created_by", "creator"}}
	if err := UpdateColumns(tx, "notes", []dtt_2_column_crud.ModifiedCol{{OriginalName: "created_by", NewName: "created_by", DataType: "BIGINT"}}, func(s string) (string, error) { return s, nil }); err != nil {
		t.Fatal(err)
	}
	if len(state.execCalls) != 0 {
		t.Fatal("a no-op rewrote actor constraints")
	}
}
