-- Restore the current Filterest public database version as the newest history
-- row only when that exact version was already present before an older public
-- migration was replayed. This repairs the 8.28.29 local-start regression
-- without promoting genuinely older databases or rewriting history rows.

INSERT INTO public.system_db_version (version, description)
SELECT
    '8.0.59',
    'Restored the existing Filterest 8.0.59 compatibility head after an older public migration replay.'
WHERE EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '8.0.59'
)
AND COALESCE((
    SELECT version
    FROM public.system_db_version
    ORDER BY applied_at DESC NULLS LAST, id DESC
    LIMIT 1
), '') <> '8.0.59';
