// data_retention_policy_reader.go
// Reads and validates configurable data-retention policies from system_config JSON.
// Bridges operator-managed retention rules and the allowed table/column registry used by the backend pruner.
// Exists so retention behavior stays configurable without opening an arbitrary-SQL surface.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/reusable_components/setting_duration"
)

const (
	dataRetentionPoliciesConfigKey         = "data_retention_policies"
	automaticDataRetentionEnabledConfigKey = "automatic_data_retention_enabled"
	dataRetentionModeRollingYears          = "rolling_years"
	dataRetentionModeRollingDays           = "rolling_days"
	dataRetentionModeCalendarYearsCurrent  = "calendar_years_plus_current"
)

type dataRetentionPolicyConfig struct {
	Name            string          `json:"name"`
	Enabled         *bool           `json:"enabled,omitempty"`
	TableName       string          `json:"table_name"`
	TimestampColumn string          `json:"timestamp_column"`
	FilterColumn    string          `json:"filter_column,omitempty"`
	FilterValue     json.RawMessage `json:"filter_value,omitempty"`
	Mode            string          `json:"mode"`
	KeepYears       int             `json:"keep_years"`
	KeepDays        int             `json:"keep_days,omitempty"`
	Description     string          `json:"description,omitempty"`
}

type dataRetentionPolicy struct {
	Name             string
	Enabled          bool
	TableName        string
	TimestampColumn  string
	FilterColumn     string
	FilterValue      any
	FilterValueLabel string
	Mode             string
	KeepYears        int
	KeepDays         int
	Description      string
}

type dataRetentionTableSpec struct {
	TableName               string
	AllowedTimestampColumns map[string]bool
	AllowedFilterColumns    map[string]string
	DeleteStrategy          string
}

var dataRetentionTableSpecs = buildDataRetentionTableSpecs()

// The policy array retains its legacy fields; its durations use the shared
// parser instead of pretending the whole array is one number/unit setting.
var dataRetentionDurationDefinition = setting_duration.Definition{
	AmountField: "amount", UnitField: "unit",
	Bounds: map[string]setting_duration.Bounds{
		"days": {Min: 1, Max: 106751}, "years": {Min: 1, Max: 10000},
	},
}

func buildDataRetentionTableSpecs() map[string]dataRetentionTableSpec {
	specs := map[string]dataRetentionTableSpec{
		"regfetch_conversations": {
			TableName: "regfetch_conversations",
			AllowedTimestampColumns: map[string]bool{
				"created_at": true,
				"updated_at": true,
			},
			AllowedFilterColumns: map[string]string{
				"email_hash": "text",
				"session_id": "text",
			},
			DeleteStrategy: "generic",
		},
		"ai_chat_conversations": {
			TableName: "ai_chat_conversations",
			AllowedTimestampColumns: map[string]bool{
				"created_at": true,
				"updated_at": true,
			},
			AllowedFilterColumns: map[string]string{
				"dataset": "text",
				"user_id": "int",
			},
			DeleteStrategy: "generic",
		},
		"dev_agent_tasks": {
			TableName: "dev_agent_tasks",
			AllowedTimestampColumns: map[string]bool{
				"created": true,
				"updated": true,
			},
			AllowedFilterColumns: map[string]string{
				"queue_id": "int",
			},
			DeleteStrategy: "ticket_with_related_comments",
		},
	}
	// Reuse the manual registry's names and clocks. Deletion tombstones prevent
	// old exports restoring deleted content, so they have no automatic expiry.
	for name, logSpec := range logRetentionTableSpecs {
		if name == "deletion_log" {
			continue
		}
		specs[name] = dataRetentionTableSpec{
			TableName:               name,
			AllowedTimestampColumns: map[string]bool{logSpec.TimestampColumn: true},
			DeleteStrategy:          dataRetentionDeleteStrategyLogBatch,
		}
	}
	return specs
}

// loadDataRetentionPolicies reads and validates the configured retention policies.
func loadDataRetentionPolicies(q dbutils.Querier) ([]dataRetentionPolicy, error) {
	var rawConfig []byte
	err := q.QueryRow(`
		SELECT json_value
		FROM system_config
		WHERE key = $1
	`, dataRetentionPoliciesConfigKey).Scan(&rawConfig)
	if err != nil {
		if err == sql.ErrNoRows {
			return []dataRetentionPolicy{}, nil
		}
		return nil, fmt.Errorf("read %s failed: %w", dataRetentionPoliciesConfigKey, err)
	}
	return parseDataRetentionPolicies(rawConfig)
}

