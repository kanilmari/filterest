// filterest_project_boundary.cjs
// Decides where the mutable project boundary of a Filterest application lies.
// Bridges the synchronous browser-target module and the ESM path resolvers with one rule.
// Exists once, matching the Python and shell checks, so no two tools disagree about it.

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");

function isRegularFile(candidate) {
    try {
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}

// A private Easelect workspace has a Git checkout and a version file. .git may be
// a file in a linked worktree, but VERSION_EASELECT must be a regular file.
function isPrivateEaselectSourceCheckout(projectRoot) {
    return fs.existsSync(path.join(projectRoot, ".git"))
        && isRegularFile(path.join(projectRoot, "VERSION_EASELECT"));
}

// A nested installation keeps the immutable application in app/ with its markers.
function isNestedFilterestInstallation(projectRoot) {
    const applicationRoot = path.join(projectRoot, "app");
    return isRegularFile(path.join(applicationRoot, "go.mod"))
        && isRegularFile(path.join(applicationRoot, "VERSION_APP"));
}

// Resolves links in the longest existing part of a path and keeps the missing
// rest, as Python's Path.resolve does, so a path that does not exist yet still
// gets an answer.
function resolveThroughExistingAncestor(candidatePath) {
    let existingPath = path.resolve(candidatePath);
    const missingParts = [];
    for (;;) {
        try {
            return path.resolve(fs.realpathSync.native(existingPath), ...missingParts);
        } catch (error) {
            const parentPath = path.dirname(existingPath);
            if ((error.code !== "ENOENT" && error.code !== "ENOTDIR") || parentPath === existingPath) {
                throw error;
            }
            missingParts.unshift(path.basename(existingPath));
            existingPath = parentPath;
        }
    }
}

/**
 * Resolves the mutable project boundary for tools whose source lives under app/,
 * by the same rule as resolve_embedded_project_root in easelect_private_paths.py.
 * An explicit wrapper override wins. Otherwise paths are taken where they really
 * lie, as the shell launchers (pwd -P) and Python (Path.resolve) do: a real
 * application (go.mod and VERSION_APP) maps to the installation holding it, and
 * that root to the Easelect workspace around it when the workspace has both
 * markers. A directory without the markers is its own boundary.
 */
function resolveFilterestProjectBoundary(applicationRoot, environment = process.env) {
    const explicitRoot = String(environment.FILTEREST_PROJECT_ROOT_OVERRIDE || "").trim();
    if (explicitRoot) {
        return resolveThroughExistingAncestor(explicitRoot);
    }
    const canonicalRoot = resolveThroughExistingAncestor(applicationRoot);
    const parentRoot = path.dirname(canonicalRoot);
    const productRoot = isNestedFilterestInstallation(parentRoot) ? parentRoot : canonicalRoot;
    const outerRoot = path.dirname(productRoot);
    return isPrivateEaselectSourceCheckout(outerRoot) ? outerRoot : productRoot;
}

// Reports whether an application belongs to a private Easelect composition: the
// boundary a wrapper names, or the one found around the application, is Easelect.
function isEmbeddedEaselectApplication(applicationRoot, environment = process.env) {
    return isPrivateEaselectSourceCheckout(
        resolveFilterestProjectBoundary(applicationRoot || ".", environment),
    );
}

exports.isPrivateEaselectSourceCheckout = isPrivateEaselectSourceCheckout;
exports.isNestedFilterestInstallation = isNestedFilterestInstallation;
exports.resolveFilterestProjectBoundary = resolveFilterestProjectBoundary;
exports.isEmbeddedEaselectApplication = isEmbeddedEaselectApplication;
