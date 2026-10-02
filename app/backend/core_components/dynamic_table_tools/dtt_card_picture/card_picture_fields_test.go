// card_picture_fields_test.go
// Tests the choice of the picture a row shows from its own picture fields.
// Between the card list's rule and the article's related-rows response, which follows it.
// Exists so the article and the card can never show two different main pictures for one row
// (owner decision K128, alternative (a)).
package dtt_card_picture

import (
	"math"
	"reflect"
	"testing"
)

func TestChooseShownPictureFollowsTheCardList(t *testing.T) {
	withRole := OwnPictureFields{Role: []string{"logo_image"}, Named: []string{"cached_image", "image"}}
	withoutRole := OwnPictureFields{Named: []string{"cached_image", "image"}}
	cases := []struct {
		name   string
		fields OwnPictureFields
		values map[string]string
		want   string
	}{
		{name: "the designer's image field wins", fields: withRole, values: map[string]string{"logo_image": "117_6_6.jpg", "cached_image": "117_6_1.png"}, want: "117_6_6.jpg"},
		{name: "an empty image field leaves it to the gallery rule", fields: withRole, values: map[string]string{"logo_image": " ", "cached_image": "117_6_1.png", "image": "other.png"}, want: "117_6_1.png"},
		{name: "then to the next named field, as the card list falls back", fields: withRole, values: map[string]string{"logo_image": "", "cached_image": "", "image": "other.png"}, want: "other.png"},
		{name: "without an image field the card picture comes first", fields: withoutRole, values: map[string]string{"cached_image": "117_4_1.png", "image": "other.png"}, want: "117_4_1.png"},
		{name: "then the other named fields", fields: withoutRole, values: map[string]string{"cached_image": "", "image": "other.png"}, want: "other.png"},
		{name: "no picture at all", fields: withoutRole, values: map[string]string{}, want: ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := ChooseShownPicture(testCase.fields, testCase.values); got != testCase.want {
				t.Fatalf("ChooseShownPicture = %q, want %q", got, testCase.want)
			}
		})
	}
}

// The article skips what the card list skips: a named field that holds no picture.
func TestChooseShownPictureSkipsANamedFieldThatHoldsNoPicture(t *testing.T) {
	fields := OwnPictureFields{Named: []string{"cached_image", "image", "image_url"}}
	cases := []struct {
		values map[string]string
		want   string
	}{
		{values: map[string]string{"cached_image": "null", "image": "other.png"}, want: "other.png"},
		{values: map[string]string{"image": "ei kuva", "image_url": "photo.png"}, want: "photo.png"},
		{values: map[string]string{"cached_image": `{"fi": "kuva.png", "en": "picture.png"}`}, want: "kuva.png"},
		{values: map[string]string{"cached_image": "plain words"}, want: ""},
	}
	for _, testCase := range cases {
		if got := ChooseShownPicture(fields, testCase.values); got != testCase.want {
			t.Errorf("ChooseShownPicture(%v) = %q, want %q", testCase.values, got, testCase.want)
		}
	}
}

// What LikelyPictureValue answers for a field's text is stated once, for the browser and
// the server alike, in app/testing/shared_contracts/card_picture_candidate_examples.json
// (card_picture_candidate_contract_test.go). Only what that file cannot hold is tested here.

// A number inside an array is joined as JavaScript writes it. The shared examples cover each
// layout; these are its edges and NaN, which JSON never yields. Every expected text is what
// node printed for String() of the same number.
func TestJavaScriptNumberTextWritesWhatJavaScriptWrites(t *testing.T) {
	cases := []struct {
		number float64
		want   string
	}{
		{math.NaN(), "NaN"},
		{-1e-7, "-1e-7"},
		{-0.5e-6, "-5e-7"},
		{999999999999999900000, "999999999999999900000"},
		{123456789012345680000, "123456789012345680000"},
		{0.30000000000000004, "0.30000000000000004"},
		{1.0 / 3, "0.3333333333333333"},
		{9007199254740994, "9007199254740994"},
	}
	for _, testCase := range cases {
		if got := javaScriptNumberText(testCase.number); got != testCase.want {
			t.Errorf("javaScriptNumberText(%v) = %q, JavaScript writes %q", testCase.number, got, testCase.want)
		}
	}
}

// The card hides a "false" in an image-role field set to hide false values, and the next
// picture shows; an image-role field without that setting shows what it holds.
func TestChooseShownPictureSkipsAFalseTheCardHides(t *testing.T) {
	values := map[string]string{"logo_image": "false", "cached_image": "117_6_1.png"}
	hiding := OwnPictureFields{Role: []string{"logo_image"}, Named: []string{"cached_image"}, HidesFalse: map[string]bool{"logo_image": true}}
	if got := ChooseShownPicture(hiding, values); got != "117_6_1.png" {
		t.Fatalf("with the field hiding false: %q, want the next picture", got)
	}
	showing := OwnPictureFields{Role: []string{"logo_image"}, Named: []string{"cached_image"}}
	if got := ChooseShownPicture(showing, values); got != "false" {
		t.Fatalf("without the setting: %q, want what the card shows", got)
	}
}

// The one gallery condition qualifies its columns and asks for an image kind only where
// the relation has one.
func TestPictureConditionQualifiesAndRespectsTheAssetKind(t *testing.T) {
	older := PictureRelation{FilenameColumn: "file_name"}
	if got, want := older.PictureCondition("g"), `COALESCE(NULLIF(TRIM("g"."file_name"::text), ''), '') <> ''`; got != want {
		t.Fatalf("without an asset kind: %s, want %s", got, want)
	}
	shared := PictureRelation{FilenameColumn: "filename", HasAssetKind: true}
	want := `COALESCE(NULLIF(TRIM("filename"::text), ''), '') <> '' AND COALESCE(NULLIF(TRIM("asset_kind"::text), ''), 'image') = 'image'`
	if got := shared.PictureCondition(""); got != want {
		t.Fatalf("with an asset kind: %s, want %s", got, want)
	}
}

func TestOwnPictureFieldsListEachColumnOnce(t *testing.T) {
	fields := OwnPictureFields{Role: []string{"cached_image", "logo_image"}, Named: []string{"cached_image", "image"}}
	if got, want := fields.Columns(), []string{"cached_image", "logo_image", "image"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Columns = %v, want %v", got, want)
	}
}