// isAutomaticDataRetentionEnabled checks whether the automatic retention loop should run.
func isAutomaticDataRetentionEnabled(q dbutils.Querier) (bool, error) {
	var enabled bool
	err := q.QueryRow(`
		SELECT boolean_value
		FROM system_config
		WHERE key = $1
	`, automaticDataRetentionEnabledConfigKey).Scan(&enabled)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("read %s failed: %w", automaticDataRetentionEnabledConfigKey, err)
	}
	return enabled, nil
}

func parseDataRetentionPolicies(rawConfig []byte) ([]dataRetentionPolicy, error) {
	trimmed := strings.TrimSpace(string(rawConfig))
	if trimmed == "" || trimmed == "null" {
		return []dataRetentionPolicy{}, nil
	}

	var configs []dataRetentionPolicyConfig
	if err := json.Unmarshal(rawConfig, &configs); err != nil {
		return nil, fmt.Errorf("invalid %s JSON: %w", dataRetentionPoliciesConfigKey, err)
	}

	policies := make([]dataRetentionPolicy, 0, len(configs))
	seenNames := make(map[string]bool, len(configs))
	seenTables := make(map[string]bool, len(configs))
	for index, cfg := range configs {
		policy, err := normalizeDataRetentionPolicy(cfg)
		if err != nil {
			return nil, fmt.Errorf("policy #%d invalid: %w", index+1, err)
		}
		normalizedName := normalizeDataRetentionIdentity(policy.Name)
		if seenNames[normalizedName] {
			return nil, fmt.Errorf("duplicate policy name %q", policy.Name)
		}
		// Two policies must never compete over an opt-out, clock or duration.
		// Refuse the configuration before any policy can delete rows.
		if seenTables[policy.TableName] {
			return nil, fmt.Errorf("duplicate policy table %q", policy.TableName)
		}
		seenTables[policy.TableName] = true
		seenNames[normalizedName] = true
		policies = append(policies, policy)
	}

	return policies, nil
}

// normalizeDataRetentionIdentity defines table identity and case-insensitive
// policy-name equality. The migration uses the same rule for ASCII identities;
// data_retention_identity_test.go proves parity across all Unicode whitespace
// and every rune Go lowercases to ASCII.
func normalizeDataRetentionIdentity(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeDataRetentionPolicy(cfg dataRetentionPolicyConfig) (dataRetentionPolicy, error) {
	name := strings.TrimSpace(cfg.Name)
	if name == "" {
		return dataRetentionPolicy{}, fmt.Errorf("name is required")
	}

	tableName := normalizeDataRetentionIdentity(cfg.TableName)
	spec, ok := dataRetentionTableSpecs[tableName]
	if !ok {
		return dataRetentionPolicy{}, fmt.Errorf("table_name %q is not allowlisted", cfg.TableName)
	}

	timestampColumn := strings.ToLower(strings.TrimSpace(cfg.TimestampColumn))
	if timestampColumn == "" {
		return dataRetentionPolicy{}, fmt.Errorf("timestamp_column is required")
	}
	if !spec.AllowedTimestampColumns[timestampColumn] {
		return dataRetentionPolicy{}, fmt.Errorf("timestamp_column %q is not allowed for %s", cfg.TimestampColumn, spec.TableName)
	}

	mode := strings.ToLower(strings.TrimSpace(cfg.Mode))
	amount, unit := cfg.KeepYears, "years"
	switch mode {
	case dataRetentionModeRollingDays:
		amount, unit = cfg.KeepDays, "days"
		if cfg.KeepYears != 0 {
			return dataRetentionPolicy{}, fmt.Errorf("rolling_days cannot have keep_years")
		}
	case dataRetentionModeRollingYears, dataRetentionModeCalendarYearsCurrent:
		if cfg.KeepDays != 0 {
			return dataRetentionPolicy{}, fmt.Errorf("year modes cannot have keep_days")
		}
	default:
		return dataRetentionPolicy{}, fmt.Errorf("unknown retention mode %q", cfg.Mode)
	}
	if _, err := setting_duration.Parse(map[string]any{"amount": amount, "unit": unit}, dataRetentionDurationDefinition); err != nil {
		return dataRetentionPolicy{}, fmt.Errorf("invalid retention duration: %w", err)
	}

	filterColumn := strings.ToLower(strings.TrimSpace(cfg.FilterColumn))
	filterValueType := ""
	if filterColumn != "" {
		var allowed bool
		filterValueType, allowed = spec.AllowedFilterColumns[filterColumn]
		if !allowed {
			return dataRetentionPolicy{}, fmt.Errorf("filter_column %q is not allowed for %s", cfg.FilterColumn, spec.TableName)
		}
	}

	filterValue, filterValueLabel, err := normalizeDataRetentionFilterValue(cfg.FilterValue, filterValueType)
	if err != nil {
		return dataRetentionPolicy{}, err
	}
	if filterColumn == "" && filterValue != nil {
		return dataRetentionPolicy{}, fmt.Errorf("filter_value requires filter_column")
	}
	if filterColumn != "" && filterValue == nil {
		return dataRetentionPolicy{}, fmt.Errorf("filter_column %q requires filter_value", filterColumn)
	}

	enabled := true
	if cfg.Enabled != nil {
		enabled = *cfg.Enabled
	}

	return dataRetentionPolicy{
		Name:             name,
		Enabled:          enabled,
		TableName:        spec.TableName,
		TimestampColumn:  timestampColumn,
		FilterColumn:     filterColumn,
		FilterValue:      filterValue,
		FilterValueLabel: filterValueLabel,
		Mode:             mode,
		KeepYears:        cfg.KeepYears,
		KeepDays:         cfg.KeepDays,
		Description:      strings.TrimSpace(cfg.Description),
	}, nil
}

func normalizeDataRetentionFilterValue(raw json.RawMessage, valueType string) (any, string, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil, "", nil
	}

	switch valueType {
	case "int":
		var integerValue int64
		if err := json.Unmarshal(raw, &integerValue); err == nil {
			return integerValue, fmt.Sprintf("%d", integerValue), nil
		}

		var stringValue string
		if err := json.Unmarshal(raw, &stringValue); err == nil {
			parsed, parseErr := parseDataRetentionIntValue(stringValue)
			if parseErr != nil {
				return nil, "", parseErr
			}
			return parsed, fmt.Sprintf("%d", parsed), nil
		}

		return nil, "", fmt.Errorf("integer filter_value is required")
	case "text":
		var stringValue string
		if err := json.Unmarshal(raw, &stringValue); err == nil {
			trimmedValue := strings.TrimSpace(stringValue)
			if trimmedValue == "" {
				return nil, "", fmt.Errorf("text filter_value cannot be empty")
			}
			return trimmedValue, trimmedValue, nil
		}

		return nil, "", fmt.Errorf("text filter_value is required")
	default:
		return nil, "", nil
	}
}

