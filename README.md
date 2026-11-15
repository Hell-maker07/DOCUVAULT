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
| 2   | Sakshi    | Vault SQL schema + immutability triggers               | ⏳      |
| 3   | Saubhagya | Registration & login API (JWT, bcrypt)                 | ⏳      |
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
AES-256-GCM; Jest + Supertest; React + Vite (later steps). File storage is decided at Step 4.

## Getting started

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL and DATABASE_URL_TEST
npm run db:reset            # drop, migrate and seed reference data (refused in production)
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

## Database (Step 1: identity tables)

`001_identity.sql` creates `organizations`, `classification_levels` (natural key `level`),
`permissions`, `departments`, `positions`, `users`, `position_permissions` with primary and foreign
keys, `UNIQUE (org_id, code)` and `(org_id, title)`, `CHECK` constraints (scope, clearance range,
lower-case email, non-blank names), `ON DELETE RESTRICT/CASCADE` rules, FK indexes and an
`updated_at` trigger. `signatures` references `document_versions`, so it arrives with Step 7.
See [`docs/er-diagram.svg`](docs/er-diagram.svg). The constraints are proven by
`tests/schema.identity.test.js`.

## API

Base path `/api/v1`. All responses use `{ success, message, data }` or
`{ success: false, error: { code, message, details } }`.

| Endpoint      | Status                                     |
| ------------- | ------------------------------------------ |
| `GET /health` | ✅ Live                                    |
| 24 others     | Planned in later steps (see master design) |

## Security principles

- Deny by default; a document you may not see returns **404**, not 403, and the attempt is audited.
- No secrets in the repository; `.env.example` lists names only.
- Parameterised SQL only; stack traces never leave the server.

## Commit convention

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), one logical change per commit,
committed right after the work is verified.
