// column_editor.js
// Re-exports column management modal from gt_2_column_crud/column_manager.js.
// This file is retained as a thin shim so existing toolbar imports continue to resolve.
// All column CRUD logic now lives in ../gt_2_column_crud/column_manager.js.

export { open_column_management_modal } from '../gt_2_column_crud/column_manager.js';