func parseDataRetentionIntValue(raw string) (int64, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, fmt.Errorf("integer filter_value cannot be empty")
	}

	var value int64
	if _, err := fmt.Sscanf(trimmed, "%d", &value); err != nil {
		return 0, fmt.Errorf("invalid integer filter_value %q", raw)
	}
	return value, nil
}

func resolveDataRetentionPolicyCutoff(policy dataRetentionPolicy, now time.Time) time.Time {
	localNow := now.In(time.Local)

	switch policy.Mode {
	case dataRetentionModeRollingDays:
		cutoff, _ := (setting_duration.Value{Amount: policy.KeepDays, Unit: "days"}).SubtractFrom(now)
		return cutoff
	case dataRetentionModeCalendarYearsCurrent:
		return time.Date(localNow.Year()-policy.KeepYears, time.January, 1, 0, 0, 0, 0, time.Local)
	case dataRetentionModeRollingYears:
		fallthrough
	default:
		cutoff, _ := (setting_duration.Value{Amount: policy.KeepYears, Unit: "years"}).SubtractFrom(localNow)
		return cutoff
	}
}

func resolveRequestedDataRetentionPolicies(raw []string, allPolicies []dataRetentionPolicy) ([]dataRetentionPolicy, error) {
	if len(raw) == 0 {
		return append([]dataRetentionPolicy(nil), allPolicies...), nil
	}

	policiesByName := make(map[string]dataRetentionPolicy, len(allPolicies))
	for _, policy := range allPolicies {
		policiesByName[strings.ToLower(policy.Name)] = policy
	}

	selected := make([]dataRetentionPolicy, 0, len(raw))
	seen := make(map[string]bool, len(raw))
	for _, item := range raw {
		name := strings.ToLower(strings.TrimSpace(item))
		if name == "" || seen[name] {
			continue
		}
		policy, ok := policiesByName[name]
		if !ok {
			return nil, fmt.Errorf("unknown data retention policy %q", item)
		}
		seen[name] = true
		selected = append(selected, policy)
	}
	if len(selected) == 0 {
		return nil, fmt.Errorf("no valid data retention policies requested")
	}
	return selected, nil
}
