// approval.go
// Verifies approved difference evidence in both directions without exposing values.
// Connects the review digest to post-upgrade unlisted and missing surface checks.
// A changed value with identical flags still invalidates the approval.
package articlecomparison

import (
	"errors"
	"io"
	"reflect"
)

// ReadApproval verifies the digest and canonical difference order before use.
func ReadApproval(r io.Reader) (Approval, error) {
	var a Approval
	if err := decodeStrict(r, &a); err != nil {
		return a, err
	}
	return a, validateApproval(a)
}
func validHash(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func validateApproval(a Approval) error {
	if a.FormatVersion != 1 || a.ContractVersion != 1 || a.Differences == nil || a.Unchanged < 0 || !validHash(a.BaselineSHA256) || a.SHA256 != a.checksum() {
		return errors.New("invalid approval version or digest")
	}
	for i, d := range a.Differences {
		if d.DatasetUID <= 0 || d.Dataset == "" || d.BeforeCount < 0 || d.AfterCount < 0 || d.Added < 0 || d.Removed < 0 || !validHash(d.BeforeSHA256) || !validHash(d.AfterSHA256) || d.BeforeSHA256 == d.AfterSHA256 {
			return errors.New("invalid approval difference")
		}
		if i > 0 && !less(a.Differences[i-1], d) {
			return errors.New("noncanonical or duplicate approval differences")
		}
		switch d.TargetKind {
		case "metadata", "site":
			if d.TargetID != nil {
				return errors.New("invalid approval target")
			}
		case "group", "personal":
			if d.TargetID == nil || *d.TargetID <= 0 {
				return errors.New("invalid approval target")
			}
		default:
			return errors.New("invalid approval target")
		}
		if d.Presentation != "article_view" && d.Presentation != "image_first_view" && d.Presentation != "image_first_page_view" {
			return errors.New("invalid approval presentation")
		}
	}
	return nil
}

// CheckResult keeps identities in machine memory; human formatting aggregates
// personal targets and emits configuration names, counts and flags only.
type CheckResult struct {
	Equal             bool
	Unlisted, Missing []Difference
	InventoryChanged  bool
}

func Check(current, approved Approval) (CheckResult, error) {
	result := CheckResult{Unlisted: []Difference{}, Missing: []Difference{}}
	if err := validateApproval(current); err != nil {
		return result, err
	}
	if err := validateApproval(approved); err != nil {
		return result, err
	}
	if current.BaselineSHA256 != approved.BaselineSHA256 {
		return result, errors.New("approval belongs to a different BEFORE report")
	}
	known, actual := map[string]Difference{}, map[string]Difference{}
	for _, d := range approved.Differences {
		known[d.key()] = d
	}
	for _, d := range current.Differences {
		actual[d.key()] = d
	}
	for _, d := range current.Differences {
		if k, ok := known[d.key()]; !ok || !reflect.DeepEqual(k, d) {
			result.Unlisted = append(result.Unlisted, d)
		}
	}
	for _, d := range approved.Differences {
		if k, ok := actual[d.key()]; !ok || !reflect.DeepEqual(k, d) {
			result.Missing = append(result.Missing, d)
		}
	}
	result.InventoryChanged = current.Unchanged != approved.Unchanged
	result.Equal = len(result.Unlisted) == 0 && len(result.Missing) == 0 && !result.InventoryChanged
	return result, nil
}
