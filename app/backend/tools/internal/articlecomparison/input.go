// input.go
// Validates and canonicalizes K388 evidence before any approval comparison.
// Connects strict file-only JSON decoding to one versioned settings contract.
// Rejects missing/unknown/duplicate fields instead of approving partial evidence.
package articlecomparison

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"sort"

	report "easelect/backend/reusable_components/article_presentation_report"
	contract "easelect/frontend/shared/article_presentations"
)

// ReadReport accepts only complete version-2 snapshots of the requested phase.
func ReadReport(r io.Reader, phase string) (Report, error) {
	var v Report
	if err := decodeStrict(r, &v); err != nil {
		return v, err
	}
	return v, Validate(v, phase)
}
func decodeStrict(r io.Reader, out any) error {
	d := json.NewDecoder(r)
	d.UseNumber()
	tree, err := readValue(d)
	if err != nil {
		return errors.New("invalid JSON evidence")
	}
	if _, err = d.Token(); err != io.EOF {
		return errors.New("trailing JSON evidence")
	}
	if err = required(tree, reflect.TypeOf(out).Elem()); err != nil {
		return err
	}
	raw, err := json.Marshal(tree)
	if err != nil {
		return errors.New("invalid JSON evidence")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(out) != nil {
		return errors.New("invalid or unknown evidence field")
	}
	return nil
}
func readValue(d *json.Decoder) (any, error) {
	t, err := d.Token()
	if err != nil {
		return nil, err
	}
	delim, ok := t.(json.Delim)
	if !ok {
		return t, nil
	}
	switch delim {
	case '{':
		m := map[string]any{}
		for d.More() {
			k, err := d.Token()
			if err != nil {
				return nil, err
			}
			key, ok := k.(string)
			if !ok {
				return nil, errors.New("object key")
			}
			if _, ok = m[key]; ok {
				return nil, errors.New("duplicate key")
			}
			v, err := readValue(d)
			if err != nil {
				return nil, err
			}
			m[key] = v
		}
		_, err = d.Token()
		return m, err
	case '[':
		a := []any{}
		for d.More() {
			v, err := readValue(d)
			if err != nil {
				return nil, err
			}
			a = append(a, v)
		}
		_, err = d.Token()
		return a, err
	}
	return nil, errors.New("unexpected delimiter")
}

var rawType = reflect.TypeOf(json.RawMessage{})

func required(v any, t reflect.Type) error {
	if t == rawType {
		return nil
	}
	if t.Kind() == reflect.Pointer {
		if v == nil {
			return nil
		}
		return required(v, t.Elem())
	}
	switch t.Kind() {
	case reflect.Struct:
		m, ok := v.(map[string]any)
		if !ok {
			return errors.New("required evidence object is absent")
		}
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			name := f.Tag.Get("json")
			value, ok := m[name]
			if !ok {
				return fmt.Errorf("required evidence field is absent: %s", name)
			}
			if err := required(value, f.Type); err != nil {
				return err
			}
		}
	case reflect.Slice:
		a, ok := v.([]any)
		if !ok {
			return errors.New("required evidence array is absent")
		}
		for _, item := range a {
			if err := required(item, t.Elem()); err != nil {
				return err
			}
		}
	case reflect.Map:
		m, ok := v.(map[string]any)
		if !ok {
			return errors.New("required evidence map is absent")
		}
		for _, item := range m {
			if err := required(item, t.Elem()); err != nil {
				return err
			}
		}
	default:
		if v == nil {
			return errors.New("required evidence value is null")
		}
	}
	return nil
}

