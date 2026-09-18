// table_chat_pending_changes.js
// Shows the changes a site assistant job prepared and lets the asking administrator approve them.
// Bridges the chat's job answer and the approval route that runs the approved calls.
// Exists so a change is visible in the administrator's own language before anything is written.
import { endpoint_router } from "../../endpoints/endpoint_router.js";

const copy = {
    en: {
        heading: "Waiting for your approval",
        intro: "The assistant prepared these changes but has not made them.",
        approve: "Approve and run",
        approveOne: "Approve this change",
        running: "Running…",
        done: "Done",
        failed: "This change failed. Nothing after it was run.",
        error: "Approval failed. Nothing was changed.",
        target: "Dataset",
        details: "Show the exact call",
    },
    fi: {
        heading: "Odottaa hyväksyntääsi",
        intro: "Avustaja valmisteli nämä muutokset, mutta ei ole tehnyt niitä.",
        approve: "Hyväksy ja suorita",
        approveOne: "Hyväksy tämä muutos",
        running: "Suoritetaan…",
        done: "Tehty",
        failed: "Tämä muutos epäonnistui. Sen jälkeisiä ei suoritettu.",
        error: "Hyväksyntä epäonnistui. Mitään ei muutettu.",
        target: "Aineisto",
        details: "Näytä tarkka kutsu",
    },
    sv: {
        heading: "Väntar på ditt godkännande",
        intro: "Assistenten förberedde dessa ändringar men har inte gjort dem.",
        approve: "Godkänn och kör",
        approveOne: "Godkänn den här ändringen",
        running: "Körs…",
        done: "Klar",
        failed: "Ändringen misslyckades. Inget efter den kördes.",
        error: "Godkännandet misslyckades. Inget ändrades.",
        target: "Datamängd",
        details: "Visa det exakta anropet",
    },
    de: {
        heading: "Wartet auf Ihre Freigabe",
        intro: "Der Assistent hat diese Änderungen vorbereitet, aber nicht ausgeführt.",
        approve: "Freigeben und ausführen",
        approveOne: "Diese Änderung freigeben",
        running: "Wird ausgeführt…",
        done: "Erledigt",
        failed: "Diese Änderung ist fehlgeschlagen. Nachfolgende wurden nicht ausgeführt.",
        error: "Die Freigabe ist fehlgeschlagen. Es wurde nichts geändert.",
        target: "Datensatz",
        details: "Genauen Aufruf anzeigen",
    },
};

/** Localized copy follows the document language like the rest of the chat. */
export function pendingChangesCopy() {
    const language = String(document.documentElement.lang || "en").split("-")[0];
    return copy[language] || copy.en;
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
            const result = await approvePendingChanges({ dataset, jobId, changes });
            const applied = Array.isArray(result?.pending_changes) ? result.pending_changes : [];
            applied.forEach((change, index) => {
                const item = list.children[index];
                if (item) item.dataset.status = String(change?.status || "pending");
            });
            const failed = applied.find((change) => change?.status === "failed");
            status.textContent = failed ? text.failed : text.done;
            if (failed) approve.disabled = false;
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
                    body_sha256: String(change?.body_sha256 || ""),
                })),
        },
    });
}
