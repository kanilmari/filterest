// row_article_attachment_metadata.js
// Normalizes attachment kinds, names, sizes, sorting and upload constraints.
// Connects article upload controls and preview presentation to shared metadata.
// Keeps these pure rules independent of section and preview heading levels.

const DEFAULT_ATTACHMENT_ASSET_KINDS = ["pdf", "document", "archive"];
const DOCUMENT_EXTENSIONS = new Set([
    "txt", "rtf", "doc", "docx", "odt", "csv", "xls", "xlsx", "ppt", "pptx",
]);
const ARCHIVE_EXTENSIONS = new Set([
    "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz",
]);

export function filterAttachmentRows(rows = [], allowedKinds = DEFAULT_ATTACHMENT_ASSET_KINDS) {
    const allowed = new Set(
        (Array.isArray(allowedKinds) && allowedKinds.length > 0
            ? allowedKinds
            : DEFAULT_ATTACHMENT_ASSET_KINDS
        ).map((value) => String(value).toLowerCase())
    );

    return rows.filter((row) => {
        const rawKind = row?.asset_kind == null ? "" : String(row.asset_kind).trim().toLowerCase();
        if (!rawKind) return true;
        return allowed.has(rawKind);
    }).sort(compareAttachmentRows);
}

export function classifyAttachmentKind(fileName = "", mimeType = "") {
    const ext = extractFileExtension(fileName);
    const normalizedMime = String(mimeType || "").toLowerCase();

    if (normalizedMime === "application/pdf" || ext === "pdf") {
        return "pdf";
    }
    if (ARCHIVE_EXTENSIONS.has(ext) || normalizedMime.includes("zip") || normalizedMime.includes("compressed")) {
        return "archive";
    }
    if (DOCUMENT_EXTENSIONS.has(ext) || normalizedMime.startsWith("text/") || normalizedMime.includes("document")) {
        return "document";
    }
    return "document";
}

export function resolveAttachmentKind(row = {}) {
    if (row?.asset_kind) {
        return String(row.asset_kind).trim().toLowerCase();
    }
    return classifyAttachmentKind(
        resolveAttachmentDisplayName(row),
        row?.mime_type || ""
    );
}

export function resolveAttachmentDisplayName(row = {}) {
    const preferred = [row?.title, row?.original_name, row?.filename];
    const found = preferred.find((value) => typeof value === "string" && value.trim() !== "");
    return found ? found.trim() : "attachment";
}

export function resolveAttachmentOriginalName(row = {}) {
    const preferred = [row?.original_name, row?.filename];
    const found = preferred.find((value) => typeof value === "string" && value.trim() !== "");
    return found ? found.trim() : "";
}

export function resolveAttachmentDescription(row = {}) {
    return typeof row?.description === "string" ? row.description.trim() : "";
}

export function resolveAttachmentDownloadName(row = {}) {
    const displayName = resolveAttachmentDisplayName(row);
    const originalName = resolveAttachmentOriginalName(row);
    const originalExtension = extractFileExtension(originalName);

    if (!displayName || displayName === "attachment") {
        return originalName || displayName;
    }
    if (!originalExtension || hasFilenameExtension(displayName)) {
        return displayName;
    }
    return `${displayName}.${originalExtension}`;
}

export function formatAttachmentSize(sizeBytes) {
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0) {
        return "";
    }
    if (size < 1024) {
        return `${size} B`;
    }
    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildAcceptAttribute(allowedFileTypes = []) {
    if (!Array.isArray(allowedFileTypes) || allowedFileTypes.length === 0) {
        return "";
    }
    return allowedFileTypes
        .map((ext) => String(ext).trim().replace(/^\./u, ""))
        .filter(Boolean)
        .map((ext) => `.${ext}`)
        .join(",");
}

export function filterUploadableAttachmentFiles(files = [], options = {}) {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    const allowedExtensions = new Set(extractAllowedFileExtensions(options.allowedFileTypes));
    const maxFileSizeMB = Number(options.maxFileSizeMB || 0);

    return normalizedFiles.reduce((acc, file) => {
        if (!matchesAllowedAttachmentFile(file, allowedExtensions)) {
            acc.rejectedByType.push(file);
            return acc;
        }
        if (maxFileSizeMB > 0 && file.size / (1024 * 1024) > maxFileSizeMB) {
            acc.rejectedBySize.push(file);
            return acc;
        }
        acc.acceptedFiles.push(file);
        return acc;
    }, {
        acceptedFiles: [],
        rejectedByType: [],
        rejectedBySize: [],
    });
}

export function buildAttachmentMeta(row = {}) {
    const parts = [];
    const mimeType = typeof row?.mime_type === "string" ? row.mime_type.trim() : "";
    const formattedSize = formatAttachmentSize(row?.size_bytes);
    const originalName = resolveAttachmentOriginalName(row);
    const displayName = resolveAttachmentDisplayName(row);

    if (originalName && displayName && originalName !== displayName) parts.push(originalName);
    if (mimeType) parts.push(mimeType);
    if (formattedSize) parts.push(formattedSize);

    return parts.length > 0 ? parts.join(" · ") : "Tiedosto";
}

export function buildAttachmentUploadMeta({ allowedFileTypes = [], maxFileSizeMB = 0 } = {}) {
    const parts = [];
    const allowed = Array.isArray(allowedFileTypes)
        ? allowedFileTypes
            .map((ext) => String(ext || "").trim().replace(/^\./u, "").toUpperCase())
            .filter(Boolean)
        : [];
    if (allowed.length > 0) {
        parts.push(allowed.join(", "));
    }
    if (maxFileSizeMB > 0) {
        parts.push(`max ${maxFileSizeMB} MB`);
    }
    return parts.join(" · ");
}

function extractFileExtension(fileName = "") {
    const trimmed = String(fileName || "").trim().toLowerCase();
    const parts = trimmed.split(".");
    return parts.length > 1 ? parts.pop() : "";
}

function hasFilenameExtension(fileName = "") {
    return extractFileExtension(fileName) !== "";
}

function extractAllowedFileExtensions(allowedFileTypes = []) {
    return Array.isArray(allowedFileTypes)
        ? allowedFileTypes
            .map((ext) => String(ext || "").trim().replace(/^\./u, "").toLowerCase())
            .filter(Boolean)
        : [];
}

function matchesAllowedAttachmentFile(file, allowedExtensions) {
    if (!(allowedExtensions instanceof Set) || allowedExtensions.size === 0) {
        return true;
    }

    const extension = extractFileExtension(file?.name || "");
    return Boolean(extension) && allowedExtensions.has(extension);
}

function compareAttachmentRows(left = {}, right = {}) {
    const sortOrderDelta = normalizeAttachmentSortOrder(left?.sort_order) - normalizeAttachmentSortOrder(right?.sort_order);
    if (sortOrderDelta !== 0) {
        return sortOrderDelta;
    }

    const createdDelta = normalizeAttachmentTimestamp(left?.created) - normalizeAttachmentTimestamp(right?.created);
    if (createdDelta !== 0) {
        return createdDelta;
    }

    const idDelta = normalizeAttachmentNumericID(left?.id) - normalizeAttachmentNumericID(right?.id);
    if (idDelta !== 0) {
        return idDelta;
    }

    return resolveAttachmentDisplayName(left).localeCompare(resolveAttachmentDisplayName(right));
}

function normalizeAttachmentSortOrder(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function normalizeAttachmentTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return Number.MAX_SAFE_INTEGER;
}

function normalizeAttachmentNumericID(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}
