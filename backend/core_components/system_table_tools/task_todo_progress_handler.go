// task_todo_progress_handler.go
// Reads structured task todo progress for article-view status visuals.
// Bridges dev_agent_tasks rows, dev_agent_task_todos statuses, and row-article UI payloads.
// Exists so the frontend can render progress without knowing todo status table internals.
package system_table_tools

import (
	"database/sql"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/permissions"
	e_sessions "easelect/backend/core_components/sessions"
)

const taskTodoProgressDataset = "dev_agent_tasks"
const taskTodoProgressReadRoute = "/api/get-results"

type taskTodoProgressTableRef struct {
	TableUID int64
	Dataset  string
}

type taskTodoStatusCount struct {
	Slug               string `json:"slug"`
	Title              string `json:"title"`
	Count              int64  `json:"count"`
	IsCompletionStatus bool   `json:"is_completion_status"`
}

type taskTodoProgressResponse struct {
	Dataset     string                `json:"dataset"`
	RowID       int64                 `json:"row_id"`
	Total       int64                 `json:"total"`
	Completed   int64                 `json:"completed"`
	Percent     int64                 `json:"percent"`
	LitSegments int64                 `json:"lit_segments"`
	Statuses    []taskTodoStatusCount `json:"statuses"`
}

// GetTaskTodoProgressHandler returns todo completion progress for one dev_agent_tasks row.
// It operates between article-view requests and the task todo tables.
// It exists to keep status visual calculation server-side and permission-aware.
func GetTaskTodoProgressHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	tableRef, rowID, err := resolveTaskTodoProgressRequestTarget(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	if tableRef.Dataset != taskTodoProgressDataset {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "task progress only supports dev_agent_tasks")
		return
	}

	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "user session required")
		return
	}
	canReadTask, err := userCanReadTaskTodoProgressTable(tableRef.TableUID, userID)
	if err != nil {
		log.Printf("\033[31merror: [GetTaskTodoProgressHandler] permission check failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error checking task permissions")
		return
	}
	if !canReadTask {
		httpresponse.RespondWithError(w, http.StatusForbidden, "missing task read permission")
		return
	}

	statuses, err := listTaskTodoStatusCounts(rowID)
	if err != nil {
		log.Printf("\033[31merror: [GetTaskTodoProgressHandler] progress query failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching task todo progress")
		return
	}

	total, completed, percent, litSegments := summarizeTaskTodoProgress(statuses)
	httpresponse.RespondWithJSON(w, http.StatusOK, taskTodoProgressResponse{
		Dataset:     tableRef.Dataset,
		RowID:       rowID,
		Total:       total,
		Completed:   completed,
		Percent:     percent,
		LitSegments: litSegments,
		Statuses:    statuses,
	})
}