// Validate also protects programmatic callers that do not use ReadReport.
func Validate(r Report, phase string) error {
	if r.FormatVersion != 2 || r.ContractVersion != contract.Read().Version || r.Phase != phase {
		return errors.New("unsupported report version, contract or phase; re-export both reports")
	}
	if r.Datasets == nil || r.Users == nil || r.Groups == nil || r.Limitations == nil {
		return errors.New("incomplete report inventories")
	}
	groups, users := map[int64]bool{}, map[int64]bool{}
	for _, g := range r.Groups {
		if g.ID <= 0 || g.Name == "" || groups[g.ID] {
			return errors.New("invalid group inventory")
		}
		groups[g.ID] = true
	}
	for _, u := range r.Users {
		if u.ID <= 0 || users[u.ID] || u.GroupIDs == nil {
			return errors.New("invalid reader inventory")
		}
		users[u.ID] = true
		seen := map[int64]bool{}
		for _, g := range u.GroupIDs {
			if !groups[g] || seen[g] {
				return errors.New("invalid membership inventory")
			}
			seen[g] = true
		}
	}
	datasets := map[int]bool{}
	for _, d := range r.Datasets {
		if d.UID <= 0 || datasets[d.UID] || d.Name == "" || d.Schema == "" || d.Blocks == nil || d.Targets == nil || d.Readers == nil || !json.Valid(d.StoredBlocks) || len(d.OpenerPolicy) > 0 && !json.Valid(d.OpenerPolicy) {
			return errors.New("invalid dataset evidence")
		}
		datasets[d.UID] = true
		if err := validateAudience(d.Audience, groups); err != nil {
			return err
		}
		seen := map[targetKey]bool{}
		for _, t := range d.Targets {
			k := targetKey{kind: t.Kind}
			if t.ID != nil {
				k.id = *t.ID
			}
			switch t.Kind {
			case "metadata", "site":
				if t.ID != nil {
					return errors.New("invalid shared target")
				}
			case "group":
				if t.ID == nil || !groups[k.id] {
					return errors.New("unknown group target")
				}
			case "personal":
				if t.ID == nil || !users[k.id] {
					return errors.New("unknown personal target")
				}
			default:
				return errors.New("unknown target kind")
			}
			if seen[k] {
				return errors.New("duplicate target")
			}
			seen[k] = true
			if err := validateProjections(t.Article, t.IFAV, t.Page); err != nil {
				return err
			}
		}
		if !seen[targetKey{kind: "metadata"}] || !seen[targetKey{kind: "site"}] {
			return errors.New("metadata/site target missing")
		}
		readers := map[int64]bool{}
		for _, r := range d.Readers {
			if !users[r.UserID] || readers[r.UserID] {
				return errors.New("invalid reader evidence")
			}
			readers[r.UserID] = true
			if err := validateProjections(r.Article, r.IFAV, r.Page); err != nil {
				return err
			}
		}
		for _, target := range d.Targets {
			if target.Kind == "personal" {
				for _, reader := range d.Readers {
					if reader.UserID == *target.ID && (!reflect.DeepEqual(target.Article, reader.Article) || !reflect.DeepEqual(target.IFAV, reader.IFAV) || !reflect.DeepEqual(target.Page, reader.Page)) {
						return errors.New("personal target and reader evidence disagree")
					}
				}
			}
		}
		if len(readers) != len(users) {
			return errors.New("reader evidence missing")
		}
	}
	return nil
}
func validateProjections(p Projection, i report.ArticleBaselineIFAV, page Projection) error {
	for _, p := range []Projection{p, i.ConfiguredProjection, page} {
		if err := validateFields(p.Fields); err != nil {
			return err
		}
	}
	if i.OpeningSources == nil {
		return errors.New("IFAV sources missing")
	}
	seen := map[string]bool{}
	for _, o := range i.OpeningSources {
		k := o.Path + "/" + o.ViewKey
		if seen[k] || o.Path == "" || o.ViewKey == "" {
			return errors.New("invalid IFAV source")
		}
		seen[k] = true
		if err := validateFields(o.Fields); err != nil {
			return err
		}
	}
	return nil
}
func validateFields(fields []report.ArticleBaselineField) error {
	if fields == nil {
		return errors.New("projection fields missing")
	}
	seen, names := map[string]bool{}, map[string]bool{}
	for _, f := range fields {
		k := fieldKey(f)
		if seen[k] || names[f.Name] || f.Name == "" || f.Width < 0 || f.StoredWidth != nil && *f.StoredWidth < 0 || f.UID != nil && *f.UID <= 0 {
			return errors.New("invalid projection field")
		}
		seen[k] = true
		names[f.Name] = true
	}
	return nil
}
func validateAudience(a report.ArticleBaselineAudience, groups map[int64]bool) error {
	if a.Route == "" || a.Grants == nil {
		return errors.New("audience missing")
	}
	for _, ids := range [][]int64{a.GroupIDs, a.TablelessGroupIDs, a.AccessControlGroupIDs, a.DatasetScopedGroupIDs} {
		if ids == nil {
			return errors.New("audience groups missing")
		}
		seen := map[int64]bool{}
		for _, id := range ids {
			if !groups[id] || seen[id] {
				return errors.New("invalid audience group")
			}
			seen[id] = true
		}
	}
	for _, g := range a.Grants {
		if g.FunctionID <= 0 || !groups[g.GroupID] {
			return errors.New("invalid audience grant")
		}
	}
	return nil
}

