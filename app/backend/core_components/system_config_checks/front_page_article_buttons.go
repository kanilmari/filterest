// front_page_article_buttons.go
// Defines the bounded, ordered Home article configuration and its strict parser.
// Connects persisted JSON and the dedicated administrator API to one validation rule.
// Stores identities rather than labels so each viewer's read supplies current titles.
package system_config_checks

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"

	"easelect/backend/core_components/httpresponse"
	"github.com/lib/pq"
)

const FrontPageArticleButtonsKey = "front_page_article_buttons"

// FrontPageArticleButtons is private site configuration, never a visitor response.
type FrontPageArticleButtons struct {
	SchemaVersion int                    `json:"schema_version"`
	Placement     string                 `json:"placement"`
	Items         []FrontPageArticleItem `json:"items"`
}

type FrontPageArticleItem struct {
	TableUID int    `json:"table_uid"`
	RowID    string `json:"row_id"`
	Enabled  bool   `json:"enabled"`
}

var articleRowID = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)

// EmptyFrontPageArticleButtons is also the meaning of an absent setting row.
func EmptyFrontPageArticleButtons() FrontPageArticleButtons {
	return FrontPageArticleButtons{SchemaVersion: 1, Placement: "below_text", Items: []FrontPageArticleItem{}}
}

// ParseFrontPageArticleButtons refuses ambiguous IDs, omitted fields and unknown JSON.
func ParseFrontPageArticleButtons(raw []byte) (FrontPageArticleButtons, error) {
	var value FrontPageArticleButtons
	var wire struct {
		SchemaVersion int    `json:"schema_version"`
		Placement     string `json:"placement"`
		Items         []struct {
			TableUID int    `json:"table_uid"`
			RowID    string `json:"row_id"`
			Enabled  *bool  `json:"enabled"`
		} `json:"items"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return value, fmt.Errorf("invalid Home article buttons JSON: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return value, fmt.Errorf("Home article buttons require one JSON object")
	}
	if wire.SchemaVersion != 1 || (wire.Placement != "below_text" && wire.Placement != "top_row") || wire.Items == nil || len(wire.Items) > 10 {
		return value, fmt.Errorf("Home article buttons require schema version 1, a known placement and at most 10 items")
	}
	value = FrontPageArticleButtons{SchemaVersion: 1, Placement: wire.Placement, Items: []FrontPageArticleItem{}}
	seen := map[string]bool{}
	for index, item := range wire.Items {
		identity := fmt.Sprintf("%d/%s", item.TableUID, item.RowID)
		if item.TableUID <= 0 || !articleRowID.MatchString(item.RowID) || item.Enabled == nil || seen[identity] {
			return value, fmt.Errorf("article button %d requires a positive dataset UID, canonical numeric row ID, enabled boolean and unique target", index+1)
		}
		seen[identity] = true
		value.Items = append(value.Items, FrontPageArticleItem{TableUID: item.TableUID, RowID: item.RowID, Enabled: *item.Enabled})
	}
	return value, nil
}

// RefuseArticleButtonsDeletion keeps generic deletion from resetting the revision
// to "none". Administrators remove buttons by saving an empty list with a version.
func RefuseArticleButtonsDeletion(q RowQuerier, table string, ids []int) error {
	if table != "system_config" || len(ids) == 0 {
		return nil
	}
	var protected bool
	if err := q.QueryRow(`SELECT EXISTS(SELECT 1 FROM public.system_config WHERE id=ANY($1) AND key=$2)`, pq.Array(ids), FrontPageArticleButtonsKey).Scan(&protected); err != nil {
		return err
	}
	if protected {
		return &httpresponse.Refusal{Status: 400, LangKey: "save_failed", Message: "Home article buttons require the revision-protected administrator API"}
	}
	return nil
}
