// workline_handlers.go
// Serves stable development worklines and their optional DB-backed ticket links.
// Bridges authenticated Agent Tools requests with dev_agent_worklines and relation rows.
// Exists so reports have durable identities independent from chats and mutable ticket descriptions.
package agent_tools

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/event_bus"
	"easelect/backend/core_components/httpresponse"

	"github.com/lib/pq"
)

const (
	agentWorklineTableName     = "dev_agent_worklines"
	agentWorklineTaskTableName = "dev_agent_workline_tasks"
)

const worklineColumns = `w.id, w.title, w.status, w.status_changed_by, COALESCE(status_user.username, ''), w.status_changed_at, w.status_change_source, w.status_revision, w.tags, w.created_by, COALESCE(created_user.username, ''), w.created, w.updated, (SELECT COUNT(*) FROM dev_agent_workline_reports r WHERE r.workline_id = w.id), (SELECT MAX(r.created) FROM dev_agent_workline_reports r WHERE r.workline_id = w.id), COALESCE((SELECT array_agg(link.task_id::bigint ORDER BY link.task_id) FROM dev_agent_workline_tasks link WHERE link.workline_id = w.id), '{}'::bigint[])`
const worklineFromClause = ` FROM dev_agent_worklines w LEFT JOIN system_users created_user ON created_user.id = w.created_by LEFT JOIN system_users status_user ON status_user.id = w.status_changed_by`

// WorklinesHandler dispatches authenticated workline list/create/update requests.
// Between: the private Agent Tools route and the workline handler functions.
// Why: guest browsing must never expose development history metadata.
func WorklinesHandler(w http.ResponseWriter, r *http.Request) {
	if !requireAuthenticatedAgentToolUser(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		listWorklinesHandler(w, r)
	case http.MethodPost:
		createWorklineHandler(w, r)
	case http.MethodPatch, http.MethodPut:
		updateWorklineHandler(w, r)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func scanWorkline(scanner interface {
	Scan(dest ...interface{}) error
}) (AgentWorkline, error) {
	var workline AgentWorkline
	var createdBy sql.NullInt64
	var statusChangedBy sql.NullInt64
	var latestReport sql.NullTime
	var taskIDs []int64
	err := scanner.Scan(
		&workline.ID,
		&workline.Title,
		&workline.Status,
		&statusChangedBy,
		&workline.StatusChangedByUsername,
		&workline.StatusChangedAt,
		&workline.StatusChangeSource,
		&workline.StatusRevision,
		pq.Array(&workline.Tags),
		&createdBy,
		&workline.CreatedByUsername,
		&workline.CreatedAt,
		&workline.UpdatedAt,
		&workline.ReportCount,
		&latestReport,
		pq.Array(&taskIDs),
	)
	if err != nil {
		return workline, err
	}
	if createdBy.Valid {
		value := int(createdBy.Int64)
		workline.CreatedBy = &value
	}
	if statusChangedBy.Valid {
		value := int(statusChangedBy.Int64)
		workline.StatusChangedBy = &value
	}
	if latestReport.Valid {
		value := latestReport.Time
		workline.LatestReportAt = &value
	}
	if workline.Tags == nil {
		workline.Tags = []string{}
	}
	if taskIDs == nil {
		taskIDs = []int64{}
	}
	workline.TaskIDs = taskIDs
	return workline, nil
}

func fetchWorklineByID(id int64) (AgentWorkline, error) {
	query := "SELECT " + worklineColumns + worklineFromClause + " WHERE w.id = $1"
	return scanWorkline(backend.Db.QueryRow(query, id))
}

func parseAgentToolLimit(raw string) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return 50, nil
	}
	limit, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || limit < 1 || limit > 100 {
		return 0, fmt.Errorf("limit must be between 1 and 100")
	}
	return limit, nil
}

