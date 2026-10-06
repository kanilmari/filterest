// row_group_request_validator.go
// Normalizes heading, value and bulk assignment requests.
// Bridges untrusted JSON with the shared row-access and language contracts.
// Exists to keep fixed identities and bounded row selections fail-closed.
package system_table_tools

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

func decodeRowGroupJSON(reader io.Reader, value any) error {
	decoder := json.NewDecoder(io.LimitReader(reader, maxRowGroupRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return errors.New("invalid request body")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func decodeCreateRowGroupRequest(reader io.Reader) (createRowGroupRequest, error) {
	var request createRowGroupRequest
	if err := decodeRowGroupJSON(reader, &request); err != nil {
		return request, err
	}
	if request.Classification != nil {
		// The wrapper contains exactly one heading; mixed value/heading writes are ambiguous.
		if request.ID != 0 || request.Slug != "" || request.Title != nil || request.Description != nil || request.SortOrder != nil || request.Enabled != nil || request.IsSingle != nil || request.ClassificationID != nil {
			return request, errors.New("classification must be the only field")
		}
		if request.Classification.Classification != nil {
			return request, errors.New("nested classification is unsupported")
		}
		return request, validateRowGroupEdit(request.Classification, true)
	}
	err := validateRowGroupEdit(&request, false)
	return request, err
}

func validateRowGroupEdit(request *createRowGroupRequest, heading bool) error {
	if request.ID < 0 {
		return errors.New("id must be positive")
	}
	if request.ID > 0 {
		if request.Slug != "" || request.IsSingle != nil || request.ClassificationID != nil || request.Description != nil {
			return errors.New("slug, is_single and classification_id are fixed after creation")
		}
		if request.Title == nil && request.SortOrder == nil && request.Enabled == nil {
			return errors.New("no changes supplied")
		}
	} else {
		request.Slug = strings.TrimSpace(request.Slug)
		if !rowGroupSlugPattern.MatchString(request.Slug) {
			return errors.New("slug must contain 1-64 lowercase letters, digits, underscores, or hyphens")
		}
		if !heading && (request.ClassificationID == nil || *request.ClassificationID <= 0) {
			return errors.New("classification_id is required for a new value")
		}
	}
	if heading && (request.ClassificationID != nil || request.Description != nil) {
		return errors.New("heading cannot have classification_id or description")
	}
	if !heading && request.IsSingle != nil {
		return errors.New("is_single belongs to a classification")
	}
	if request.SortOrder != nil && (*request.SortOrder < -100000 || *request.SortOrder > 100000) {
		return errors.New("sort_order is outside the supported range")
	}
	var err error
	if request.ID == 0 || request.Title != nil {
		request.Title, err = normalizeRowGroupTranslations(request.Title, true)
		if err != nil {
			return fmt.Errorf("title: %w", err)
		}
	}
	if request.Description != nil {
		request.Description, err = normalizeRowGroupTranslations(request.Description, false)
		if err != nil {
			return fmt.Errorf("description: %w", err)
		}
	}
	return nil
}

func decodeRowGroupMembershipRequest(reader io.Reader) (rowGroupMembershipRequest, error) {
	var request rowGroupMembershipRequest
	if err := decodeRowGroupJSON(reader, &request); err != nil {
		return request, err
	}
	request.Dataset = strings.TrimSpace(request.Dataset)
	if request.GroupID <= 0 {
		return request, errors.New("group_id must be positive")
	}
	if request.Dataset != "" || request.RowIDs != nil {
		if request.Dataset == "" || request.TableUID != 0 || request.RowID != 0 {
			return request, errors.New("use dataset and row_ids, or table_uid and row_id")
		}
		var err error
		request.RowIDs, err = normalizeRowAccessRowIDs(request.RowIDs)
		return request, err
	}
	if request.TableUID <= 0 || request.RowID <= 0 {
		return request, errors.New("group_id, table_uid, and row_id must be positive integers")
	}
	request.RowIDs = []int64{request.RowID}
	return request, nil
}
