// article_presentations_state.go
// Defines complete target-owned article editor snapshots and revision dependencies.
// Connects the atomic HTTP workflow to existing bundle storage without inheritance loss.
// Content and tuple revisions detect changes by legacy writers as well as this editor.
package system_table_tools

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"

	"easelect/backend/core_components/dbutils"
)

var articlePresentationKeys = []string{"article_view", "image_first_view", "image_first_page_view"}

type articleCell struct {
	Visible bool `json:"visible"`
	Width   *int `json:"width_px"`
}

func (c *articleCell) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	if len(fields) != 2 || fields["visible"] == nil || fields["width_px"] == nil || string(fields["visible"]) == "null" {
		return fmt.Errorf("complete boolean and width required")
	}
	type plain articleCell
	var value plain
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	*c = articleCell(value)
	return nil
}

type articleMember struct {
	UID    int                    `json:"column_uid"`
	Values map[string]articleCell `json:"values"`
}
type articlePrincipal struct {
	Scope   string `json:"scope"`
	GroupID int64  `json:"group_id,omitempty"`
	UserID  int64  `json:"user_id,omitempty"`
}

func (p articlePrincipal) key() string {
	if p.Scope == "site" {
		return "site"
	}
	if p.Scope == "group" {
		return "group:" + strconv.FormatInt(p.GroupID, 10)
	}
	return "personal:" + strconv.FormatInt(p.UserID, 10)
}
func (p articlePrincipal) args() (any, any) {
	if p.Scope == "group" {
		return nil, p.GroupID
	}
	if p.Scope == "personal" {
		return p.UserID, nil
	}
	return nil, nil
}
func validArticlePrincipals(targets []articleTarget) error {
	if len(targets) == 0 || len(targets) > 200 {
		return fmt.Errorf("exact targets required")
	}
	seen := map[string]bool{}
	for _, t := range targets {
		p := t.articlePrincipal
		valid := p.Scope == "site" && p.GroupID == 0 && p.UserID == 0 || p.Scope == "group" && p.GroupID > 0 && p.UserID == 0 || p.Scope == "personal" && p.UserID > 1 && p.GroupID == 0
		if !valid || seen[p.key()] || p.Scope != targets[0].Scope || p.Scope != "group" && len(targets) != 1 {
			return fmt.Errorf("invalid or duplicate target")
		}
		seen[p.key()] = true
	}
	return nil
}

type articleLink struct {
	View       string `json:"view_key"`
	FieldSetID int64  `json:"field_set_id"`
	Name       string `json:"name"`
	Priority   int    `json:"priority"`
}

// Assignment metadata is explicit too: null or omitted priority must not silently
// become zero and replace a group's authored priority.
func (link *articleLink) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	if len(fields) != 4 {
		return fmt.Errorf("complete article assignment required")
	}
	for _, key := range []string{"view_key", "field_set_id", "name", "priority"} {
		if fields[key] == nil || string(fields[key]) == "null" {
			return fmt.Errorf("explicit article assignment required")
		}
	}
	type plain articleLink
	var value plain
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	*link = articleLink(value)
	return nil
}

type articleTarget struct {
	articlePrincipal
	Members     []articleMember `json:"members"`
	Assignments []articleLink   `json:"assignments"`
}
type articleField struct {
	UID      int    `json:"column_uid"`
	Name     string `json:"name"`
	Editable bool   `json:"editable"`
}

// Reuse the compatibility reader's strict boolean decoder at this boundary.
// JSON null must never be interpreted as an explicit closed opening block.
type articleBlocks map[string]map[string]bool

func (blocks *articleBlocks) UnmarshalJSON(raw []byte) error {
	var presentations map[string]json.RawMessage
	if err := json.Unmarshal(raw, &presentations); err != nil {
		return err
	}
	if presentations == nil {
		return fmt.Errorf("explicit article blocks required")
	}
	result := articleBlocks{}
	for key, value := range presentations {
		sections, err := decodeArticleSectionValues(value, key)
		if err != nil {
			return err
		}
		result[key] = sections
	}
	*blocks = result
	return nil
}

type articleSnapshot struct {
	Dataset    string            `json:"dataset"`
	DatasetUID int               `json:"dataset_uid"`
	ActorID    int               `json:"actor_id"`
	Family     string            `json:"family"`
	Fields     []articleField    `json:"fields"`
	Targets    []articleTarget   `json:"targets"`
	Blocks     articleBlocks     `json:"blocks,omitempty"`
	Revisions  map[string]string `json:"revisions"`
}

func articleRevision(value any) string {
	raw, _ := json.Marshal(value)
	return fmt.Sprintf("%x", sha256.Sum256(raw))
}

