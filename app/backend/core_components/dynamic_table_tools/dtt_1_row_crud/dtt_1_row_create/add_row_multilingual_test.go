// add_row_multilingual_test.go
// Verifies add-row payloads honor multilingual column metadata and active languages.
// Bridges untrusted scalar/JSON inputs with the canonical serialized storage contract.
// Exists to prevent new legacy scalar rows and incomplete language maps.

package dtt_1_row_create

import (
	"database/sql"
	"errors"
	"strings"
	"testing"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func multilingualTestColumn(nullable string) dtt_models.AddRowColumnInfo {
	return dtt_models.AddRowColumnInfo{
		ColumnName:     "title",
		DataType:       "text",
		IsNullable:     nullable,
		IsMultilingual: true,
		MultilingualLanguages: []dtt_models.AddRowLanguageInfo{
			{LanguageCode: "fi", NativeName: "Suomi", IsDefault: true},
			{LanguageCode: "en", NativeName: "English"},
		},
	}
}

func TestNormalizeMultilingualCreatePayloadRejectsScalar(t *testing.T) {
	payload := map[string]interface{}{"title": "Vain suomeksi"}

	err := normalizeMultilingualCreatePayload(payload, []dtt_models.AddRowColumnInfo{
		multilingualTestColumn("NO"),
	})

	if !errors.Is(err, errInvalidMultilingualCreateValue) {
		t.Fatalf("error = %v, want multilingual validation error", err)
	}
}

func TestNormalizeMultilingualCreatePayloadRequiresEveryActiveLanguage(t *testing.T) {
	payload := map[string]interface{}{"title": `{"fi":"Suomeksi","en":""}`}

	err := normalizeMultilingualCreatePayload(payload, []dtt_models.AddRowColumnInfo{
		multilingualTestColumn("YES"),
	})

	if err == nil || !strings.Contains(err.Error(), "missing language en") {
		t.Fatalf("error = %v, want missing English error", err)
	}
}

func TestNormalizeMultilingualCreatePayloadSerializesCompleteMap(t *testing.T) {
	payload := map[string]interface{}{
		"title": map[string]interface{}{
			"fi": "Suomeksi",
			"en": "In English",
		},
	}

	err := normalizeMultilingualCreatePayload(payload, []dtt_models.AddRowColumnInfo{
		multilingualTestColumn("NO"),
	})

	if err != nil {
		t.Fatalf("normalize error = %v", err)
	}
	stored, ok := payload["title"].(string)
	if !ok || !strings.Contains(stored, `"fi":"Suomeksi"`) || !strings.Contains(stored, `"en":"In English"`) {
		t.Fatalf("stored value = %#v, want serialized language map", payload["title"])
	}
}

func TestNormalizeMultilingualCreatePayloadRejectsUnknownLanguage(t *testing.T) {
	payload := map[string]interface{}{
		"title": map[string]interface{}{
			"fi": "Suomeksi",
			"en": "In English",
			"sv": "På svenska",
		},
	}

	err := normalizeMultilingualCreatePayload(payload, []dtt_models.AddRowColumnInfo{
		multilingualTestColumn("NO"),
	})

	if err == nil || !strings.Contains(err.Error(), "unknown language sv") {
		t.Fatalf("error = %v, want unknown language error", err)
	}
}

func TestNormalizeMultilingualCreatePayloadAllowsEntirelyEmptyNullableField(t *testing.T) {
	payload := map[string]interface{}{"title": ""}

	err := normalizeMultilingualCreatePayload(payload, []dtt_models.AddRowColumnInfo{
		multilingualTestColumn("YES"),
	})

	if err != nil {
		t.Fatalf("normalize error = %v", err)
	}
	if payload["title"] != nil {
		t.Fatalf("nullable empty value = %#v, want nil", payload["title"])
	}
}

func TestNormalizeMultilingualCreatePayloadRejectsMissingLanguageRegistry(t *testing.T) {
	column := multilingualTestColumn("NO")
	column.MultilingualLanguages = nil

	err := normalizeMultilingualCreatePayload(
		map[string]interface{}{"title": `{"fi":"Suomeksi","en":"In English"}`},
		[]dtt_models.AddRowColumnInfo{column},
	)

	if err == nil || !strings.Contains(err.Error(), "no active languages configured") {
		t.Fatalf("error = %v, want missing registry error", err)
	}
}

func TestNormalizeMultilingualCreatePayloadRejectsUnsupportedColumnType(t *testing.T) {
	column := multilingualTestColumn("NO")
	column.DataType = "integer"

	err := normalizeMultilingualCreatePayload(
		map[string]interface{}{"title": `{"fi":"1","en":"1"}`},
		[]dtt_models.AddRowColumnInfo{column},
	)

	if err == nil || !strings.Contains(err.Error(), "unsupported data type integer") {
		t.Fatalf("error = %v, want unsupported type error", err)
	}
}

func TestNormalizeMultilingualCreatePayloadSkipsAbsentServerOwnedField(t *testing.T) {
	column := multilingualTestColumn("NO")
	column.Insertable = sql.NullBool{Bool: false, Valid: true}

	err := normalizeMultilingualCreatePayload(
		map[string]interface{}{},
		[]dtt_models.AddRowColumnInfo{column},
	)

	if err != nil {
		t.Fatalf("server-owned missing field error = %v", err)
	}
}
