# Apply the reviewed DocuVault Step 2 patch

This archive is a merge patch for the existing DocuVault repository. Extract it into the **repository root** (the directory containing `package.json`). Do not replace the whole project folder and do not copy or overwrite `.git` or `.env`.

## Files in this patch

- `db/migrations/002_vault.sql` — seven vault tables and indexes.
- `db/migrations/003_immutability.sql` — append-only protection for versions/audit logs and no-delete protection for document identity rows.
- `tests/schema.vault.test.js` — database acceptance tests for the new schema, indexes and triggers.
- `tests/error.mapping.test.js` — tests for PostgreSQL error-to-HTTP mapping.
- `src/middlewares/error.js` — maps PostgreSQL 18 `23001` restrict violations to HTTP 409 CONFLICT.
- `README.md` — updated Step 2 notes; status remains “Verify locally” until the checks pass.

The existing `docs/er-diagram.svg` already contains the full planned entity model, including the Step 2 entities and the Step 7 `signatures` table, so this patch does not replace it.

## Apply safely on macOS

From the repository root, copy the archive into the project or use its full Downloads path, then extract/merge the files into `.`. Review `git status` and `git diff` before running or committing anything.

## Database commands

1. Ensure `.env` has separate `DATABASE_URL` and `DATABASE_URL_TEST` values. The test database must be disposable.
2. Apply the new migrations to the development branch without dropping existing data:

   ```bash
   npm run db:migrate
   ```

3. Run lint and tests:

   ```bash
   npm run lint
   npm test
   ```

   The database-backed Jest suites run `db:reset` against `DATABASE_URL_TEST`. This destroys and rebuilds the test database, so never point `DATABASE_URL_TEST` at a database containing data you need.
4. In pgAdmin, refresh the development database and confirm the 14 project tables plus the internal `schema_migrations` table. `signatures` is deliberately deferred to Step 7 because it references `document_versions`.

Do **not** run `npm run db:reset` against your development or shared integration branch. Use `npm run db:migrate` there.
