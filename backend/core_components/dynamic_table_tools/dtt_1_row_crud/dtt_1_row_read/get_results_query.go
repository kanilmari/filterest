// get_results_query.go
// Builds dynamic SQL queries for table data retrieval.
// Bridges user input, column permissions, and search parameters into SQL WHERE/ORDER/JOIN clauses.
// Exists to construct safe parameterised queries with pagination for the get-results handler.
package dtt_1_row_read

import (
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"

	"github.com/lib/pq"
)

const imageFirstSortColumn = "__images_first"

// ------------------------------------------------------------
// APURI – poistaa "<table>_"‑prefiksin, jos sellainen on.
// ------------------------------------------------------------
func stripTablePrefix(param, tableName string) string {
	prefix := tableName + "_"
	if strings.HasPrefix(param, prefix) {
		return param[len(prefix):]
	}
	return param
}

func sanitizeLanguageParam(lang string) string {
	for _, r := range lang {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') {
			return ""
		}
	}
	return lang
}

// ---------------------------------------------------------------------------
// KORJATTU buildWhereClause – tukee *_from / *_to ja tauluprefiksin.
// ---------------------------------------------------------------------------
func buildWhereClause(
	queryParams url.Values,
	tableName string,
	columnsByName map[string]dtt_models.ColumnInfo,
	columnExpressions map[string]string,
	columnDataTypes map[string]interface{},
) (string, []interface{}, error) {

	var whereClauses []string
	var args []interface{}
	argIdx := 1
	lang := sanitizeLanguageParam(queryParams.Get("lang"))

	for param, values := range queryParams {
		// ohitetaan metaparametrit
		if param == "dataset" || param == "sort_column" || param == "sort_order" || param == "offset" || param == "lang" {
			continue
		}
		if len(values) == 0 {
			continue
		}

		rawValue := values[0]
		plainParamName := stripTablePrefix(param, tableName)
		isExcludeFilter := strings.HasSuffix(plainParamName, "_exclude")
		logicalParamName := plainParamName
		if isExcludeFilter {
			logicalParamName = strings.TrimSuffix(plainParamName, "_exclude")
		}

		// -------- 1) *_from / *_to  (>= / <=) ----------------------------
		if strings.HasSuffix(logicalParamName, "_from") || strings.HasSuffix(logicalParamName, "_to") {
			var op string
			var colBase string

			if strings.HasSuffix(logicalParamName, "_from") {
				op = ">="
				colBase = strings.TrimSuffix(logicalParamName, "_from")
			} else {
				op = "<="
				colBase = strings.TrimSuffix(logicalParamName, "_to")
			}

			// varmista että sarake on sallittu
			if _, ok := columnsByName[colBase]; !ok {
				continue
			}

			colExpr := fmt.Sprintf("%s.%s",
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(colBase),
			)

			whereClauses = append(
				whereClauses,
				fmt.Sprintf("%s %s $%d", colExpr, op, argIdx),
			)
			args = append(args, rawValue)
			argIdx++
			continue
		}

		// -------- 2) Normaali haku ILIKE‑tokeneilla ----------------------
		targetColumn := ""

		if expr, ok := columnExpressions[logicalParamName]; ok {
			targetColumn = expr
		} else if colInfo, ok := columnsByName[logicalParamName]; ok {
			quotedTable := pq.QuoteIdentifier(tableName)
			quotedColumn := pq.QuoteIdentifier(logicalParamName)
			effectiveLang := lang
			if effectiveLang == "" && colInfo.IsMultilingual {
				effectiveLang = "en"
			}
			if effectiveLang != "" && (colInfo.DataType == "json" || colInfo.DataType == "jsonb" || colInfo.IsMultilingual) {
				if colInfo.IsMultilingual && colInfo.DataType != "json" && colInfo.DataType != "jsonb" {
					// Safe cast: only extract from rows that look like JSON, fall back to raw text
					targetColumn = fmt.Sprintf(
						"CASE WHEN %s.%s LIKE '{%%' AND %s.%s LIKE '%%}' THEN (%s.%s)::jsonb->>'%s' ELSE %s.%s END",
						quotedTable, quotedColumn, quotedTable, quotedColumn, quotedTable, quotedColumn, effectiveLang, quotedTable, quotedColumn,
					)
				} else {
					targetColumn = fmt.Sprintf("%s.%s->>'%s'", quotedTable, quotedColumn, effectiveLang)
				}
			} else {
				targetColumn = fmt.Sprintf("%s.%s", quotedTable, quotedColumn)
			}
		} else {
			// tuntematon parametri → ohita
			continue
		}

		var colType string
		if info, ok := columnDataTypes[logicalParamName]; ok {
			if m, ok := info.(map[string]interface{}); ok {
				if dt, ok := m["data_type"].(string); ok {
					colType = dt
				}
			}
		}

		// -------- 2b) Comma-separated IN-list ------------------------------
		if strings.Contains(rawValue, ",") && !strings.ContainsAny(rawValue, " \"'") {
			parts := strings.Split(rawValue, ",")
			if len(parts) > 1 {
				isInt := strings.Contains(colType, "int")
				placeholders := make([]string, 0, len(parts))
				inArgs := make([]interface{}, 0, len(parts))
				startIdx := argIdx
				valid := true

				for _, p := range parts {
					p = strings.TrimSpace(p)
					if p == "" {
						valid = false
						break
					}
					if isInt {
						if intVal, err := strconv.Atoi(p); err == nil {
							placeholders = append(placeholders, fmt.Sprintf("$%d", argIdx))
							inArgs = append(inArgs, intVal)
						} else {
							valid = false
							break
						}
					} else {
						placeholders = append(placeholders, fmt.Sprintf("$%d", argIdx))
						inArgs = append(inArgs, p)
					}
					argIdx++
				}

				if valid && len(placeholders) > 0 {
					whereClauses = append(whereClauses,
						fmt.Sprintf(
							"%s %s (%s)",
							targetColumn,
							map[bool]string{true: "NOT IN", false: "IN"}[isExcludeFilter],
							strings.Join(placeholders, ", "),
						),
					)
					args = append(args, inArgs...)
					continue
				}
				argIdx = startIdx
			}
		}

		if isExcludeFilter {
			lowerVal := strings.ToLower(rawValue)
			if colType == "boolean" && (lowerVal == "true" || lowerVal == "false") {
				whereClauses = append(whereClauses, fmt.Sprintf("%s <> $%d", targetColumn, argIdx))
				args = append(args, lowerVal == "true")
				argIdx++
				continue
			}
			if strings.Contains(colType, "int") {
				if intVal, err := strconv.Atoi(rawValue); err == nil {
					whereClauses = append(whereClauses, fmt.Sprintf("%s <> $%d", targetColumn, argIdx))
					args = append(args, intVal)
					argIdx++
					continue
				}
			}

			whereClauses = append(whereClauses, fmt.Sprintf("%s <> $%d", targetColumn, argIdx))
			args = append(args, rawValue)
			argIdx++
			continue
		}

		tokens := parseAdvancedSearch(rawValue)
		if len(tokens) == 0 {
			continue
		}

		cond, condArgs, nextIdx := buildConditionForTokens(targetColumn, tokens, argIdx, colType)
		if cond != "" {
			whereClauses = append(whereClauses, cond)
			args = append(args, condArgs...)
			argIdx = nextIdx
		}
	}

	finalWhere := ""
	if len(whereClauses) > 0 {
		finalWhere = " WHERE " + strings.Join(whereClauses, " AND ")
	}
	return finalWhere, args, nil
}

