// card_picture_choice_test.go
// Pins the precedence of a row's card picture and the gallery order it relies on.
// Between the owner's decisions K120 and K121 and every writer that stores cached_image.
// Exists so each step, each kind of current picture and a second application are stated
// once as examples; a change to any of them has to change this table.
package dtt_card_picture

import (
	"strings"
	"testing"
)

func TestChooseCardPictureFollowsThePrecedence(t *testing.T) {
	primary := []GalleryPicture{{Value: "p.png", Primary: true}, {Value: "a.png"}}
	plain := []GalleryPicture{{Value: "a.png"}, {Value: "b.png"}}
	cases := []struct {
		name    string
		current string
		class   CurrentClass
		gallery []GalleryPicture
		want    Choice
	}{
		{"an empty row with an empty gallery stays empty", "", CurrentNone, nil, Choice{}},
		{"the only upload of an empty row becomes the card picture", "", CurrentNone, []GalleryPicture{{Value: "new.png"}}, Choice{Value: "new.png"}},
		{"the primary wins over the first", "a.png", CurrentNone, primary, Choice{Value: "p.png"}},
		{"without a primary the first wins", "b.png", CurrentNone, plain, Choice{Value: "a.png"}},
		{"a kept picture stays over a primary (K121)", "/storage/7/8/original/x.png", CurrentKept, primary, Choice{Value: "/storage/7/8/original/x.png"}},
		{"a kept picture stays over the first", "https://example.org/logo.png", CurrentKept, plain, Choice{Value: "https://example.org/logo.png"}},
		{"a kept picture stays with an empty gallery", "media/1f/logo.png", CurrentKept, nil, Choice{Value: "media/1f/logo.png"}},
		{"an adoptable picture counts as the first", "own.png", CurrentAdoptable, plain, Choice{Value: "own.png"}},
		{"a primary replaces an adoptable picture, which is kept first", "own.png", CurrentAdoptable, primary, Choice{Value: "p.png", AdoptCurrent: true}},
		{"a broken picture gives way to the first", "gone.png", CurrentBroken, plain, Choice{Value: "a.png"}},
		{"a broken picture with an empty gallery is cleared", "gone.png", CurrentBroken, nil, Choice{}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := ChooseCardPicture(testCase.current, testCase.class, testCase.gallery)
			if got != testCase.want {
				t.Fatalf("ChooseCardPicture(%q, %v, %v) = %+v, want %+v", testCase.current, testCase.class, testCase.gallery, got, testCase.want)
			}
		})
	}
}

// After a choice is stored, the stored value is carried by a gallery row or is the
// same kept or adoptable picture, so applying the rule again chooses the same value.
func TestChoosingAgainFromTheStoredChoiceChangesNothing(t *testing.T) {
	galleries := map[string][]GalleryPicture{
		"empty":   nil,
		"primary": {{Value: "p.png", Primary: true}, {Value: "a.png"}},
		"plain":   {{Value: "a.png"}, {Value: "b.png"}},
	}
	for name, original := range galleries {
		for _, class := range []CurrentClass{CurrentNone, CurrentAdoptable, CurrentKept, CurrentBroken} {
			gallery := append([]GalleryPicture(nil), original...)
			first := ChooseCardPicture("current.png", class, gallery)
			nextClass := CurrentNone
			if first.Value == "current.png" {
				nextClass = class
			}
			if first.AdoptCurrent {
				// The adopted picture is now the gallery's first row behind the primary.
				gallery = append([]GalleryPicture{gallery[0], {Value: "current.png"}}, gallery[1:]...)
			}
			second := ChooseCardPicture(first.Value, nextClass, gallery)
			if second.Value != first.Value || second.AdoptCurrent {
				t.Fatalf("%s gallery, class %v: second choice %+v differs from the stored %+v", name, class, second, first)
			}
		}
	}
}

func TestGalleryOrderClauseStatesTheOneOrder(t *testing.T) {
	all := GalleryOrderClause(GalleryColumns{IsPrimary: true, SortOrder: true, Created: true, ID: true}, "")
	want := `CASE WHEN COALESCE("is_primary", false) THEN 0 ELSE 1 END, COALESCE("sort_order", 0) ASC, "created" ASC NULLS FIRST, "id" ASC`
	if all != want {
		t.Fatalf("full order = %s, want %s", all, want)
	}
	if qualified := GalleryOrderClause(GalleryColumns{SortOrder: true, ID: true}, "g"); qualified != `COALESCE("g"."sort_order", 0) ASC, "g"."id" ASC` {
		t.Fatalf("an older table without primary and creation columns orders by %s", qualified)
	}
	if strings.Contains(GalleryOrderClause(GalleryColumns{ID: true}, ""), "sort_order") {
		t.Fatal("a missing column must not be ordered by")
	}
}
