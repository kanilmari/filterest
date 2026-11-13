// card_image_credit.go
// Exposes the credit of the authorized gallery image to opted-in card lists.
// The article and card share the same client-side attribution renderer.
package dtt_1_row_read

import (
	"easelect/backend/core_components/dbutils"
	"encoding/json"
	"os"
	"slices"
	"strings"
)

type cardCreditFields struct{ description, source bool }

type creditMetadata struct {
	ImageSource *cardCreditSource `json:"image_source,omitempty"`
}

type cardCreditSource struct {
	Provider          string `json:"provider,omitempty"`
	CreatorName       string `json:"creator_name,omitempty"`
	SourcePageURL     string `json:"source_page_url,omitempty"`
	CreatorProfileURL string `json:"creator_profile_url,omitempty"`
}

type cardImageCredit struct {
	Description string          `json:"description,omitempty"`
	Metadata    *creditMetadata `json:"metadata_json,omitempty"`
}

func readableCardCreditFields(q dbutils.Querier, table string) cardCreditFields {
	if !strings.EqualFold(strings.TrimSpace(os.Getenv("FILTEREST_CARD_IMAGE_CREDITS")), "true") {
		return cardCreditFields{}
	}
	selectable, err := fetchUserSelectableColumns(q, table)
	if err != nil {
		return cardCreditFields{}
	}
	visible, err := getVisibleColumnNames(q, table)
	if err != nil {
		return cardCreditFields{}
	}
	permitted := func(name string) bool { return slices.Contains(selectable, name) && slices.Contains(visible, name) }
	return cardCreditFields{description: permitted("description"), source: permitted("metadata_json")}
}

func (fields cardCreditFields) credit(description, metadata string) *cardImageCredit {
	var credit cardImageCredit
	if fields.description {
		credit.Description = strings.TrimSpace(description)
	}
	if fields.source && metadata != "" {
		var attribution creditMetadata
		if json.Unmarshal([]byte(metadata), &attribution) == nil && attribution.ImageSource != nil && attribution.ImageSource.SourcePageURL != "" {
			credit.Metadata = &attribution
		}
	}
	if credit.Description == "" && credit.Metadata == nil {
		return nil
	}
	return &credit
}
