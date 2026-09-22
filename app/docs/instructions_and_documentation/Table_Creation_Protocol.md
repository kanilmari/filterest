# Table Creation Protocol

To ensure the stability and consistency of the Filterest platform, all database tables must adhere to the following strict protocol. "Under the table" creation (creating tables without proper registration and triggers) is strictly forbidden as it breaks UI tools, synchronization, and AI features.

## 1. Naming Conventions

Every table must belong to one of the following categories and use the corresponding prefix:

*   **`system_`**: Core platform tables (metadata, configuration).
*   **`app_`**: Application-specific data (e.g., `app_service_catalog`).
*   **`dev_`**: Development and task tracking data (e.g., `dev_agent_tasks`, `dev_milestones`).

## 2. Required Schema Structure

All tables must include the following standard columns:

```sql
id SERIAL PRIMARY KEY
created TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
```

*   **`created`**: Timestamp of row creation. Never null.
*   **`updated`**: Timestamp of last modification. Never null. Must be updated via trigger.

## 3. Automation & Triggers

Every table must have an automatic update trigger to ensure `updated` is always accurate, regardless of whether the change comes from the API, a SQL script, or a direct DB edit.

### Naming Standard
*   **Function**: `set_<table_name>_updated_timestamp()`
*   **Trigger**: `update_<table_name>_timestamp`

### SQL Template
```sql
CREATE OR REPLACE FUNCTION set_my_table_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_my_table_timestamp
BEFORE UPDATE ON my_table
FOR EACH ROW
EXECUTE FUNCTION set_my_table_updated_timestamp();
```

## 4. System Registration

A table is not considered "valid" until it is registered in the platform's metadata.

1.  **`system_table_folders`**: The table must belong to a logical folder.
2.  **`system_db_tables`**: The table must have a row in this table linking it to a folder.
3.  **`system_column_details`**: (Optional but recommended) Metadata about columns for UI rendering.

### Runtime Safety Nets

Filterest now has two startup/runtime safety nets that reduce the risk of half-registered tables:

1. **Column metadata sync**
   - `UpdateColumnMetadata()` backfills missing `system_column_details` rows for registered tables.
   - New or backfilled rows get a default `card_element = 'details'` so card/admin UIs do not start from null metadata.
2. **Admin permission backfill**
   - `EnsureAdminTablePermissions()` grants the admin group any missing table-specific function permissions for all registered tables.
   - This means a newly registered table should not remain invisible to admins just because a migration forgot explicit permission rows.

These safety nets are a fallback, not a substitute for intentional metadata in migrations.
Migration authors should still set the right folder, display labels, FK display column, and any non-default card roles on purpose.

## 5. Creation Methods

### Method A: Dynamic Table Tools (Preferred)
Use the Filterest UI or the `dtt_3_table_create` Go component.
*   **Pros**: Automatically handles triggers, registration, and column metadata.
*   **When to use**: Runtime creation of app tables.
*   **Code Reference**: `filterest/app/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_create/create_table.go`
    *   `CreateTableInDatabase`: Handles table creation and trigger setup.
    *   `InsertNewTables`: Handles registration in `system_db_tables`.
*   **Folder**: The dataset form (`general_tables/dataset_form/`, one form for
    creating and editing) and `/api/create_dataset` put a new dataset in the
    current project's folder (`system_table_folders.is_current_project`) unless
    another folder, or a named new folder, is chosen. Without a current project
    the default is `database / other_tables`. The site navigation lists only the
    datasets directly in the current project's folder, so the create response
    reports `folder_path` and `in_site_navigation`, and a new folder with a
    parent but no name is refused.

### Method B: SQL Migrations (Manual)
Use this for core system tables or permanent dev tools.
*   **Requirement**: You must manually write the SQL for **ALL** steps above (Table, Trigger, Registration).
*   **Warning**: Failing to register the table will make it invisible to the frontend and AI agents.
*   **Important**: Even though startup now backfills baseline `system_column_details` and admin table permissions, migrations should still explicitly define any important UI metadata instead of relying on fallback defaults.

## Checklist for Manual Creation
- [ ] Table has `dev_`, `app_`, or `system_` prefix.
- [ ] Table has `created` and `updated` (NOT NULL).
- [ ] Trigger function created (`set_...`).
- [ ] Trigger assigned (`update_...`).
- [ ] Inserted row into `system_db_tables`.
- [ ] Added or verified `system_column_details` rows for the table.
- [ ] Chosen intentional `card_element` values where `'details'` is not good enough.
- [ ] Verified admin group can see/use the table without manual permission repair.
