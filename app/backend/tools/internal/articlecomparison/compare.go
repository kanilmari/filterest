// compare.go
// Compares every saved article presentation surface without a database connection.
// Connects versioned BEFORE/AFTER reports to exact, digest-bound approval evidence.
// Field values remain in protected input reports; owner outputs contain counts only.
package articlecomparison

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strconv"

	report "easelect/backend/reusable_components/article_presentation_report"
)

type Report = report.ArticleBaselineReport
type Dataset = report.ArticleBaselineDataset
type Target = report.ArticleBaselineTarget
type Projection = report.ArticleBaselineProjection

// Difference identifies a changed surface, retaining exact evidence hashes even
// when another change would produce the same owner-visible counts and flags.
type Difference struct {
	DatasetUID   int    `json:"dataset_uid"`
	Dataset      string `json:"dataset"`
	TargetKind   string `json:"target_kind"`
	TargetID     *int64 `json:"target_id"`
	Group        string `json:"group"`
	Presentation string `json:"presentation"`
	BeforeCount  int    `json:"field_count_before"`
	AfterCount   int    `json:"field_count_after"`
	Added        int    `json:"fields_added"`
	Removed      int    `json:"fields_removed"`
	Order        bool   `json:"order_changed"`
	Widths       bool   `json:"widths_changed"`
	Blocks       bool   `json:"blocks_changed"`
	Audience     bool   `json:"audience_changed"`
	Other        bool   `json:"other_changed"`
	BeforeSHA256 string `json:"before_sha256"`
	AfterSHA256  string `json:"after_sha256"`
}

// Approval's digest covers everything except the digest member itself. Array
// order is canonical; personal identities occur only in this protected evidence.
type Approval struct {
	FormatVersion   int          `json:"format_version"`
	ContractVersion int          `json:"contract_version"`
	BaselineSHA256  string       `json:"baseline_sha256"`
	Unchanged       int          `json:"unchanged"`
	Differences     []Difference `json:"differences"`
	SHA256          string       `json:"sha256"`
}