// Callers hold the dataset lock for the entire snapshot and mutation. Missing
// targets read the site's complete members, but retain their absent assignment.
func readArticleSnapshot(q dbutils.Querier, dataset string, uid, actor int, targets []articleTarget) (articleSnapshot, error) {
	result := articleSnapshot{Dataset: dataset, DatasetUID: uid, ActorID: actor, Family: "article", Fields: []articleField{}, Targets: []articleTarget{}, Revisions: map[string]string{}}
	var raw []byte
	if err := q.QueryRow(`SELECT jsonb_build_object('blocks',article_section_initial_open,'tuple',xmin::text) FROM system_db_tables WHERE table_uid=$1`, uid).Scan(&raw); err != nil {
		return result, err
	}
	var blockState struct {
		Blocks map[string]map[string]bool `json:"blocks"`
	}
	if err := json.Unmarshal(raw, &blockState); err != nil {
		return result, err
	}
	result.Blocks = blockState.Blocks
	result.Revisions["blocks"] = articleRevision(string(raw))
	rows, err := q.Query(`SELECT column_uid,column_name,NOT COALESCE(hide_everywhere,false) AND COALESCE(client_delivery_mode,'include')='include',xmin::text FROM system_column_details WHERE table_uid=$1 ORDER BY column_uid`, uid)
	if err != nil {
		return result, err
	}
	versions := []string{}
	for rows.Next() {
		var f articleField
		var version string
		if err = rows.Scan(&f.UID, &f.Name, &f.Editable, &version); err != nil {
			rows.Close()
			return result, err
		}
		result.Fields = append(result.Fields, f)
		versions = append(versions, version)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	result.Revisions["fields"] = articleRevision([]any{result.Fields, versions})
	for _, target := range targets {
		user, group := target.args()
		var id sql.NullInt64
		err = q.QueryRow(`SELECT a.field_set_id FROM system_view_field_set_assignments a JOIN system_table_views v ON v.id=a.view_id WHERE a.table_uid=$1 AND a.user_id IS NOT DISTINCT FROM $2::bigint AND a.group_id IS NOT DISTINCT FROM $3::bigint AND v.view_key='article_view'`, uid, user, group).Scan(&id)
		if err != nil && err != sql.ErrNoRows {
			return result, err
		}
		if !id.Valid {
			err = q.QueryRow(`SELECT a.field_set_id FROM system_view_field_set_assignments a JOIN system_table_views v ON v.id=a.view_id WHERE a.table_uid=$1 AND a.user_id IS NULL AND a.group_id IS NULL AND v.view_key='article_view'`, uid).Scan(&id)
			if err != nil {
				return result, err
			}
		}
		err = q.QueryRow(`SELECT jsonb_build_object('members',COALESCE((SELECT jsonb_agg(jsonb_build_object('column_uid',column_uid,'values',presentation_values) ORDER BY sort_order) FROM system_column_field_set_members WHERE field_set_id=$4),'[]'),
   'assignments',COALESCE((SELECT jsonb_agg(jsonb_build_object('view_key',v.view_key,'field_set_id',a.field_set_id,'name',s.name,'priority',a.group_priority) ORDER BY v.view_key) FROM system_view_field_set_assignments a JOIN system_table_views v ON v.id=a.view_id JOIN system_column_field_sets s ON s.id=a.field_set_id WHERE a.table_uid=$1 AND a.user_id IS NOT DISTINCT FROM $2::bigint AND a.group_id IS NOT DISTINCT FROM $3::bigint AND v.view_key=ANY(public.app_article_keys())),'[]'),
   'versions',jsonb_build_array((SELECT jsonb_agg(xmin::text ORDER BY sort_order) FROM system_column_field_set_members WHERE field_set_id=$4),(SELECT xmin::text FROM system_column_field_sets WHERE id=$4),
    (SELECT jsonb_agg(a.xmin::text ORDER BY v.view_key) FROM system_view_field_set_assignments a JOIN system_table_views v ON v.id=a.view_id WHERE a.table_uid=$1 AND a.user_id IS NOT DISTINCT FROM $2::bigint AND a.group_id IS NOT DISTINCT FROM $3::bigint AND v.view_key=ANY(public.app_article_keys()))))`, uid, user, group, id.Int64).Scan(&raw)
		if err != nil {
			return result, err
		}
		next := articleTarget{articlePrincipal: target.articlePrincipal}
		if err = json.Unmarshal(raw, &next); err != nil {
			return result, err
		}
		result.Targets = append(result.Targets, next)
		result.Revisions[target.key()] = articleRevision(string(raw))
	}
	return result, nil
}

func validateArticleWrite(input, baseline articleSnapshot) error {
	if input.Dataset != baseline.Dataset || input.DatasetUID != baseline.DatasetUID || input.Family != "article" || len(input.Targets) != len(baseline.Targets) {
		return fmt.Errorf("article target mismatch")
	}
	fields := map[int]bool{}
	for _, f := range baseline.Fields {
		fields[f.UID] = f.Editable
	}
	for i, target := range input.Targets {
		currentTarget := baseline.Targets[i]
		if target.articlePrincipal != currentTarget.articlePrincipal || len(target.Members) != len(currentTarget.Members) || len(target.Assignments) != 3 {
			return fmt.Errorf("incomplete target")
		}
		// The catalogue describes eligibility, not bundle membership. Legacy
		// targets may hold different subsets; require every stored member,
		// including hidden members retained by the field lifecycle triggers.
		members := map[int]bool{}
		for _, member := range currentTarget.Members {
			members[member.UID] = true
		}
		seen := map[int]bool{}
		for _, member := range target.Members {
			editable, exists := fields[member.UID]
			if !members[member.UID] || !exists || seen[member.UID] || len(member.Values) != 3 {
				return fmt.Errorf("incomplete or duplicate field")
			}
			seen[member.UID] = true
			for _, key := range articlePresentationKeys {
				cell, exists := member.Values[key]
				if !exists || cell.Width != nil && (*cell.Width < 0 || int64(*cell.Width) > 2147483647) || cell.Visible && !editable {
					return fmt.Errorf("forbidden article field or invalid cell")
				}
			}
		}
		links := map[string]bool{}
		first := target.Assignments[0]
		for _, link := range target.Assignments {
			if !isArticleBundleView(link.View) || links[link.View] || link.FieldSetID < 0 || link.Name == "" || len([]rune(link.Name)) > 128 || link.Priority < -1000000 || link.Priority > 1000000 || link.FieldSetID != first.FieldSetID || link.Name != first.Name || link.Priority != first.Priority || target.Scope != "group" && link.Priority != 0 {
				return fmt.Errorf("invalid article assignments")
			}
			links[link.View] = true
		}
		current := baseline.Targets[i].Assignments
		expectedID := int64(0)
		if len(current) > 0 {
			expectedID = current[0].FieldSetID
		}
		if first.FieldSetID != expectedID {
			return fmt.Errorf("assignment identity changed")
		}
	}
	if input.Targets[0].Scope != "site" {
		if input.Blocks != nil {
			return fmt.Errorf("blocks are dataset-wide")
		}
	} else {
		if len(input.Blocks) != 3 {
			return fmt.Errorf("complete blocks required")
		}
		for _, key := range articlePresentationKeys {
			sections := articleSupportedSections(key)
			if len(input.Blocks[key]) != len(sections) {
				return fmt.Errorf("unsupported blocks")
			}
			for _, section := range sections {
				if _, ok := input.Blocks[key][section]; !ok {
					return fmt.Errorf("missing block")
				}
			}
		}
	}
	return nil
}

var errArticleRevisionConflict = fmt.Errorf("article_revision_conflict")

func persistArticlePresentations(tx *sql.Tx, input articleSnapshot, actor int) (articleSnapshot, error) {
	var locked bool
	if err := tx.QueryRow(`SELECT public.app_lock_article_dataset_uid($1)`, input.DatasetUID).Scan(&locked); err != nil {
		return articleSnapshot{}, err
	}
	if !locked {
		return articleSnapshot{}, sql.ErrNoRows
	}
	baseline, err := readArticleSnapshot(tx, input.Dataset, input.DatasetUID, actor, input.Targets)
	if err != nil {
		return baseline, err
	}
	if !reflect.DeepEqual(input.Revisions, baseline.Revisions) {
		return baseline, errArticleRevisionConflict
	}
	if err = validateArticleWrite(input, baseline); err != nil {
		return baseline, err
	}
	for _, target := range input.Targets {
		user, group := target.args()
		members, _ := json.Marshal(target.Members)
		var id int64
		if err = tx.QueryRow(`SELECT public.app_save_article_presentations($1,$2,$3,$4,$5::jsonb,$6,$7)`, input.DatasetUID, user, group, target.Assignments[0].Priority, string(members), target.Assignments[0].Name, actor).Scan(&id); err != nil {
			return baseline, err
		}
	}
	if input.Blocks != nil {
		raw, _ := json.Marshal(input.Blocks)
		if _, err = tx.Exec(`UPDATE system_db_tables SET article_section_initial_open=$1::jsonb WHERE table_uid=$2`, string(raw), input.DatasetUID); err != nil {
			return baseline, err
		}
	}
	return readArticleSnapshot(tx, input.Dataset, input.DatasetUID, actor, input.Targets)
}
