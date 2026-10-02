// card_picture_candidate_contract_test.go
// Holds the server's picture test to the shared examples the browser's test reads too.
// Between LikelyPictureValue, which finds the picture in a row's named picture field for the
// article, and normalizeFallbackImageCandidate in
// app/frontend/core_components/table_views/card_view/card_element_builder_helpers.js, which
// finds it for the card.
// Exists because the two must answer every text alike, or a card and its article show
// different pictures with nothing failing in between; the one example list,
// app/testing/shared_contracts/card_picture_candidate_examples.json, is what fails instead.
package dtt_card_picture

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type cardPictureCandidateExamples struct {
	Examples []struct {
		Input   string `json:"input"`
		Picture string `json:"picture"`
		Why     string `json:"why"`
	} `json:"examples"`
}

func loadCardPictureCandidateExamples(t *testing.T) cardPictureCandidateExamples {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "testing", "shared_contracts", "card_picture_candidate_examples.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) error = %v", path, err)
	}
	var examples cardPictureCandidateExamples
	if err := json.Unmarshal(raw, &examples); err != nil {
		t.Fatalf("Unmarshal(%s) error = %v", path, err)
	}
	if len(examples.Examples) == 0 {
		t.Fatalf("the shared picture examples are empty; the card and the article would go unchecked")
	}
	return examples
}

// Every picture in the shared file is the browser's own answer, proven by the frontend
// test beside card_element_builder_helpers.js; the server must give the same one.
func TestLikelyPictureValueGivesTheBrowsersAnswerForEveryExample(t *testing.T) {
	for _, example := range loadCardPictureCandidateExamples(t).Examples {
		if got := LikelyPictureValue(example.Input); got != example.Picture {
			t.Errorf("%s\n\tLikelyPictureValue(%q) = %q, the browser answers %q",
				example.Why, example.Input, got, example.Picture)
		}
	}
}
