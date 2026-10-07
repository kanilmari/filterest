// release_contract_json_decoder.go
// Strictly decodes bounded release JSON without losing ambiguity evidence.
// Connects typed manifest, policy and proof parsers to their closed contracts.
// Rejects duplicate fields, nulls, trailing input and excessive JSON nesting.
package release_updates

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"unicode/utf8"
)

// decodeContractJSON checks exact field spelling, presence, duplicates at every
// depth and nulls before Go's permissive struct decoder can discard evidence.
func decodeContractJSON(data []byte, maximum int, destination any) error {
	if len(data) == 0 || len(data) > maximum || !utf8.Valid(data) {
		return errors.New("invalid JSON size or UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	value, err := readContractJSONValue(decoder, 0)
	if err != nil {
		return err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return errors.New("JSON has trailing content")
	}
	if err := requireContractFields(value, reflect.TypeOf(destination).Elem()); err != nil {
		return err
	}
	decoder = json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return decoder.Decode(destination)
}

func readContractJSONValue(decoder *json.Decoder, depth int) (any, error) {
	if depth > 64 {
		return nil, errors.New("JSON nesting exceeds limit")
	}
	token, err := decoder.Token()
	if err != nil {
		return nil, errors.New("malformed JSON")
	}
	if token == nil {
		return nil, errors.New("null is not a contract value; omit optional fields")
	}
	delimiter, compound := token.(json.Delim)
	if !compound {
		return token, nil
	}
	switch delimiter {
	case '{':
		object := map[string]any{}
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return nil, errors.New("malformed JSON object")
			}
			key, ok := keyToken.(string)
			if !ok {
				return nil, errors.New("invalid JSON key")
			}
			if _, exists := object[key]; exists {
				return nil, fmt.Errorf("duplicate JSON key %q", key)
			}
			value, err := readContractJSONValue(decoder, depth+1)
			if err != nil {
				return nil, err
			}
			object[key] = value
		}
		if close, err := decoder.Token(); err != nil || close != json.Delim('}') {
			return nil, errors.New("malformed JSON object ending")
		}
		return object, nil
	case '[':
		array := []any{}
		for decoder.More() {
			value, err := readContractJSONValue(decoder, depth+1)
			if err != nil {
				return nil, err
			}
			array = append(array, value)
		}
		if close, err := decoder.Token(); err != nil || close != json.Delim(']') {
			return nil, errors.New("malformed JSON array ending")
		}
		return array, nil
	default:
		return nil, errors.New("unexpected JSON delimiter")
	}
}

func requireContractFields(value any, kind reflect.Type) error {
	if kind.Kind() == reflect.Pointer {
		kind = kind.Elem()
	}
	switch kind.Kind() {
	case reflect.Struct:
		object, ok := value.(map[string]any)
		if !ok {
			return errors.New("contract value must be an object")
		}
		fields := map[string]bool{}
		for i := 0; i < kind.NumField(); i++ {
			field := kind.Field(i)
			parts := strings.Split(field.Tag.Get("json"), ",")
			name := parts[0]
			fields[name] = true
			member, exists := object[name]
			optional := len(parts) == 2 && parts[1] == "omitempty"
			if !exists {
				if optional {
					continue
				}
				return fmt.Errorf("missing required JSON field %q", name)
			}
			if err := requireContractFields(member, field.Type); err != nil {
				return fmt.Errorf("field %s: %w", name, err)
			}
		}
		for key := range object {
			if !fields[key] {
				return fmt.Errorf("unknown JSON field %q", key)
			}
		}
	case reflect.Slice:
		array, ok := value.([]any)
		if !ok {
			return errors.New("contract value must be an array")
		}
		for _, member := range array {
			if err := requireContractFields(member, kind.Elem()); err != nil {
				return err
			}
		}
	}
	return nil
}
