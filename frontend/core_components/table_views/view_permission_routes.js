// view_permission_routes.js
// Maps frontend view keys to their corresponding UI permission routes.
// Bridges legacy imports with the canonical dataset view registry.
// Exists to keep older callers stable while view metadata lives in one source.

import { DATASET_VIEW_PERMISSION_ROUTES } from "./dataset_view_registry.js";

export const VIEW_PERMISSION_ROUTES = DATASET_VIEW_PERMISSION_ROUTES;
