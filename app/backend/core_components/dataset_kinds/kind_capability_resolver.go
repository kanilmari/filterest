// kind_capability_resolver.go
// Resolves structural capabilities from registry intent and complete schema evidence.
// Explicit chat intent is required; names never turn a dataset into a chat.
package dataset_kinds

import (
	"slices"
)

func (s Snapshot) shape(name string) (Shape, bool) {
	for _, v := range s.Shapes {
		if v.Name == name {
			return v, true
		}
	}
	return Shape{}, false
}

func (s Snapshot) registration(uid int64) (Registration, bool) {
	for _, v := range s.Registrations {
		if v.UID == uid {
			return v, true
		}
	}
	return Registration{}, false
}

// Resolve is pure and never writes registry metadata or modifies authorization.
func Resolve(s Snapshot, uid int64) Capabilities {
	result := Capabilities{TableUID: uid, Kind: Ordinary, Issues: []string{}, Views: slices.Clone(catalogue[Ordinary][0].Views)}
	reg, ok := s.registration(uid)
	if !ok {
		result.Issues = append(result.Issues, "unregistered")
		return result
	}
	shape, exists := s.shape(reg.Name)
	if reg.Kind == "" {
		reg.Kind = Ordinary
	}
	// Version zero leaves unknown/custom shapes browsable. Known historical
	// contracts use actual column types and FK evidence, never table suffixes.
	if exists && reg.Kind == Ordinary && reg.Version == 0 {
		candidate := reg
		candidate.Kind = Embeddings
		if len(validateContract(candidate, shape, catalogue[Embeddings][0], s)) == 0 {
			reg.Kind = Embeddings
		} else if locationShape(shape) {
			reg.Kind = Locations
		}
	}
	result.Kind, result.Version = reg.Kind, reg.Version
	spec, known := catalogue[reg.Kind][reg.Version]
	if !known {
		result.Issues = append(result.Issues, "unknown_contract")
		return result
	}
	result.AdminOnly, result.ParticipantOnly = spec.AdminOnly, spec.ParticipantOnly
	if !exists {
		result.Issues = append(result.Issues, "missing_table")
		return result
	}
	result.Issues = validateContract(reg, shape, spec, s)
	result.Conforming = len(result.Issues) == 0
	if !result.Conforming {
		return result
	}
	result.Views = slices.Clone(spec.Views)
	result.Map = reg.Kind == Locations
	result.Chat = reg.Kind == ChatMessages
	// Storage kinds never inherit semantic processing or Map from extensions.
	if reg.Kind != Ordinary && reg.Kind != Locations {
		return result
	}
	for _, fk := range shape.ForeignKeys {
		if fk.Target == shape.Name && typedReference(shape, shape, fk) {
			result.Tree = true
		}
	}
	if result.Tree {
		result.Views = append(result.Views, "tree")
	}
	if rel := reg.Configuration.Embeddings; rel != nil {
		if validRelation(s, reg, shape, *rel, true) {
			result.InlineEmbeddings = rel.TableUID == uid
			result.ChildEmbeddings = rel.TableUID != uid
		} else {
			result.Issues = append(result.Issues, "embeddings_relation")
		}
	} else if reg.Version == 0 {
		result.InlineEmbeddings = columns(shape)["embedding_vector"].Type == "vector"
		if reg.MultilingualEmbeddings {
			for _, child := range s.Shapes {
				if !storageContractConforms(s, child, Embeddings) {
					continue
				}
				for _, fk := range child.ForeignKeys {
					if fk.Target == shape.Name && slices.Equal(fk.Columns, []string{"host_row_id"}) && typedReference(child, shape, fk) {
						result.ChildEmbeddings = true
					}
				}
			}
		}
	}
	if rel := reg.Configuration.Locations; rel != nil {
		if validRelation(s, reg, shape, *rel, false) {
			result.Map = true
		} else {
			result.Issues = append(result.Issues, "locations_relation")
		}
	} else if reg.Version == 0 && reg.Kind == Ordinary {
		// Keep historical geometry-child Map support, including an empty child.
		for _, child := range s.Shapes {
			if !storageContractConforms(s, child, Locations) {
				continue
			}
			for _, fk := range child.ForeignKeys {
				if fk.Target == shape.Name && typedReference(child, shape, fk) {
					result.Map = true
				}
			}
		}
	}
	result.SemanticSearch = result.InlineEmbeddings || result.ChildEmbeddings
	if result.Map && !slices.Contains(result.Views, "map") {
		result.Views = append(result.Views, "map")
	}
	result.Conforming = len(result.Issues) == 0
	return result
}

func storageContractConforms(s Snapshot, shape Shape, wanted string) bool {
	reg := Registration{Kind: wanted}
	for _, found := range s.Registrations {
		if found.Name != shape.Name {
			continue
		}
		reg = found
		if reg.Kind == "" || (reg.Kind == Ordinary && reg.Version == 0) {
			reg.Kind = wanted
		}
		break
	}
	spec, known := catalogue[reg.Kind][reg.Version]
	return reg.Kind == wanted && known && len(validateContract(reg, shape, spec, s)) == 0
}

func validRelation(s Snapshot, reg Registration, host Shape, rel Relation, embedding bool) bool {
	target, ok := s.registration(rel.TableUID)
	if !ok {
		return false
	}
	child, ok := s.shape(target.Name)
	if !ok {
		return false
	}
	value := columns(child)[rel.ValueColumn]
	if embedding {
		if value.Type != "vector" {
			return false
		}
		if reg.Version > 0 && (reg.Configuration.VectorModel == "" || reg.Configuration.VectorDimensions <= 0 || !vectorDimension(value, reg.Configuration.VectorDimensions)) {
			return false
		}
	} else if !pointColumn(value) {
		return false
	}
	if rel.TableUID == reg.UID {
		return rel.RowColumn == "" && rel.HostColumn == ""
	}
	wanted := Embeddings
	if !embedding {
		wanted = Locations
	}
	if target.Kind == "" || (target.Kind == Ordinary && target.Version == 0) {
		target.Kind = wanted
	}
	spec, known := catalogue[target.Kind][target.Version]
	if target.Kind != wanted || !known || len(validateContract(target, child, spec, s)) != 0 {
		return false
	}
	for _, fk := range child.ForeignKeys {
		if fk.Target == host.Name && slices.Equal(fk.Columns, []string{rel.RowColumn}) && slices.Equal(fk.TargetColumns, []string{rel.HostColumn}) && typedReference(child, host, fk) {
			return true
		}
	}
	return false
}