func canonical(r Report) Report {
	raw, _ := json.Marshal(r)
	var copy Report
	_ = json.Unmarshal(raw, &copy)
	sort.Slice(copy.Groups, func(i, j int) bool { return copy.Groups[i].ID < copy.Groups[j].ID })
	sort.Slice(copy.Users, func(i, j int) bool { return copy.Users[i].ID < copy.Users[j].ID })
	for i := range copy.Users {
		sort.Slice(copy.Users[i].GroupIDs, func(a, b int) bool { return copy.Users[i].GroupIDs[a] < copy.Users[i].GroupIDs[b] })
	}
	sort.Slice(copy.Datasets, func(i, j int) bool { return copy.Datasets[i].UID < copy.Datasets[j].UID })
	for i := range copy.Datasets {
		d := &copy.Datasets[i]
		d.StoredBlocks = canonicalRaw(d.StoredBlocks)
		d.OpenerPolicy = canonicalRaw(d.OpenerPolicy)
		sort.Slice(d.Targets, func(i, j int) bool { return targetSortKey(d.Targets[i]) < targetSortKey(d.Targets[j]) })
		for j := range d.Targets {
			t := &d.Targets[j]
			cleanProjection(&t.Article)
			cleanProjection(&t.Page)
			cleanIFAV(&t.IFAV)
		}
		sort.Slice(d.Readers, func(i, j int) bool { return d.Readers[i].UserID < d.Readers[j].UserID })
		for j := range d.Readers {
			r := &d.Readers[j]
			cleanProjection(&r.Article)
			cleanProjection(&r.Page)
			cleanIFAV(&r.IFAV)
		}
		for _, ids := range [][]int64{d.Audience.GroupIDs, d.Audience.TablelessGroupIDs, d.Audience.AccessControlGroupIDs, d.Audience.DatasetScopedGroupIDs} {
			sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		}
		sort.Slice(d.Audience.Grants, func(i, j int) bool { return digest(d.Audience.Grants[i]) < digest(d.Audience.Grants[j]) })
	}
	return copy
}
func canonicalRaw(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("null")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var v any
	_ = d.Decode(&v)
	result, _ := json.Marshal(v)
	return result
}
func targetSortKey(t Target) string {
	id := int64(0)
	if t.ID != nil {
		id = *t.ID
	}
	return fmt.Sprintf("%s/%020d", t.Kind, id)
}
func cleanSource(s *report.ArticleBaselineSource) { s.AssignmentID = nil; s.FieldSetID = nil }
func cleanProjection(p *Projection)               { cleanSource(&p.Source) }
func cleanIFAV(i *report.ArticleBaselineIFAV) {
	cleanProjection(&i.ConfiguredProjection)
	for j := range i.OpeningSources {
		cleanSource(&i.OpeningSources[j].Source)
	}
	sort.Slice(i.OpeningSources, func(a, b int) bool {
		x, y := i.OpeningSources[a], i.OpeningSources[b]
		return x.Path+"/"+x.ViewKey < y.Path+"/"+y.ViewKey
	})
}