func digest(v any) string {
	raw, _ := json.Marshal(v) // Only validated JSON types and finite integers enter here.
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func (a Approval) checksum() string { a.SHA256 = ""; return digest(a) }
func (d Difference) key() string {
	id := int64(0)
	if d.TargetID != nil {
		id = *d.TargetID
	}
	return fmt.Sprintf("%d/%s/%d/%s", d.DatasetUID, d.TargetKind, id, d.Presentation)
}
func less(a, b Difference) bool {
	if a.DatasetUID != b.DatasetUID {
		return a.DatasetUID < b.DatasetUID
	}
	rank := map[string]int{"metadata": 0, "site": 1, "group": 2, "personal": 3}
	if a.TargetKind != b.TargetKind {
		return rank[a.TargetKind] < rank[b.TargetKind]
	}
	ai, bi := int64(0), int64(0)
	if a.TargetID != nil {
		ai = *a.TargetID
	}
	if b.TargetID != nil {
		bi = *b.TargetID
	}
	if ai != bi {
		return ai < bi
	}
	return a.Presentation < b.Presentation
}

type surface struct {
	Identity     any                         `json:"identity"`
	Projection   Projection                  `json:"projection"`
	IFAV         *report.ArticleBaselineIFAV `json:"ifav"`
	Blocks       any                         `json:"blocks"`
	Audience     any                         `json:"audience"`
	Opener       json.RawMessage             `json:"opener"`
	Memberships  []int64                     `json:"memberships"`
	ReaderRights any                         `json:"reader_rights"`
}

type targetKey struct {
	kind string
	id   int64
}

func targets(d Dataset) map[targetKey]Target {
	result := map[targetKey]Target{}
	for _, t := range d.Targets {
		k := targetKey{kind: t.Kind}
		if t.ID != nil {
			k.id = *t.ID
		}
		result[k] = t
	}
	// Every reader is a personal comparison surface, including readers without a
	// saved preference. This covers competing groups, guests and membership drift.
	for _, r := range d.Readers {
		id := r.UserID
		result[targetKey{"personal", id}] = Target{Kind: "personal", ID: &id, Article: r.Article, IFAV: r.IFAV, Page: r.Page}
	}
	return result
}
func projection(t Target, key string) Projection {
	switch key {
	case "article_view":
		return t.Article
	case "image_first_view":
		return t.IFAV.ConfiguredProjection
	default:
		return t.Page
	}
}
func makeSurface(r Report, d Dataset, t Target, key string) surface {
	groupNames := map[int64]string{}
	for _, g := range r.Groups {
		groupNames[g.ID] = g.Name
	}
	targetGroupName := ""
	if t.Kind == "group" && t.ID != nil {
		targetGroupName = groupNames[*t.ID]
	}
	audienceNames := map[int64]string{}
	for _, grant := range d.Audience.Grants {
		audienceNames[grant.GroupID] = groupNames[grant.GroupID]
	}
	s := surface{Identity: []any{d.UID, d.Name, d.Schema, t.Kind, t.ID, targetGroupName}, Projection: projection(t, key),
		Blocks: []any{d.StoredBlocks, d.BlockReadError, d.Blocks}, Audience: []any{d.Audience, audienceNames}, Opener: d.OpenerPolicy}
	if key == "image_first_view" {
		v := t.IFAV
		s.IFAV = &v
	}
	if t.Kind == "personal" && t.ID != nil {
		for _, u := range r.Users {
			if u.ID == *t.ID {
				s.Memberships = u.GroupIDs
			}
		}
		for _, reader := range d.Readers {
			if reader.UserID == *t.ID {
				s.ReaderRights = []bool{reader.ArticleRouteAllowed, reader.ArticleRouteTablelessAllowed, reader.ArticleRouteAccessControlAllowed}
			}
		}
	}
	return s
}

// Compare validates and canonicalizes copies. It compares settings evidence,
// including legacy IFAV source paths; it makes no rendered-row compatibility claim.
func Compare(before, after Report) (Approval, error) {
	if err := Validate(before, "before"); err != nil {
		return Approval{}, err
	}
	if err := Validate(after, "after"); err != nil {
		return Approval{}, err
	}
	before = canonical(before)
	after = canonical(after)
	a := Approval{FormatVersion: 1, ContractVersion: before.ContractVersion, BaselineSHA256: digest(before), Differences: []Difference{}}
	bd, ad := map[int]Dataset{}, map[int]Dataset{}
	ids := map[int]bool{}
	for _, d := range before.Datasets {
		bd[d.UID] = d
		ids[d.UID] = true
	}
	for _, d := range after.Datasets {
		ad[d.UID] = d
		ids[d.UID] = true
	}
	groups := map[int64]string{}
	for _, g := range after.Groups {
		groups[g.ID] = g.Name
	}
	for _, g := range before.Groups {
		if _, ok := groups[g.ID]; !ok {
			groups[g.ID] = g.Name
		}
	}
	for uid := range ids {
		b, bok := bd[uid]
		c, cok := ad[uid]
		bt, at := targets(b), targets(c)
		ks := map[targetKey]bool{}
		for k := range bt {
			ks[k] = true
		}
		for k := range at {
			ks[k] = true
		}
		for k := range ks {
			for _, key := range []string{"article_view", "image_first_view", "image_first_page_view"} {
				btarget, btok := bt[k]
				atarget, atok := at[k]
				var bs, as *surface
				if bok && btok {
					v := makeSurface(before, b, btarget, key)
					bs = &v
				}
				if cok && atok {
					v := makeSurface(after, c, atarget, key)
					as = &v
				}
				if reflect.DeepEqual(bs, as) {
					a.Unchanged++
					continue
				}
				name := c.Name
				if !cok {
					name = b.Name
				}
				d := Difference{DatasetUID: uid, Dataset: name, TargetKind: k.kind, Presentation: key, BeforeSHA256: digest(bs), AfterSHA256: digest(as)}
				if k.kind == "group" || k.kind == "personal" {
					id := k.id
					d.TargetID = &id
				}
				if k.kind == "group" {
					d.Group = groups[k.id]
				}
				var bf, af []report.ArticleBaselineField
				if bs != nil {
					bf = bs.Projection.Fields
				}
				if as != nil {
					af = as.Projection.Fields
				}
				d.BeforeCount, d.AfterCount = len(bf), len(af)
				d.Added, d.Removed, d.Order, d.Widths = fieldChanges(bf, af)
				if key == "image_first_view" && bs != nil && as != nil {
					openings := map[string]report.ArticleBaselineOpening{}
					for _, o := range bs.IFAV.OpeningSources {
						openings[o.Path+"/"+o.ViewKey] = o
					}
					for _, o := range as.IFAV.OpeningSources {
						if prior, ok := openings[o.Path+"/"+o.ViewKey]; ok {
							_, _, order, widths := fieldChanges(prior.Fields, o.Fields)
							d.Order = d.Order || order
							d.Widths = d.Widths || widths
						}
					}
				}
				if bs == nil || as == nil {
					d.Blocks = true
					d.Audience = true
					d.Other = true
				} else {
					d.Blocks = !reflect.DeepEqual(bs.Blocks, as.Blocks)
					d.Audience = !reflect.DeepEqual(bs.Audience, as.Audience) || !reflect.DeepEqual(bs.Memberships, as.Memberships) || !reflect.DeepEqual(bs.ReaderRights, as.ReaderRights)
					// Remaining evidence covers roles, row flags, provenance, IFAV source paths,
					// opener policy and identity. Hashes ensure none of it can be silently lost.
					bsOther, asOther := *bs, *as
					bsOther.Blocks, asOther.Blocks = nil, nil
					bsOther.Audience, asOther.Audience = nil, nil
					bsOther.Projection.Fields, asOther.Projection.Fields = nil, nil
					bsOther.Memberships, asOther.Memberships = nil, nil
					bsOther.ReaderRights, asOther.ReaderRights = nil, nil
					d.Other = !reflect.DeepEqual(bsOther, asOther) || fieldMetadataChanged(bf, af)
				}
				a.Differences = append(a.Differences, d)
			}
		}
	}
	sort.Slice(a.Differences, func(i, j int) bool { return less(a.Differences[i], a.Differences[j]) })
	a.SHA256 = a.checksum()
	return a, nil
}
func fieldKey(f report.ArticleBaselineField) string {
	if f.UID != nil {
		return "uid:" + strconv.FormatInt(*f.UID, 10)
	}
	return "name:" + f.Name
}
func fieldChanges(b, a []report.ArticleBaselineField) (added, removed int, order, width bool) {
	bm, am := map[string]report.ArticleBaselineField{}, map[string]report.ArticleBaselineField{}
	for _, f := range b {
		bm[fieldKey(f)] = f
	}
	for _, f := range a {
		am[fieldKey(f)] = f
	}
	bo, ao := []string{}, []string{}
	for _, f := range b {
		k := fieldKey(f)
		if v, ok := am[k]; ok {
			bo = append(bo, k)
			width = width || f.Width != v.Width || !reflect.DeepEqual(f.StoredWidth, v.StoredWidth)
		} else {
			removed++
		}
	}
	for _, f := range a {
		k := fieldKey(f)
		if _, ok := bm[k]; ok {
			ao = append(ao, k)
		} else {
			added++
		}
	}
	return added, removed, !reflect.DeepEqual(bo, ao), width
}
func fieldMetadataChanged(b, a []report.ArticleBaselineField) bool {
	bm := map[string]report.ArticleBaselineField{}
	for _, f := range b {
		f.Width = 0
		f.StoredWidth = nil
		bm[fieldKey(f)] = f
	}
	for _, f := range a {
		f.Width = 0
		f.StoredWidth = nil
		if old, ok := bm[fieldKey(f)]; ok && !reflect.DeepEqual(old, f) {
			return true
		}
	}
	return false
}