// buildOrderByClause hakee sort_column ja sort_order -parametrit.
func buildOrderByClause(
	queryParams url.Values,
	tableName string,
	columnsByName map[string]dtt_models.ColumnInfo,
	columnExpressions map[string]string,
) (string, error) {

	sortColumn := queryParams.Get("sort_column")
	sortOrder := strings.ToUpper(queryParams.Get("sort_order"))
	lang := sanitizeLanguageParam(queryParams.Get("lang"))

	if sortColumn == "" {
		return "", nil
	}
	if sortOrder != "ASC" && sortOrder != "DESC" {
		sortOrder = "ASC"
	}
	if sortColumn == imageFirstSortColumn {
		return buildImageFirstOrderByClause(tableName, columnsByName), nil
	}

	var columnName string
	if expr, ok := columnExpressions[sortColumn]; ok {
		columnName = expr
	} else if colInfo, exists := columnsByName[sortColumn]; exists {
		quotedTable := pq.QuoteIdentifier(tableName)
		quotedColumn := pq.QuoteIdentifier(sortColumn)
		effectiveLang := lang
		if effectiveLang == "" && colInfo.IsMultilingual {
			effectiveLang = "en"
		}
		if effectiveLang != "" && (colInfo.DataType == "json" || colInfo.DataType == "jsonb" || colInfo.IsMultilingual) {
			if colInfo.IsMultilingual && colInfo.DataType != "json" && colInfo.DataType != "jsonb" {
				// Safe cast: only extract from rows that look like JSON, fall back to raw text
				columnName = fmt.Sprintf(
					"CASE WHEN %s.%s LIKE '{%%' AND %s.%s LIKE '%%}' THEN (%s.%s)::jsonb->>'%s' ELSE %s.%s END",
					quotedTable, quotedColumn, quotedTable, quotedColumn, quotedTable, quotedColumn, effectiveLang, quotedTable, quotedColumn,
				)
			} else {
				columnName = fmt.Sprintf("%s.%s->>'%s'", quotedTable, quotedColumn, effectiveLang)
			}
		} else {
			columnName = fmt.Sprintf("%s.%s", quotedTable, quotedColumn)
		}
	} else {
		return "", nil
	}

	orderByParts := []string{fmt.Sprintf("%s %s", columnName, sortOrder)}
	if sortColumn != "id" {
		if _, hasIDColumn := columnsByName["id"]; hasIDColumn {
			orderByParts = append(
				orderByParts,
				fmt.Sprintf("%s.%s %s", pq.QuoteIdentifier(tableName), pq.QuoteIdentifier("id"), sortOrder),
			)
		}
	}

	orderByClause := fmt.Sprintf(" ORDER BY %s", strings.Join(orderByParts, ", "))
	return orderByClause, nil
}