func listWorklinesHandler(w http.ResponseWriter, r *http.Request) {
	if rawID := strings.TrimSpace(r.URL.Query().Get("id")); rawID != "" {
		id, err := strconv.ParseInt(rawID, 10, 64)
		if err != nil || id <= 0 {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "id_must_be_positive")
			return
		}
		workline, err := fetchWorklineByID(id)
		if err == sql.ErrNoRows {
			httpresponse.RespondWithError(w, http.StatusNotFound, "workline_not_found")
			return
		}
		if err != nil {
			respondAgentToolDatabaseError(w, "fetch workline", err)
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, workline)
		return
	}

	limit, err := parseAgentToolLimit(r.URL.Query().Get("limit"))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	query := "SELECT " + worklineColumns + worklineFromClause
	conditions := []string{}
	args := []interface{}{}
	if rawStatus := strings.TrimSpace(r.URL.Query().Get("status")); rawStatus != "" {
		status := normalizeWorklineStatus(rawStatus)
		if status == "" {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_status")
			return
		}
		args = append(args, status)
		conditions = append(conditions, fmt.Sprintf("w.status = $%d", len(args)))
	}
	if search := strings.TrimSpace(r.URL.Query().Get("q")); search != "" {
		args = append(args, "%"+search+"%")
		conditions = append(conditions, fmt.Sprintf(
			"(w.title ILIKE $%d OR array_to_string(w.tags, ' ') ILIKE $%d)", len(args), len(args),
		))
	}
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	args = append(args, limit)
	query += fmt.Sprintf(" ORDER BY w.updated DESC, w.id DESC LIMIT $%d", len(args))

	rows, err := backend.Db.Query(query, args...)
	if err != nil {
		respondAgentToolDatabaseError(w, "list worklines", err)
		return
	}
	defer rows.Close()

	worklines := []AgentWorkline{}
	for rows.Next() {
		workline, scanErr := scanWorkline(rows)
		if scanErr != nil {
			respondAgentToolDatabaseError(w, "scan workline", scanErr)
			return
		}
		worklines = append(worklines, workline)
	}
	if err := rows.Err(); err != nil {
		respondAgentToolDatabaseError(w, "iterate worklines", err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, worklines)
}

func createWorklineHandler(w http.ResponseWriter, r *http.Request) {
	var input worklineCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	title, err := normalizeBoundedText(input.Title, "title", maxWorklineTitleRunes)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := normalizeWorklineStatus(input.Status)
	if status == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_status")
		return
	}
	tags, err := normalizeReportTags(input.Tags)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	secretValues := append([]string{title}, tags...)
	if category := detectReportSecret(secretValues...); category != "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "workline_rejected_secret_detected:"+category)
		return
	}

	var id int64
	userID := currentAgentToolUserID(r)
	err = backend.Db.QueryRow(
		`INSERT INTO dev_agent_worklines (
			title, status, tags, created_by, status_changed_by, status_change_source
		 ) VALUES ($1, $2, $3, $4, $4, 'creation') RETURNING id`,
		title, status, pq.Array(tags), userID,
	).Scan(&id)
	if err != nil {
		respondAgentToolDatabaseError(w, "create workline", err)
		return
	}
	event_bus.Bus.Publish(agentWorklineTableName, event_bus.Event{
		Table: agentWorklineTableName, RowID: id, Action: "create",
	})

	workline, err := fetchWorklineByID(id)
	if err != nil {
		respondAgentToolDatabaseError(w, "reload workline", err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusCreated, workline)
}

func buildWorklineUpdateQuery(patch worklinePatchRequest) (string, []interface{}, error) {
	setParts := []string{}
	args := []interface{}{}
	appendValue := func(column string, value interface{}) {
		args = append(args, value)
		setParts = append(setParts, fmt.Sprintf("%s = $%d", column, len(args)))
	}

	if patch.Title != nil {
		title, err := normalizeBoundedText(*patch.Title, "title", maxWorklineTitleRunes)
		if err != nil {
			return "", nil, err
		}
		if category := detectReportSecret(title); category != "" {
			return "", nil, fmt.Errorf("workline_rejected_secret_detected:%s", category)
		}
		appendValue("title", title)
	}
	if patch.Status != nil {
		status := normalizeWorklineStatus(*patch.Status)
		if status == "" {
			return "", nil, fmt.Errorf("invalid status")
		}
		appendValue("status", status)
	}
	if patch.Tags != nil {
		tags, err := normalizeReportTags(*patch.Tags)
		if err != nil {
			return "", nil, err
		}
		if category := detectReportSecret(tags...); category != "" {
			return "", nil, fmt.Errorf("workline_rejected_secret_detected:%s", category)
		}
		appendValue("tags", pq.Array(tags))
	}
	if len(setParts) == 0 {
		return "", nil, fmt.Errorf("no fields to update")
	}
	args = append(args, patch.ID)
	query := fmt.Sprintf(
		"UPDATE dev_agent_worklines SET %s WHERE id = $%d RETURNING id",
		strings.Join(setParts, ", "), len(args),
	)
	return query, args, nil
}

