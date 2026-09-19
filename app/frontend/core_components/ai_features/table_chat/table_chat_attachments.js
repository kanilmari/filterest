// table_chat_attachments.js
// Lets an administrator attach images to a question for the site assistant.
// Bridges the chat's composer, the site's upload route and the next question's tokens.
// Exists so the assistant can look at the screenshot the person is asking about,
// while the browser only ever handles an opaque reference, never a path.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";

// The site's own language keys carry the translations; the English text here is
// the fallback an installation without these keys still shows.
const COPY_KEYS = Object.freeze({
    attach: ["chat_attach_image", "Attach an image"],
    remove: ["chat_attach_remove", "Remove this image"],
    tooMany: ["chat_attach_too_many", "Only four images can be attached at a time."],
    rejected: ["chat_attach_rejected", "That file is not an image this assistant can read."],
    failed: ["chat_attach_failed", "The image could not be attached."],
    uploading: ["chat_attach_uploading", "Attaching…"],
});

// The server enforces these as well; the browser refuses early so the person
// gets an answer without waiting for an upload that cannot succeed.
export const MAX_CHAT_ATTACHMENTS = 4;
export const ACCEPTED_CHAT_ATTACHMENT_TYPES = Object.freeze([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
]);

/** Read the composer's attachment copy from the current interface language. */
export function chatAttachmentCopy() {
    const text = {};
    for (const [name, [key, fallback]] of Object.entries(COPY_KEYS)) {
        text[name] = getTranslationForKey(key, { fallback }) || fallback;
    }
    return text;
}

/**
 * Build the attach control and the row of attached images.
 * The returned handle gives the composer the tokens of one question and clears
 * them once that question has been sent.
 */
export function createChatAttachments(tableName) {
    const text = chatAttachmentCopy();
    const attachments = [];

    const row = document.createElement("div");
    row.className = "chat_attachments";
    row.dataset.testid = "chat-attachments";

    const list = document.createElement("ul");
    list.className = "chat_attachment_list";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPTED_CHAT_ATTACHMENT_TYPES.join(",");
    input.multiple = true;
    input.hidden = true;
    input.dataset.testid = "chat-attachment-input";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat_attach_button";
    button.dataset.testid = "chat-attach-button";
    button.dataset.langKey = COPY_KEYS.attach[0];
    button.textContent = text.attach;
    button.setAttribute("aria-label", text.attach);

    const status = document.createElement("p");
    status.className = "chat_attachment_status";
    status.setAttribute("role", "status");
    status.hidden = true;

    const showStatus = (message) => {
        status.textContent = message || "";
        status.hidden = !message;
    };

    const renderList = () => {
        list.replaceChildren();
        for (const attachment of attachments) {
            const item = document.createElement("li");
            item.className = "chat_attachment";
            item.dataset.token = attachment.token;

            const name = document.createElement("span");
            name.className = "chat_attachment_name";
            name.textContent = attachment.name;

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "chat_attachment_remove";
            remove.textContent = "×";
            remove.setAttribute("aria-label", `${text.remove}: ${attachment.name}`);
            remove.addEventListener("click", () => {
                const index = attachments.findIndex((entry) => entry.token === attachment.token);
                if (index !== -1) attachments.splice(index, 1);
                renderList();
                showStatus("");
            });

            item.append(name, remove);
            list.appendChild(item);
        }
        row.hidden = attachments.length === 0 && status.hidden;
        button.disabled = attachments.length >= MAX_CHAT_ATTACHMENTS;
    };

    const addFiles = async (files) => {
        for (const file of files) {
            if (attachments.length >= MAX_CHAT_ATTACHMENTS) {
                showStatus(text.tooMany);
                break;
            }
            if (!ACCEPTED_CHAT_ATTACHMENT_TYPES.includes(file.type)) {
                showStatus(text.rejected);
                continue;
            }
            showStatus(text.uploading);
            try {
                const stored = await uploadChatAttachment(file);
                attachments.push({ token: stored.token, name: stored.name || file.name });
                showStatus("");
            } catch (error) {
                showStatus(error?.status === 409 ? text.tooMany : text.failed);
                void error;
            }
            renderList();
        }
        renderList();
    };

    button.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
        const files = Array.from(input.files || []);
        input.value = "";
        await addFiles(files);
    });

    row.append(list, status);
    renderList();

    return {
        button,
        input,
        row,
        /** The tokens the next question carries, in the order they were attached. */
        tokens: () => attachments.map((attachment) => attachment.token),
        /** Forget the attachments once their question has been sent. */
        clear: () => {
            attachments.length = 0;
            showStatus("");
            renderList();
        },
        /** Accept files from a paste or a drop, not only from the file dialog. */
        addFiles,
    };
}

/** Send one image and receive the token that names it in the next question. */
export function uploadChatAttachment(file) {
    const body = new FormData();
    body.append("image", file, file.name || "image");
    return endpoint_router("aiChatAttachment", { method: "POST", body_data: body });
}
