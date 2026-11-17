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
| 4   | Sakshi    | File storage connection, multer, SHA-256 utility       | ✅ Done |
| 5   | Saubhagya | RBAC access middleware (clearance, scope, permissions) | ✅ Done |
| 6   | Sakshi    | Audit hash-chain logic                                 | ✅ Done |
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

### File Storage, Multer & SHA-256 Hashing Utility (Step 4)

Step 4 sets up the physical file storage adapters, the upload middleware and the cryptographic integrity engine:

- **Pluggable Storage Adapters (`src/storage/`):**
  - `SwiftStorageAdapter`: Connects to OpenStack Swift object storage (TempAuth v1.0, Keystone v3, or direct storage endpoint + token). Automatically provisions private containers, uploads, downloads, checks existence and deletes objects for rollbacks.
  - `LocalStorageAdapter`: Safe local filesystem storage with directory-traversal protection for development and test execution without cloud dependencies.
  - `SupabaseStorageAdapter`: Compatible private bucket storage over REST.
  - `createStorageAdapter`: Factory selector dynamically picking the active adapter from `config.STORAGE_DRIVER`.
- **Upload Middleware (`src/middlewares/upload.js`):**
  - Uses `multer.memoryStorage()` so file buffers stay in RAM during API calls, ready for immediate hashing and Swift streaming.
  - Rejects files larger than `MAX_UPLOAD_MB` with `413 FILE_TOO_LARGE`.
  - Enforces permitted document MIME types (PDF, Office, OpenDocument, plain text, and image scans) with `415 UNSUPPORTED_TYPE`.
  - Automatically calculates `req.file.sha256` on the in-memory buffer upon arrival.
- **Cryptographic Hashing & Integrity (`src/utils/hash.js`):**
  - `sha256` & `sha256Stream`: Computes exact 64 lower-case hex character fingerprints.
  - `timingSafeCompare`: Constant-time comparison preventing timing attacks.
  - `verifyIntegrity`: Returns computed status (`VERIFIED` vs `TAMPERED`).
  - `buildStoragePath`: Collision-resistant, safe version path generator (`orgs/{orgId}/docs/{docId}/v{versionNo}_{cleanName}`).
- Proven by `tests/hash.test.js`, `tests/upload.test.js`, and `tests/storage.test.js`.

### Audit Log Hash-Chain Architecture & Verification (Step 6)

Step 6 implements the tamper-evident, cryptographic hash-chain engine and audit verification system (AP-08, DE-05):

- **Cryptographic Chaining Formula (`src/modules/audit/auditWriter.js`):**
  - Every event is hashed deterministically: `SHA-256(prev_hash + canonicalJson([seq, org_id, actor_id, action, entity_type, entity_id, outcome, details, created_at]))`.
  - Genesis link: The first row for an organisation always starts at `seq = 1` with `prev_hash = '0'.repeat(64)`.
  - Recursive key sorting: `canonicalJson` ensures formatting or JSON key-order differences never diverge hashes.
- **Concurrent Serialisation & Integrity Protection:**
  - Inside the caller's transaction, `SELECT id FROM organizations WHERE id = $1 FOR UPDATE` locks the organisation row so concurrent writes serialize cleanly, forming a contiguous sequence with no duplicate sequence numbers and no gaps.
  - Database triggers (`003_immutability.sql`) block direct `UPDATE`, `DELETE`, and `TRUNCATE` operations on `audit_logs`.
- **Chain Verification Service (`src/modules/audit/service.js`):**
  - `verifyAuditChain(orgId)` recomputes hashes from seq 1 to head, checking:
    1. Strict sequence continuity (`seq === expectedSeq`).
    2. Pointer integrity (`prev_hash === expectedPrevHash`).
    3. Payload cryptographic fidelity (`actualHash === recomputedHash`).
  - Pinpoints the exact sequence number and failure mode (`HASH_MISMATCH`, `BROKEN_LINK`, `SEQUENCE_GAP`) if tampering occurs.
- **Audit REST APIs & Analytics (`src/modules/audit/`):**
  - Protected with `authenticate` and `requirePermission('AUDIT')`. Unauthorized attempts return 403 and write `ACCESS_DENIED` to `audit_logs`.
  - `GET /api/v1/audit/verify-chain`: Recomputes the chain and returns `{ verified: true, count, lastSeq, headHash }`.
  - `GET /api/v1/audit`: Paginated and parameterised querying filtered by `action`, `actorId`, `outcome`, `entityType`, and ISO date range (`from`/`to`).
  - `GET /api/v1/audit/:seq`: Fetch specific audit entry by sequence number.
  - Analytics endpoints: `GET /api/v1/audit/stats/denied-by-position` (DE-05 Q07) and `GET /api/v1/audit/stats/active-users` (DE-05 Q08).
- Proven by comprehensive acceptance tests in `tests/audit.test.js` (24 tests covering genesis, chaining, concurrency, tamper detection, immutability, and tenant isolation).

## API

Base path `/api/v1`. All responses use `{ success, message, data }` or
`{ success: false, error: { code, message, details } }`.

| Endpoint              | Method  | Access    | Status  | Description                                             |
| --------------------- | ------- | --------- | ------- | ------------------------------------------------------- |
| `/health`             | GET     | Public    | ✅ Live | Liveness probe; does not touch database                 |
| `/orgs`               | POST    | Public    | ✅ Live | Bootstrap organisation with root admin + JWT (AP-01)    |
| `/auth/login`         | POST    | Public    | ✅ Live | Credential verification and JWT token issuance (AP-01)  |
| `/auth/me`            | GET     | Signed in | ✅ Live | Current user, clearance, position & permissions (AP-01) |
| `/audit`              | GET     | AUDIT     | ✅ Live | Filtered & paginated audit log entries (AP-08)          |
| `/audit/verify-chain` | GET     | AUDIT     | ✅ Live | Cryptographic chain recomputation & break detection     |
| `/audit/:seq`         | GET     | AUDIT     | ✅ Live | Individual audit entry by sequence number               |
| 18 other endpoints    | Various | Various   | Planned | Planned in later steps (see master design)              |

## Security principles

- Deny by default; a document you may not see returns **404**, not 403, and the attempt is audited.
- No secrets in the repository; `.env.example` lists names only.
- Parameterised SQL only; stack traces never leave the server.

## Commit convention

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), one logical change per commit,
committed right after the work is verified.