func updateWorklineHandler(w http.ResponseWriter, r *http.Request) {
	var patch worklinePatchRequest
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if patch.ID <= 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "id_must_be_positive")
		return
	}
	query, args, err := buildWorklineUpdateQuery(patch)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	tx, err := backend.Db.Begin()
	if err != nil {
		respondAgentToolDatabaseError(w, "begin workline update", err)
		return
	}
	defer tx.Rollback()

	var currentStatus string
	var currentRevision int64
	if err := tx.QueryRow(
		"SELECT status, status_revision FROM dev_agent_worklines WHERE id = $1 FOR UPDATE",
		patch.ID,
	).Scan(&currentStatus, &currentRevision); err == sql.ErrNoRows {
		httpresponse.RespondWithError(w, http.StatusNotFound, "workline_not_found")
		return
	} else if err != nil {
		respondAgentToolDatabaseError(w, "lock workline update", err)
		return
	}

	var id int64
	if err := tx.QueryRow(query, args...).Scan(&id); err != nil {
		respondAgentToolDatabaseError(w, "update workline", err)
		return
	}
	statusChanged := patch.Status != nil && normalizeWorklineStatus(*patch.Status) != currentStatus
	if statusChanged {
		if _, err := tx.Exec(`
            UPDATE dev_agent_worklines
            SET status_changed_by = $1,
                status_changed_at = now(),
                status_change_source = 'agent_tools_api',
                status_revision = $2
            WHERE id = $3`, currentAgentToolUserID(r), currentRevision+1, id); err != nil {
			respondAgentToolDatabaseError(w, "attribute workline status update", err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		respondAgentToolDatabaseError(w, "commit workline update", err)
		return
	}
	event_bus.Bus.Publish(agentWorklineTableName, event_bus.Event{
		Table: agentWorklineTableName, RowID: id, Action: "update",
		ChangedFields: func() []string {
			if statusChanged {
				return []string{"status"}
			}
			return nil
		}(),
	})
	workline, err := fetchWorklineByID(id)
	if err != nil {
		respondAgentToolDatabaseError(w, "reload workline", err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, workline)
}

// WorklineTasksHandler manages optional links between worklines and canonical tickets.
// Between: stable report identities and dev_agent_tasks rows.
// Why: reports remain useful without tickets while still supporting explicit traceability.
func WorklineTasksHandler(w http.ResponseWriter, r *http.Request) {
	if !requireAuthenticatedAgentToolUser(w, r) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		listWorklineTaskLinksHandler(w, r)
	case http.MethodPost:
		createWorklineTaskLinkHandler(w, r)
	case http.MethodDelete:
		deleteWorklineTaskLinkHandler(w, r)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func scanWorklineTaskLink(scanner interface {
	Scan(dest ...interface{}) error
}) (AgentWorklineTaskLink, error) {
	var link AgentWorklineTaskLink
	var createdBy sql.NullInt64
	err := scanner.Scan(
		&link.ID, &link.WorklineID, &link.WorklineTitle, &link.TaskID, &link.TaskTitle, &createdBy, &link.CreatedAt,
	)
	if createdBy.Valid {
		value := int(createdBy.Int64)
		link.CreatedBy = &value
	}
	return link, err
}

func listWorklineTaskLinksHandler(w http.ResponseWriter, r *http.Request) {
	query := `SELECT link.id, link.workline_id, w.title, link.task_id, t.title, link.created_by, link.created
		FROM dev_agent_workline_tasks link
		JOIN dev_agent_worklines w ON w.id = link.workline_id
		JOIN dev_agent_tasks t ON t.id = link.task_id`
	conditions := []string{}
	args := []interface{}{}
	for _, filter := range []struct {
		name   string
		column string
	}{{"workline_id", "link.workline_id"}, {"task_id", "link.task_id"}} {
		if raw := strings.TrimSpace(r.URL.Query().Get(filter.name)); raw != "" {
			value, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || value <= 0 {
				httpresponse.RespondWithError(w, http.StatusBadRequest, filter.name+"_must_be_positive")
				return
			}
			args = append(args, value)
			conditions = append(conditions, fmt.Sprintf("%s = $%d", filter.column, len(args)))
		}
	}
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY link.created DESC, link.id DESC"
	rows, err := backend.Db.Query(query, args...)
	if err != nil {
		respondAgentToolDatabaseError(w, "list workline task links", err)
		return
	}
	defer rows.Close()
	links := []AgentWorklineTaskLink{}
	for rows.Next() {
		link, scanErr := scanWorklineTaskLink(rows)
		if scanErr != nil {
			respondAgentToolDatabaseError(w, "scan workline task link", scanErr)
			return
		}
		links = append(links, link)
	}
	if err := rows.Err(); err != nil {
		respondAgentToolDatabaseError(w, "iterate workline task links", err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, links)
}

func createWorklineTaskLinkHandler(w http.ResponseWriter, r *http.Request) {
	var input worklineTaskLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if input.WorklineID <= 0 || input.TaskID <= 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "workline_id_and_task_id_must_be_positive")
		return
	}
	var worklineExists, taskExists bool
	if err := backend.Db.QueryRow(
		`SELECT EXISTS (SELECT 1 FROM dev_agent_worklines WHERE id = $1),
		        EXISTS (SELECT 1 FROM dev_agent_tasks WHERE id = $2)`,
		input.WorklineID, input.TaskID,
	).Scan(&worklineExists, &taskExists); err != nil {
		respondAgentToolDatabaseError(w, "check workline task link", err)
		return
	}
	if !worklineExists || !taskExists {
		httpresponse.RespondWithError(w, http.StatusNotFound, "workline_or_task_not_found")
		return
	}

	var id int64
	created := true
	err := backend.Db.QueryRow(
		`INSERT INTO dev_agent_workline_tasks (workline_id, task_id, created_by)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (workline_id, task_id) DO NOTHING
		 RETURNING id`,
		input.WorklineID, input.TaskID, currentAgentToolUserID(r),
	).Scan(&id)
	if err == sql.ErrNoRows {
		created = false
		err = backend.Db.QueryRow(
			"SELECT id FROM dev_agent_workline_tasks WHERE workline_id = $1 AND task_id = $2",
			input.WorklineID, input.TaskID,
		).Scan(&id)
	}
	if err != nil {
		respondAgentToolDatabaseError(w, "create workline task link", err)
		return
	}
	if created {
		event_bus.Bus.Publish(agentWorklineTaskTableName, event_bus.Event{
			Table: agentWorklineTaskTableName, RowID: id, Action: "create",
		})
	}
	link, err := scanWorklineTaskLink(backend.Db.QueryRow(
		`SELECT link.id, link.workline_id, w.title, link.task_id, t.title, link.created_by, link.created
		 FROM dev_agent_workline_tasks link
		 JOIN dev_agent_worklines w ON w.id = link.workline_id
		 JOIN dev_agent_tasks t ON t.id = link.task_id
		 WHERE link.id = $1`, id,
	))
	if err != nil {
		respondAgentToolDatabaseError(w, "reload workline task link", err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpresponse.RespondWithJSON(w, status, link)
}

func deleteWorklineTaskLinkHandler(w http.ResponseWriter, r *http.Request) {
	worklineID, worklineErr := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("workline_id")), 10, 64)
	taskID, taskErr := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("task_id")), 10, 64)
	if worklineErr != nil || taskErr != nil || worklineID <= 0 || taskID <= 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "workline_id_and_task_id_must_be_positive")
		return
	}
	var id int64
	err := backend.Db.QueryRow(
		"DELETE FROM dev_agent_workline_tasks WHERE workline_id = $1 AND task_id = $2 RETURNING id",
		worklineID, taskID,
	).Scan(&id)
	if err == sql.ErrNoRows {
		httpresponse.RespondWithError(w, http.StatusNotFound, "workline_task_link_not_found")
		return
	}
	if err != nil {
		respondAgentToolDatabaseError(w, "delete workline task link", err)
		return
	}
	event_bus.Bus.Publish(agentWorklineTaskTableName, event_bus.Event{
		Table: agentWorklineTaskTableName, RowID: id, Action: "delete",
	})
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{"removed": true})
}

func respondAgentToolDatabaseError(w http.ResponseWriter, operation string, err error) {
	log.Printf("[agent-tools] %s failed: %v", operation, err)
	httpresponse.RespondWithError(w, http.StatusInternalServerError, "database_error")
}
