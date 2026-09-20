// table_chat_pending_changes.js
// Shows the changes a site assistant job prepared and lets the asking administrator approve them.
// Bridges the chat's job answer and the approval route that runs the approved calls.
// Exists so a change is visible in the administrator's own language before anything is written.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";

// The site's own language keys carry the translations; the English text here is
// the fallback an installation without these keys still shows.
const COPY_KEYS = Object.freeze({
    heading: ["site_assistant_pending_heading", "Waiting for your approval"],
    intro: ["site_assistant_pending_intro", "The assistant prepared these changes but has not made them."],
    approve: ["site_assistant_pending_approve_all", "Approve and run"],
    approveOne: ["site_assistant_pending_approve_one", "Approve this change"],
    running: ["site_assistant_pending_running", "Running…"],
    done: ["site_assistant_pending_done", "Done"],
    failed: ["site_assistant_pending_failed", "This change failed. Nothing after it was run."],
    error: ["site_assistant_pending_error", "Approval failed. Nothing was changed."],
    target: ["site_assistant_pending_dataset", "Dataset"],
    details: ["site_assistant_pending_details", "Show the exact call"],
});

/** Read the view's copy from the language keys of the current interface language. */
export function pendingChangesCopy() {
    const text = {};
    for (const [name, [key, fallback]] of Object.entries(COPY_KEYS)) {
        text[name] = getTranslationForKey(key, { fallback }) || fallback;
    }
    return text;
}

/** A plain-language line for one waiting call, with the address as the detail. */
export function describePendingChange(change, text = pendingChangesCopy()) {
    const dataset = change?.query?.dataset ? `${text.target}: ${change.query.dataset}` : "";
    const action = `${String(change?.method || "").toUpperCase()} ${String(change?.path || "")}`;
    return dataset ? `${action} · ${dataset}` : action;
}

/**
 * Render one job's waiting changes into a chat message element.
 * onApproved receives the approval result so the chat can refresh the view.
 */
export function renderPendingChanges(container, { dataset, jobId, changes, onApproved } = {}) {
    if (!container || !Array.isArray(changes) || changes.length === 0) {
        return null;
    }
    const text = pendingChangesCopy();
    let currentChanges = changes;
    const section = document.createElement("section");
    section.className = "chat_pending_changes";
    section.dataset.jobId = String(jobId || "");

    const heading = document.createElement("h4");
    heading.className = "chat_pending_changes_heading";
    heading.textContent = text.heading;
    const intro = document.createElement("p");
    intro.className = "chat_pending_changes_intro";
    intro.textContent = text.intro;
    const list = document.createElement("ul");
    list.className = "chat_pending_changes_list";

    for (const change of changes) {
        const item = document.createElement("li");
        item.className = "chat_pending_change";
        item.dataset.status = String(change?.status || "pending");

        const summary = document.createElement("div");
        summary.className = "chat_pending_change_summary";
        summary.textContent = describePendingChange(change, text);

        const details = document.createElement("details");
        const detailsLabel = document.createElement("summary");
        detailsLabel.textContent = text.details;
        const body = document.createElement("pre");
        body.className = "chat_pending_change_body";
        body.textContent = JSON.stringify({ query: change?.query || {}, body: change?.body ?? null }, null, 2);
        details.append(detailsLabel, body);

        item.append(summary, details);
        if (change?.status === "done") {
            const state = document.createElement("span");
            state.className = "chat_pending_change_state";
            state.textContent = text.done;
            item.appendChild(state);
        }
        list.appendChild(item);
    }

    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "chat_pending_changes_approve";
    approve.textContent = changes.length === 1 ? text.approveOne : text.approve;

    const status = document.createElement("p");
    status.className = "chat_pending_changes_status";
    status.setAttribute("role", "status");
    status.hidden = true;

    approve.addEventListener("click", async () => {
        approve.disabled = true;
        status.hidden = false;
        status.textContent = text.running;
        try {
            const result = await approvePendingChanges({ dataset, jobId, changes: currentChanges });
            const applied = Array.isArray(result?.pending_changes) ? result.pending_changes : [];
            currentChanges = applied;
            applied.forEach((change, index) => {
                const item = list.children[index];
                if (item) item.dataset.status = String(change?.status || "pending");
            });
            const failed = applied.find((change) => change?.status === "failed");
            status.textContent = failed ? text.failed : text.done;
            const canRetry = result?.status === "apply_failed" &&
                applied.some((change) => change?.status !== "done");
            approve.disabled = !canRetry;
            if (typeof onApproved === "function") await onApproved(result);
        } catch (error) {
            status.textContent = text.error;
            approve.disabled = false;
            void error;
        }
    });

    section.append(heading, intro, list, approve, status);
    container.appendChild(section);
    return section;
}

/** Send only the identity of each waiting call; the server matches it to the job. */
export function approvePendingChanges({ dataset, jobId, changes }) {
    return endpoint_router("aiChatSiteAssistantApproval", {
        method: "POST",
        body_data: {
            dataset,
            job_id: jobId,
            approvals: changes
                .filter((change) => change?.status !== "done")
                .map((change) => ({
                    method: String(change?.method || "").toUpperCase(),
                    path: String(change?.path || ""),
                    query: String(change?.approval_query || ""),
                    body_sha256: String(change?.body_sha256 || ""),
                })),
        },
    });
}