// listTaskTodoStatusCounts aggregates todo rows by status for one task.
// It operates between dev_agent_task_todos and the lightweight response model.
// It exists so unknown future statuses still show as counts instead of breaking the visual.
func listTaskTodoStatusCounts(taskID int64) ([]taskTodoStatusCount, error) {
	rows, err := backend.Db.Query(`
		SELECT
			todos.status,
			COALESCE(NULLIF(statuses.title, ''), todos.status) AS status_title,
			COALESCE(statuses.is_completion_status, todos.status = 'done') AS is_completion_status,
			COUNT(*) AS status_count
		FROM dev_agent_task_todos todos
		LEFT JOIN dev_agent_task_todo_statuses statuses ON statuses.slug = todos.status
		WHERE todos.task_id = $1
		GROUP BY todos.status, statuses.title, statuses.is_completion_status
		ORDER BY MIN(todos.sort_order), todos.status
	`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	statuses := []taskTodoStatusCount{}
	for rows.Next() {
		var status taskTodoStatusCount
		var title sql.NullString
		if err := rows.Scan(
			&status.Slug,
			&title,
			&status.IsCompletionStatus,
			&status.Count,
		); err != nil {
			return nil, err
		}
		status.Title = nullableTaskTodoProgressString(title)
		if status.Title == "" {
			status.Title = status.Slug
		}
		statuses = append(statuses, status)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return statuses, nil
}

// resolveTaskTodoProgressRequestTarget resolves the requested task dataset and row.
// It keeps the progress route independent of the retired generic row-link subsystem.
func resolveTaskTodoProgressRequestTarget(r *http.Request) (taskTodoProgressTableRef, int64, error) {
	tableName := strings.TrimSpace(r.URL.Query().Get("dataset"))
	if tableName == "" {
		tableName = strings.TrimSpace(r.URL.Query().Get("table"))
	}

	tableUID, err := parseTaskTodoProgressOptionalID(r.URL.Query().Get("dataset_uid"))
	if err != nil {
		return taskTodoProgressTableRef{}, 0, fmt.Errorf("dataset_uid must be numeric")
	}
	if tableUID == 0 {
		tableUID, err = parseTaskTodoProgressOptionalID(r.URL.Query().Get("table_uid"))
		if err != nil {
			return taskTodoProgressTableRef{}, 0, fmt.Errorf("table_uid must be numeric")
		}
	}

	rowIDValue := strings.TrimSpace(r.URL.Query().Get("id"))
	if rowIDValue == "" {
		rowIDValue = strings.TrimSpace(r.URL.Query().Get("row_id"))
	}
	rowID, err := parseTaskTodoProgressOptionalID(rowIDValue)
	if err != nil {
		return taskTodoProgressTableRef{}, 0, fmt.Errorf("id must be numeric")
	}
	if rowID <= 0 {
		return taskTodoProgressTableRef{}, 0, fmt.Errorf("id is required")
	}
	if tableUID <= 0 && tableName == "" {
		return taskTodoProgressTableRef{}, 0, fmt.Errorf("dataset or table_uid is required")
	}
	if tableName != "" && !backend.ShouldExposeCloudManagementDatasetName(tableName) {
		return taskTodoProgressTableRef{}, 0, fmt.Errorf("dataset not found")
	}

	var tableRef taskTodoProgressTableRef
	var query string
	var queryArg any
	if tableUID > 0 {
		query = `SELECT table_uid, table_name FROM system_db_tables WHERE table_uid = $1 LIMIT 1`
		queryArg = tableUID
	} else {
		query = `
			SELECT table_uid, table_name
			FROM system_db_tables
			WHERE table_name = $1
			  AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
			LIMIT 1`
		queryArg = tableName
	}
	if err := backend.Db.QueryRow(query, queryArg).Scan(&tableRef.TableUID, &tableRef.Dataset); err != nil {
		if err == sql.ErrNoRows {
			return taskTodoProgressTableRef{}, 0, fmt.Errorf("dataset not found")
		}
		return taskTodoProgressTableRef{}, 0, err
	}
	if !backend.ShouldExposeCloudManagementDatasetName(tableRef.Dataset) {
		return taskTodoProgressTableRef{}, 0, fmt.Errorf("dataset not found")
	}
	return tableRef, rowID, nil
}

func parseTaskTodoProgressOptionalID(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, nil
	}
	return strconv.ParseInt(value, 10, 64)
}

func userCanReadTaskTodoProgressTable(tableUID int64, userID int) (bool, error) {
	return permissions.CheckRouteTablePermission(
		backend.Db,
		taskTodoProgressReadRoute,
		userID,
		permissions.RouteTableScope{TableUID: strconv.FormatInt(tableUID, 10)},
		permissions.AccessControlRouteTableOptions(false),
	)
}

func nullableTaskTodoProgressString(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return strings.TrimSpace(value.String)
}

// summarizeTaskTodoProgress converts status counts into percent and 10-light segment values.
// It operates between raw completion-status counts and compact article-view display values.
// It exists so rounding and whole-ten lighting stay deterministic across UI callers.
func summarizeTaskTodoProgress(statuses []taskTodoStatusCount) (total int64, completed int64, percent int64, litSegments int64) {
	for _, status := range statuses {
		if status.Count <= 0 {
			continue
		}
		total += status.Count
		if status.IsCompletionStatus {
			completed += status.Count
		}
	}
	if total <= 0 {
		return 0, 0, 0, 0
	}

	percent = int64(math.Round((float64(completed) / float64(total)) * 100))
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	litSegments = percent / 10
	if completed >= total {
		litSegments = 10
	}
	if litSegments > 10 {
		litSegments = 10
	}

	sort.SliceStable(statuses, func(left, right int) bool {
		if statuses[left].IsCompletionStatus != statuses[right].IsCompletionStatus {
			return !statuses[left].IsCompletionStatus
		}
		return statuses[left].Slug < statuses[right].Slug
	})
	return total, completed, percent, litSegments
}