func buildImageFirstOrderByClause(
	tableName string,
	columnsByName map[string]dtt_models.ColumnInfo,
) string {
	type imageColumn struct {
		name     string
		coNumber int
	}

	imageColumns := make([]imageColumn, 0)
	for columnName, columnInfo := range columnsByName {
		if !strings.Contains(strings.ToLower(strings.TrimSpace(columnInfo.CardElement)), "image") &&
			!strings.EqualFold(strings.TrimSpace(columnInfo.DataType), "image") {
			continue
		}
		imageColumns = append(imageColumns, imageColumn{name: columnName, coNumber: columnInfo.CoNumber})
	}
	sort.SliceStable(imageColumns, func(left, right int) bool {
		if imageColumns[left].coNumber == imageColumns[right].coNumber {
			return imageColumns[left].name < imageColumns[right].name
		}
		return imageColumns[left].coNumber < imageColumns[right].coNumber
	})

	quotedTable := pq.QuoteIdentifier(tableName)
	orderByParts := make([]string, 0, 2)
	if len(imageColumns) > 0 {
		presenceChecks := make([]string, 0, len(imageColumns))
		for _, column := range imageColumns {
			presenceChecks = append(
				presenceChecks,
				fmt.Sprintf(
					"NULLIF(BTRIM(%s.%s::text), '') IS NOT NULL",
					quotedTable,
					pq.QuoteIdentifier(column.name),
				),
			)
		}
		orderByParts = append(
			orderByParts,
			fmt.Sprintf("CASE WHEN %s THEN 0 ELSE 1 END ASC", strings.Join(presenceChecks, " OR ")),
		)
	}
	if _, hasIDColumn := columnsByName["id"]; hasIDColumn {
		orderByParts = append(orderByParts, fmt.Sprintf("%s.%s DESC", quotedTable, pq.QuoteIdentifier("id")))
	}
	if len(orderByParts) == 0 {
		return ""
	}

	return fmt.Sprintf(" ORDER BY %s", strings.Join(orderByParts, ", "))
}

