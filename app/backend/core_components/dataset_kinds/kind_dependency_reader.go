// kind_dependency_reader.go
// Selects the evidence consumed by one classification from a requested batch.
// Connects registered intent, incoming storage children and referenced key shapes.
// Keeps unrelated datasets out of each fingerprint and preserves missing-FK drift.
package dataset_kinds

func scopeEvidence(s Snapshot, uid int64) Snapshot {
	root, found := s.registration(uid)
	if !found {
		return Snapshot{}
	}
	hosts := map[string]bool{root.Name: true}
	for _, relation := range []*Relation{root.Configuration.Embeddings, root.Configuration.Locations} {
		if relation != nil {
			if child, ok := s.registration(relation.TableUID); ok {
				hosts[child.Name] = true
			}
		}
	}
	names := make(map[string]bool, len(hosts))
	for name := range hosts {
		names[name] = true
	}
	for _, shape := range s.Shapes {
		for _, fk := range shape.ForeignKeys {
			if hosts[fk.Target] {
				names[shape.Name] = true
			}
		}
	}
	// Two outward hops cover storage actors and Chat's validated settings keys.
	// Do not follow incoming edges of parents, which would pull in unrelated hosts.
	for depth := 0; depth < 2; depth++ {
		parents := make(map[string]bool)
		for _, shape := range s.Shapes {
			if names[shape.Name] {
				for _, fk := range shape.ForeignKeys {
					parents[fk.Target] = true
				}
			}
		}
		for name := range parents {
			names[name] = true
		}
	}
	var result Snapshot
	for _, reg := range s.Registrations {
		if names[reg.Name] {
			result.Registrations = append(result.Registrations, reg)
		}
	}
	for _, shape := range s.Shapes {
		if names[shape.Name] {
			result.Shapes = append(result.Shapes, shape)
		}
	}
	return result
}
