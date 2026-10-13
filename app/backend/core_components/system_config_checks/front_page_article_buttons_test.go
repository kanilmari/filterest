// front_page_article_buttons_test.go
// Exercises the Home article JSON boundary, including generic-write refusals.
// Connects administrator payloads to the same parser used for persisted settings.
// Prevents ambiguous identities and alternate writers from bypassing the API.
package system_config_checks

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestFrontPageArticleButtonsValidation(t *testing.T) {
	valid := `{"schema_version":1,"placement":"below_text","items":[{"table_uid":102,"row_id":"7","enabled":true}]}`
	for _, raw := range []string{valid, strings.Replace(valid, "below_text", "top_row", 1), strings.Replace(valid, `"row_id":"7"`, `"row_id":"0"`, 1), `{"schema_version":1,"placement":"below_text","items":[]}`} {
		if _, err := ParseFrontPageArticleButtons([]byte(raw)); err != nil {
			t.Fatal(raw, err)
		}
	}
	for _, raw := range []string{
		`null`, `{}`, `[]`, valid + `{}`, strings.Replace(valid, `"schema_version":1`, `"schema_version":2`, 1),
		strings.Replace(valid, "below_text", "side", 1), strings.Replace(valid, `"table_uid":102`, `"table_uid":0`, 1),
		strings.Replace(valid, `"table_uid":102`, `"table_uid":-1`, 1), strings.Replace(valid, `"row_id":"7"`, `"row_id":7`, 1),
		strings.Replace(valid, `,"enabled":true`, ``, 1), strings.Replace(valid, `"enabled":true`, `"enabled":null`, 1),
		strings.Replace(valid, `"enabled":true`, `"enabled":true,"label":"saved title"`, 1),
		`{"schema_version":1,"placement":"below_text","items":null}`,
	} {
		if _, err := ParseFrontPageArticleButtons([]byte(raw)); err == nil {
			t.Fatal("accepted", raw)
		}
	}
	for _, id := range []string{"", "00", "07", "-7", "+7", "7.0", " 7", "7 ", "７"} {
		if _, err := ParseFrontPageArticleButtons([]byte(strings.Replace(valid, `"7"`, fmt.Sprintf("%q", id), 1))); err == nil {
			t.Fatal("accepted row ID", id)
		}
	}
	value := EmptyFrontPageArticleButtons()
	for i := 1; i <= 11; i++ {
		value.Items = append(value.Items, FrontPageArticleItem{102, fmt.Sprint(i), true})
		raw, _ := json.Marshal(value)
		if _, err := ParseFrontPageArticleButtons(raw); (err == nil) != (i <= 10) {
			t.Fatal(i, err)
		}
	}
	value.Items = []FrontPageArticleItem{{102, "7", true}, {102, "7", false}}
	raw, _ := json.Marshal(value)
	if _, err := ParseFrontPageArticleButtons(raw); err == nil {
		t.Fatal("accepted duplicate disabled target")
	}
}

func TestFrontPageArticleButtonsRequireDedicatedWriter(t *testing.T) {
	if err := ValidateRow("system_config", map[string]interface{}{"key": FrontPageArticleButtonsKey, "value_type": 5, "json_value": EmptyFrontPageArticleButtons()}); err == nil {
		t.Fatal("generic settings writer bypassed target authorization and revision")
	}
}
