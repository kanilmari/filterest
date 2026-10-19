// article_baseline_policy.go
// Records legacy block presence and current Article route audiences.
// Connects shared block keys and existing strict/access-control permission semantics.
// Preserves malformed/null evidence and never invents grants or writes defaults.
package dtt_1_row_read

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"sort"
	"strconv"

	contract "easelect/frontend/shared/article_presentations"
)

// WriteArticlePresentationBaseline sorts every JSON object key and retains exact
// integer identifiers. Call only after the entire snapshot has succeeded.
func WriteArticlePresentationBaseline(w io.Writer, report ArticleBaselineReport) error {
	raw, err := json.Marshal(report)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var canonical any
	if err := decoder.Decode(&canonical); err != nil {
		return err
	}
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	encoder.SetEscapeHTML(false)
	return encoder.Encode(canonical)
}
func articleBaselineBlocks(raw []byte) (map[string]ArticleBaselineBlocks, *string) {
	supported := map[string][]string{}
	for key, p := range contract.Read().Presentations {
		supported[key] = p.Blocks
		if p.LegacySectionKey != nil {
			supported[*p.LegacySectionKey] = p.Blocks
		}
	}
	var stored map[string]json.RawMessage
	valid := json.Unmarshal(raw, &stored) == nil && stored != nil
	parsed := map[string]map[string]bool{}
	for key, value := range stored {
		var sections map[string]json.RawMessage
		keys, known := supported[key]
		if !known || json.Unmarshal(value, &sections) != nil || sections == nil {
			valid = false
			continue
		}
		parsed[key] = map[string]bool{}
		for section, v := range sections {
			allowed := false
			for _, k := range keys {
				allowed = allowed || k == section
			}
			v = bytes.TrimSpace(v)
			if !allowed || (!bytes.Equal(v, []byte("true")) && !bytes.Equal(v, []byte("false"))) {
				valid = false
				continue
			}
			parsed[key][section] = bytes.Equal(v, []byte("true"))
		}
	}
	result := map[string]ArticleBaselineBlocks{}
	for presentation, keys := range supported {
		_, present := stored[presentation]
		block := ArticleBaselineBlocks{Present: present, Overrides: map[string]bool{}, InitialOpen: map[string]bool{}}
		for _, key := range keys {
			block.InitialOpen[key] = contract.Read().AbsentBlockInitialOpen
			if value, exists := parsed[presentation][key]; exists && valid {
				block.Overrides[key] = value
				block.InitialOpen[key] = value
			}
		}
		result[presentation] = block
	}
	if !valid {
		message := "stored block object is rejected by the legacy API; browser loading falls back to all supported sections open"
		return result, &message
	}
	return result, nil
}
func articleBaselineAudience(tx *sql.Tx, route, uid string) (ArticleBaselineAudience, error) {
	result := ArticleBaselineAudience{Route: route, GuestUserID: 1, GroupIDs: []int64{}, TablelessGroupIDs: []int64{}, AccessControlGroupIDs: []int64{}, DatasetScopedGroupIDs: []int64{}, Grants: []ArticleBaselineGrant{}}
	rows, err := tx.Query(`SELECT f.id,g.user_group_id,g.target_schema_name,g.target_table_uid,f.disabled,f.specific_table_related
        FROM public.system_group_table_func_rights g JOIN public.system_functions f ON f.id=g.function_id
        WHERE f.url_route_endpoint=$1 ORDER BY f.id,g.user_group_id,g.target_table_uid NULLS FIRST,g.target_schema_name NULLS FIRST,g.id`, route)
	if err != nil {
		return result, err
	}
	browser, strict, access, scoped := map[int64]bool{}, map[int64]bool{}, map[int64]bool{}, map[int64]bool{}
	for rows.Next() {
		var grant ArticleBaselineGrant
		if err := rows.Scan(&grant.FunctionID, &grant.GroupID, &grant.Schema, &grant.DatasetUID, &grant.Disabled, &grant.SpecificTableRelated); err != nil {
			rows.Close()
			return result, err
		}
		result.Grants = append(result.Grants, grant)
		enabled := grant.Disabled != nil && !*grant.Disabled
		if enabled {
			browser[grant.GroupID] = true
		}
		if grant.DatasetUID == nil {
			if enabled {
				strict[grant.GroupID] = true
			}
			if grant.Disabled == nil || enabled {
				access[grant.GroupID] = true
			}
		} else if strconv.FormatInt(*grant.DatasetUID, 10) == uid && enabled {
			scoped[grant.GroupID] = true
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return result, err
	}
	rows.Close()
	sorted := func(ids map[int64]bool) []int64 {
		values := []int64{}
		for id := range ids {
			values = append(values, id)
		}
		sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
		return values
	}
	result.GroupIDs, result.TablelessGroupIDs, result.AccessControlGroupIDs, result.DatasetScopedGroupIDs = sorted(browser), sorted(strict), sorted(access), sorted(scoped)
	err = tx.QueryRow(`SELECT EXISTS (
        SELECT 1 FROM public.system_group_table_func_rights gf
        JOIN public.system_functions f ON gf.function_id=f.id
        JOIN public.system_user_groups groups ON gf.user_group_id=groups.id
        WHERE groups.name='guests' AND f.disabled=false
          AND f.url_route_endpoint=$1 AND gf.target_table_uid IS NULL)`, route).Scan(&result.GuestAllowed)
	return result, err
}
