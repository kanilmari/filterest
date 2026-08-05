# Filterest Public Bootstrap Audit

- Target: `Filterest public bootstrap`
- Schema tables: `43`
- Seed tables: `26`
- Example emails: `0`
- Manifest format: `2`
- Manifest source files: `10`
- Findings: `0`

## Verdict

PASS

## Schema Tables

- `public.ai_chat_conversations`
- `public.dokumentaatio`
- `public.dokumentaatio_assets`
- `public.dokumentaatio_tiketit_relation`
- `public.palvelukatalogi`
- `public.palvelukatalogi_assets`
- `public.palvelukatalogi_dokumentaatio_relation`
- `public.palvelukatalogi_riskienhallinta_relation`
- `public.palvelukatalogi_tiketit_relation`
- `public.riskienhallinta`
- `public.riskienhallinta_assets`
- `public.riskienhallinta_dokumentaatio_relation`
- `public.riskienhallinta_tiketit_relation`
- `public.system_about`
- `public.system_audit_log`
- `public.system_child_tab_config`
- `public.system_column_control`
- `public.system_column_details`
- `public.system_column_view_presets`
- `public.system_comments`
- `public.system_config`
- `public.system_db_tables`
- `public.system_db_version`
- `public.system_foreign_key_relations_1_m`
- `public.system_foreign_key_relations_m_m`
- `public.system_functions`
- `public.system_group_table_func_rights`
- `public.system_lang_key_sources`
- `public.system_lang_keys`
- `public.system_lang_keys_archive`
- `public.system_table_folders`
- `public.system_table_row_view_counts`
- `public.system_table_views`
- `public.system_transaction_log`
- `public.system_user_column_settings`
- `public.system_user_group_memberships`
- `public.system_user_groups`
- `public.system_users`
- `public.tiketit`
- `public.tiketit_assets`
- `restricted.otp_send_events`
- `restricted.users_restricted`
- `restricted.verification_codes`

## Seed Tables

- `public.dokumentaatio`
- `public.dokumentaatio_tiketit_relation`
- `public.palvelukatalogi`
- `public.palvelukatalogi_assets`
- `public.palvelukatalogi_dokumentaatio_relation`
- `public.palvelukatalogi_riskienhallinta_relation`
- `public.palvelukatalogi_tiketit_relation`
- `public.riskienhallinta`
- `public.riskienhallinta_assets`
- `public.riskienhallinta_dokumentaatio_relation`
- `public.riskienhallinta_tiketit_relation`
- `public.system_about`
- `public.system_column_details`
- `public.system_config`
- `public.system_db_tables`
- `public.system_db_version`
- `public.system_foreign_key_relations_1_m`
- `public.system_functions`
- `public.system_group_table_func_rights`
- `public.system_lang_keys`
- `public.system_table_folders`
- `public.system_user_group_memberships`
- `public.system_user_groups`
- `public.system_users`
- `public.tiketit`
- `public.tiketit_assets`

## Seed Row Counts

- `public.dokumentaatio`: 3
- `public.dokumentaatio_tiketit_relation`: 1
- `public.palvelukatalogi`: 1
- `public.palvelukatalogi_assets`: 1
- `public.palvelukatalogi_dokumentaatio_relation`: 1
- `public.palvelukatalogi_riskienhallinta_relation`: 1
- `public.palvelukatalogi_tiketit_relation`: 1
- `public.riskienhallinta`: 1
- `public.riskienhallinta_assets`: 1
- `public.riskienhallinta_dokumentaatio_relation`: 1
- `public.riskienhallinta_tiketit_relation`: 1
- `public.system_about`: 1
- `public.system_column_details`: 45
- `public.system_config`: 9
- `public.system_db_tables`: 41
- `public.system_db_version`: 1
- `public.system_foreign_key_relations_1_m`: 4
- `public.system_functions`: 15
- `public.system_group_table_func_rights`: 20
- `public.system_lang_keys`: 489
- `public.system_table_folders`: 14
- `public.system_user_group_memberships`: 2
- `public.system_user_groups`: 3
- `public.system_users`: 2
- `public.tiketit`: 1
- `public.tiketit_assets`: 1

## Manifest Hash Coverage

- Generated files with hashes: `2`
- Source files with hashes: `10`

## Email Domains

- No email values found.

## Findings

- No private app/tool rows, non-example emails, secret-like values, or historical bootstrap archives detected.

## Human Review Boundary

This deterministic report does not approve the public bootstrap strategy or content scope for publication.
It also does not replace runtime proof of the first-ever admin credential path.
The technical guest row is not a reusable password; the installation owner creates the first admin through the guarded browser form.
A human/project owner still needs to review the bootstrap content and approve the credential path before publication.