// buildConditionForTokens rakentaa ehdon annetuista hakutokeneista (ILIKE, NOT ILIKE, jne.)
func buildConditionForTokens(
	columnName string,
	tokens []Token,
	argIndex int,
	columnType string,
) (string, []interface{}, int) {

	var exprParts []string
	var args []interface{}
	currentOp := "AND"

	for _, t := range tokens {
		switch t.Type {
		case TokenAnd:
			currentOp = "AND"
		case TokenOr:
			currentOp = "OR"
		case TokenAll:
			exprParts = append(exprParts, currentOp, "TRUE")
		case TokenExclude:
			if t.Value == "" {
				expr := fmt.Sprintf("(%s IS NOT NULL AND %s <> '')", columnName, columnName)
				exprParts = append(exprParts, currentOp, expr)
			} else {
				lowerVal := strings.ToLower(t.Value)
				if columnType == "boolean" && (lowerVal == "true" || lowerVal == "false") {
					boolVal := lowerVal == "true"
					expr := fmt.Sprintf("%s <> $%d", columnName, argIndex)
					exprParts = append(exprParts, currentOp, expr)
					args = append(args, boolVal)
					argIndex++
				} else if strings.Contains(columnType, "int") && !strings.ContainsAny(t.Value, "*%") {
					if intVal, err := strconv.Atoi(t.Value); err == nil {
						expr := fmt.Sprintf("%s <> $%d", columnName, argIndex)
						exprParts = append(exprParts, currentOp, expr)
						args = append(args, intVal)
						argIndex++
					} else {
						v := strings.ReplaceAll(t.Value, "*", "%")
						expr := fmt.Sprintf("%s::text NOT ILIKE $%d", columnName, argIndex)
						exprParts = append(exprParts, currentOp, expr)
						args = append(args, "%"+v+"%")
						argIndex++
					}
				} else {
					v := strings.ReplaceAll(t.Value, "*", "%")
					expr := fmt.Sprintf("%s::text NOT ILIKE $%d", columnName, argIndex)
					exprParts = append(exprParts, currentOp, expr)
					args = append(args, "%"+v+"%")
					argIndex++
				}
			}
		case TokenInclude:
			if t.Value == "" {
				expr := fmt.Sprintf("(%s IS NULL OR %s = '')", columnName, columnName)
				exprParts = append(exprParts, currentOp, expr)
			} else {
				lowerVal := strings.ToLower(t.Value)
				if columnType == "boolean" && (lowerVal == "true" || lowerVal == "false") {
					boolVal := lowerVal == "true"
					expr := fmt.Sprintf("%s = $%d", columnName, argIndex)
					exprParts = append(exprParts, currentOp, expr)
					args = append(args, boolVal)
					argIndex++
				} else if strings.Contains(columnType, "int") && !strings.ContainsAny(t.Value, "*%") {
					if intVal, err := strconv.Atoi(t.Value); err == nil {
						expr := fmt.Sprintf("%s = $%d", columnName, argIndex)
						exprParts = append(exprParts, currentOp, expr)
						args = append(args, intVal)
						argIndex++
					} else {
						v := strings.ReplaceAll(t.Value, "*", "%")
						expr := fmt.Sprintf("%s::text ILIKE $%d", columnName, argIndex)
						exprParts = append(exprParts, currentOp, expr)
						args = append(args, "%"+v+"%")
						argIndex++
					}
				} else {
					v := strings.ReplaceAll(t.Value, "*", "%")
					expr := fmt.Sprintf("%s::text ILIKE $%d", columnName, argIndex)
					exprParts = append(exprParts, currentOp, expr)
					args = append(args, "%"+v+"%")
					argIndex++
				}
			}
		}
	}

	if len(exprParts) == 0 {
		return "", nil, argIndex
	}
	if exprParts[0] == "AND" || exprParts[0] == "OR" {
		exprParts = exprParts[1:]
	}
	finalExpr := "(" + strings.Join(exprParts, " ") + ")"
	return finalExpr, args, argIndex
}

// BuildSelectQuery constructs the full SQL query including SELECT, JOIN, WHERE, ORDER BY, LIMIT, and OFFSET.
// It also executes a count query to get the total number of rows matching the filters.
func BuildSelectQuery(ctx QueryBuilderContext) (string, []interface{}, int, error) {
	// 1. Build SELECT and JOIN parts
	selectColumns, joinClauses, columnExpressions, err := buildJoinsWith1MRelations(
		ctx.DB,
		ctx.TableName,
		ctx.ColumnsMap,
		ctx.VisibleColUIDs,
	)
	if err != nil {
		return "", nil, 0, fmt.Errorf("error building joins: %w", err)
	}

	// 2. Build WHERE clause
	where_clause, query_args, err := buildWhereClause(
		ctx.QueryParams,
		ctx.TableName,
		buildColumnsByName(ctx.ColumnsMap),
		columnExpressions,
		ctx.ColumnDataTypes,
	)
	if err != nil {
		return "", nil, 0, fmt.Errorf("error building where clause: %w", err)
	}

	// 3. Build ORDER BY clause
	order_by_clause, err := buildOrderByClause(
		ctx.QueryParams,
		ctx.TableName,
		buildColumnsByName(ctx.ColumnsMap),
		columnExpressions,
	)
	if err != nil {
		return "", nil, 0, fmt.Errorf("error building order by clause: %w", err)
	}

	// 4. Handle row visibility policy columns.
	where_clause, query_args = appendReadPolicyToWhereClause(
		ctx.TableName,
		ctx.UserRole,
		ctx.UserID,
		ctx.ReadPolicy,
		where_clause,
		query_args,
	)

	// 5. Count total rows (skip if client provides a cached count)
	var rowCount int
	if ctx.ClientRowCount >= 0 {
		rowCount = ctx.ClientRowCount
	} else {
		countQuery := fmt.Sprintf("SELECT COUNT(*) FROM %s %s%s", pq.QuoteIdentifier(ctx.TableName), joinClauses, where_clause)
		if err := ctx.DB.QueryRow(countQuery, query_args...).Scan(&rowCount); err != nil {
			return "", nil, 0, fmt.Errorf("error counting rows: %w", err)
		}
	}

	// 6. Construct final query
	query := fmt.Sprintf(
		"SELECT %s FROM %s %s%s%s LIMIT %d OFFSET %d",
		selectColumns,
		pq.QuoteIdentifier(ctx.TableName),
		joinClauses,
		where_clause,
		order_by_clause,
		ctx.ResultsPerLoad,
		ctx.Offset,
	)

	return query, query_args, rowCount, nil
}
