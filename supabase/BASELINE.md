# Baseline: theGAME, 2026-09-27

The live database (Supabase project **theGAME**, `okywhdfmdpdvrfhbkyeo`) is the starting
block. On 2026-09-27 it was verified identical to a fresh build of:

1. `supabase/schema.sql`
2. `supabase/migrations/002_cheating.sql` … `007_rivals.sql`, in order

using `tools/drift-check.sql` (every row matched):

| kind        | count | fingerprint                        |
|-------------|------:|------------------------------------|
| func        | 55    | `c39dd14abbb5e12ab769eb6289e2df3b` |
| policy      | 21    | `2ad6fbf61c1e3617d11b9dcacecbb075` |
| publication | 10    | `7cb7d34ac3763fd9f896672c05d8e443` |
| table       | 21    | `2125accc56cbf655b3937eaae3c533d1` |
| trigger     | 7     | `e164ad1cda00009a3f0646c58dc00b98` |

Those files were pasted into the SQL Editor, so Supabase's own migration history starts
with a marker migration, `baseline_theGAME` (version `20260927234952`), which only sets
a comment on the `public` schema.

**From here:** each change is a new file, `supabase/migrations/008_<name>.sql`, `009_…`,
committed to the repo and applied with the Supabase connector's `apply_migration` using
the same name (`008_<name>`), so the repo and theGAME's migration history list the same
steps. Re-run `tools/drift-check.sql` on both sides whenever in doubt.
