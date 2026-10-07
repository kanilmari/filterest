-- 20261005000014_add_password_reset_dummy_work.sql
-- Gives unknown reset-code confirmations a real private write and commit.
-- Connects OTP verification with the same database work as a failed pending code.
-- The single row contains no account, identifier, credential or usable challenge.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: password_reset_dummy_work

CREATE TABLE IF NOT EXISTS restricted.password_reset_dummy_work (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    work boolean NOT NULL DEFAULT false
);
INSERT INTO restricted.password_reset_dummy_work(id,work)
SELECT true,false WHERE NOT EXISTS (SELECT 1 FROM restricted.password_reset_dummy_work WHERE id);
COMMENT ON TABLE restricted.password_reset_dummy_work IS
    'Constant account-free work for password-reset confirmation timing. Never stores challenge or identity data.';
INSERT INTO public.system_data_repair_records(migration,action,detail)
SELECT 'password_reset_dummy_work','completed','{"rows":1}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration='password_reset_dummy_work' AND action='completed');
