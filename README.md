# DocuVault

A secure, centralised, role-based document management system in the style of DigiLocker.
Every document is stored once, classified, and visible only to users whose **position,
department and clearance level** allow it. Access is **denied by default**, every file carries a
**SHA-256 fingerprint**, and every action goes into an **append-only, hash-chained audit log**.

> Capstone project (Advanced Programming + Data Engineering). All data is synthetic.
> DocuVault is _tamper-evident_, not tamper-proof: changed files and altered history are detected.

## Team and ownership

| Member                | Vertical                                                                           |
| --------------------- | ---------------------------------------------------------------------------------- |
| **Saubhagya** (Mem 1) | Identity, access engine & cryptography: auth, RBAC policy engine, Ed25519 signing  |
| **Sakshi** (Mem 2)    | Vault, file storage & audit chain: documents, integrity checks, hash-chained audit |

## Build progress

Built step by step, alternating between members. Each step is committed as soon as it works.

| #   | Owner     | Step                                                   | Status  |
| --- | --------- | ------------------------------------------------------ | ------- |
| 1   | Saubhagya | Express project + identity SQL schema                  | ✅ Done |
| 2   | Sakshi    | Vault SQL schema + immutability triggers               | ✅ Done |
| 3   | Saubhagya | Registration & login API (JWT, bcrypt)                 | ✅ Done |
| 4   | Sakshi    | File storage connection, multer, SHA-256 utility       | ⏳      |
| 5   | Saubhagya | RBAC access middleware (clearance, scope, permissions) | ⏳      |
| 6   | Sakshi    | Audit hash-chain logic                                 | ⏳      |
| 7   | Saubhagya | Ed25519 signatures (+ `signatures` table migration)    | ⏳      |
| 8   | Sakshi    | Document upload and verified download APIs             | ⏳      |
| 9   | Saubhagya | React frontend: Auth UI + Admin dashboard              | ⏳      |
| 10  | Sakshi    | React Vault UI, upload form, audit viewer              | ⏳      |

## Tech stack

Node.js 20+, Express 4, PostgreSQL (Neon in production), `pg` with plain SQL migrations,
`zod` validation, `helmet`, `cors`, `express-rate-limit`; Node `crypto` for SHA-256, Ed25519 and
AES-256-GCM; Jest + Supertest; React + Vite (later steps). File storage is finalized in Step 4: the execution plan names OpenStack Swift, while the master architecture document names Supabase Storage, so the team must reconcile that choice before integrating storage.

## Getting started

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL and DATABASE_URL_TEST
npm run db:reset            # destructive: only use on disposable dev/test databases
npm run dev                 # http://localhost:3000/api/v1/health
npm test                    # needs DATABASE_URL_TEST (a database different from DATABASE_URL)
```

| Script               | What it does                                                     |
| -------------------- | ---------------------------------------------------------------- |
| `npm run db:migrate` | Apply pending `db/migrations/*.sql` (checksummed, transactional) |
| `npm run db:seed`    | Load reference data (4 clearance levels, 7 permissions)          |
| `npm run db:reset`   | Rebuild the database from nothing                                |
| `npm run lint`       | ESLint                                                           |
| `npm test`           | Jest + Supertest against the test database                       |

## Project structure

```
src/
  app.js, server.js        Express app factory and bootstrap
  config/                  env.js (zod-validated), db.js (pg pool, transactions)
  middlewares/             error handling (central envelope, Postgres error mapping)
  modules/                 one folder per feature: routes, controller, service, schema, repo
  utils/                   AppError, asyncHandler, response envelope
db/migrations/             ordered SQL schema files
db/seed/                   reference and (later) demo data
scripts/db.js              migrate / seed / reset runner
tests/                     Jest suites
docs/                      ER diagram and design documents
```

## Database

`001_identity.sql` creates `organizations`, `classification_levels` (natural key `level`),
`permissions`, `departments`, `positions`, `users`, `position_permissions` with primary and foreign
keys, `UNIQUE (org_id, code)` and `(org_id, title)`, `CHECK` constraints (scope, clearance range,
lower-case email, non-blank names), `ON DELETE RESTRICT/CASCADE` rules, FK indexes and an
`updated_at` trigger. `signatures` references `document_versions`, so it arrives with Step 7.
See [`docs/er-diagram.svg`](docs/er-diagram.svg). The constraints are proven by
`tests/schema.identity.test.js`.

### Vault tables and immutability (Step 2)

`002_vault.sql` adds `document_types`, `workspaces`, `workspace_members`, `documents`,
`document_versions`, `access_grants` and `audit_logs` (14 project tables so far; `signatures` is the 15th). The separate `schema_migrations` table is internal migration bookkeeping and is not counted as a project table.

- **Integrity rules in the database:** `UNIQUE (document_id, version_no)`, `UNIQUE (org_id, seq)`,
  workspace status and audit action/outcome `CHECK` lists, `sha256`/`hash`/`prev_hash` must be 64
  lower-case hex characters, `expires_at > created_at` on grants, `ON DELETE RESTRICT` on documents.
- **Full-text search:** `documents.search_vec` is a generated `tsvector` with a `GIN` index
  (`idx_documents_search_vec`); a test checks the planner uses it.
- **Append-only history:** `003_immutability.sql` installs triggers that reject `UPDATE`, `DELETE`
  and `TRUNCATE` (also via `TRUNCATE ... CASCADE`) on `document_versions` and `audit_logs`.
  It also prevents deleting or truncating a `documents` identity row, including one that has not
  received its first version; document metadata updates remain possible.
- Proven by `tests/schema.vault.test.js`. Because document identities, versions and audit rows
  cannot be removed, tests rebuild the disposable test database with `db:reset`.
- Rules that need other tables or request context (30-day grant limit, position/department
  organisation consistency, workspace-member scope, and document-type/workspace organisation
  consistency) are enforced in the service layer, not by a column constraint.

## API

Base path `/api/v1`. All responses use `{ success, message, data }` or
`{ success: false, error: { code, message, details } }`.

| Endpoint           | Method  | Access    | Status  | Description                                             |
| ------------------ | ------- | --------- | ------- | ------------------------------------------------------- |
| `/health`          | GET     | Public    | ✅ Live | Liveness probe; does not touch database                 |
| `/orgs`            | POST    | Public    | ✅ Live | Bootstrap organisation with root admin + JWT (AP-01)    |
| `/auth/login`      | POST    | Public    | ✅ Live | Credential verification and JWT token issuance (AP-01)  |
| `/auth/me`         | GET     | Signed in | ✅ Live | Current user, clearance, position & permissions (AP-01) |
| 21 other endpoints | Various | Various   | Planned | Planned in later steps (see master design)              |

## Security principles

- Deny by default; a document you may not see returns **404**, not 403, and the attempt is audited.
- No secrets in the repository; `.env.example` lists names only.
- Parameterised SQL only; stack traces never leave the server.

## Commit convention

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), one logical change per commit,
committed right after the work is verified.
