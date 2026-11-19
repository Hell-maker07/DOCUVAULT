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

| #   | Owner      | Step                                                   | Status     |
| --- | ---------- | ------------------------------------------------------ | ---------- |
| 1   | Saubhagya  | Express project + identity SQL schema                  | ✅ Done    |
| 2   | Sakshi     | Vault SQL schema + immutability triggers               | ✅ Done    |
| 3   | Saubhagya  | Registration & login API (JWT, bcrypt)                 | ✅ Done    |
| 4   | Sakshi     | File storage connection, multer, SHA-256 utility       | ✅ Done    |
| 5   | Saubhagya  | RBAC access middleware (clearance, scope, permissions) | ✅ Done    |
| 6   | Sakshi     | Audit hash-chain logic                                 | ✅ Done    |
| 7   | Saubhagya  | Ed25519 signatures (+ `signatures` table migration)    | ✅ Done    |
| 8   | Sakshi     | Document upload and verified download APIs             | ✅ Done    |
| 9   | Saubhagya  | React frontend: Auth UI + Admin dashboard              | ✅ Done    |
| 10  | Sakshi     | React Vault UI, upload form, audit viewer              | ⏳         |
| 11  | Unassigned | Platform Super Admin Dashboard                         | 📋 Planned |

> **Note on Step 11:** Step 11 is an additional standalone platform phase planned after Steps 9 and 10. It is currently unassigned, separate from the responsibilities of Member 1 and Member 2, and represents a planned specification rather than existing functionality.

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

### Digital Signatures & Ed25519 PKI Architecture (Step 7)

Step 7 implements digital signature creation, verification, and database immutability (AP-10, BR-12, BR-09, DE-05 Q06):

- **Database Migration (`db/migrations/004_signatures.sql`):**
  - Creates `signatures` table linking `version_id` (`document_versions`) and `signer_id` (`users`).
  - Enforces `UNIQUE(version_id, signer_id)`: exactly one signature per person per version (BR-12).
  - Immutability row and statement triggers (`signatures_immutable`, `signatures_no_truncate`) forbid `UPDATE`, `DELETE`, and `TRUNCATE`.
- **Pre-Signing Integrity Verification (BR-09):**
  - Before signing, the system re-fetches file bytes from storage and re-verifies the SHA-256 fingerprint against `version.sha256`.
  - Any mismatch blocks signing with `409 INTEGRITY_FAILURE` and writes a `VERIFY FAILED` (`TAMPERED`) audit record.
- **Asymmetric Signing & Verification Flow (`src/modules/signatures/`):**
  - Decrypts signer's Ed25519 private key from `users.private_key_enc` using AES-256-GCM.
  - Generates Base64 Ed25519 signature over the version's stored SHA-256 hex string.
  - Atomically records signature and appends `SIGN` (`ALLOWED`) audit entry in a single database transaction.
- **REST Endpoints:**
  - `POST /api/v1/documents/:id/versions/:no/sign`: Signs document version (enforces `SIGN` permission, RBAC scope & clearance).
  - `GET /api/v1/documents/:id/versions/:no/signatures`: Retrieves and dynamically verifies each signature on the version with the signer's public key (enforces `VIEW` permission).
  - `GET /api/v1/signatures/stats/unsigned-latest`: DE-05 Q06 analytics endpoint returning latest document versions with zero signatures via SQL anti-join.
  - `GET /api/v1/signatures/:id/verify`: Standalone signature verification by ID.
- Proven by comprehensive acceptance tests in `tests/signatures.test.js` (18 tests covering keypairs, immutability, anti-tampering, duplicate rejection, and RBAC).

### Document Intake, Versioning & Verified Download Architecture (Step 8)

Step 8 implements physical file storage intake, versioning, full-text access search, and cryptographic integrity verification (AP-04, AP-05, AP-06, AP-07, AP-09, DE-05):

- **Workspace Lifecycle & Membership (`src/modules/workspaces/`):**
  - Workspaces define collaborative containers for documents within departments.
  - Creator or `MANAGE_ORG` can manage members and update lifecycle status (`OPEN`, `CLOSED`, `ARCHIVED`).
  - Terminal status rule (BR-14): Once `ARCHIVED`, a workspace cannot be reopened to `OPEN` or `CLOSED` (`409 CONFLICT`).
  - Writes are strictly disallowed into non-open workspaces (`409 WORKSPACE_CLOSED`).
- **Initial Document Upload (`POST /api/v1/workspaces/:id/documents`):**
  - Single-part file upload handled in-memory via Multer with `MAX_UPLOAD_MB` and MIME type validation.
  - Cryptographic fingerprinting: Computes `sha256` of file bytes upon intake.
  - Generates safe, collision-resistant storage path: `orgs/{orgId}/docs/{docId}/v1_{cleanName}`.
  - Atomically inserts `documents` identity and `document_versions` (v1) rows in a database transaction with audit logging.
  - Rollback safety: Deletes file from object storage if any database constraint or write fails.
  - Enforces classification limit (BR-04): Uploader cannot classify above their own clearance (`403 FORBIDDEN`).
- **Concurrency-Safe Versioning (`POST /api/v1/documents/:id/versions`):**
  - Locks document row (`SELECT id, workspace_id FROM documents WHERE id = $1 FOR UPDATE`) inside caller's transaction to prevent race conditions during version incrementing.
  - Determines next version number (`COALESCE(MAX(version_no), 0) + 1`), saves file to storage, and writes immutable version record.
  - Proven by concurrent tests with 10 simultaneous uploads executing in parallel without duplicate version numbers or gaps.
- **Verified Download & Integrity Checks (`GET /api/v1/documents/:id/versions/:no/download`):**
  - Fetches file bytes from storage and cryptographically re-hashes before streaming.
  - If bytes match `version.sha256`: Sets `X-DocuVault-Integrity: VERIFIED` headers, logs `DOWNLOAD` audit event, and streams file.
  - If bytes mismatch (tampered): Refuses transfer, returns `409 INTEGRITY_FAILURE`, and logs `VERIFY FAILED` (`status: 'TAMPERED'`) to the audit trail.
  - `POST /api/v1/documents/:id/verify`: Re-hashes every version of a document against storage.
  - `POST /api/v1/audit/verify-all`: Scans and re-hashes every document version in the organisation (request 25).
- **Access-Filtered Full-Text Search (`GET /api/v1/documents`):**
  - Combines PostgreSQL GIN indexed `search_vec @@ plainto_tsquery(...)` with the RBAC clearance and scope predicate (`buildAccessFilter`).
  - Lower-clearance users receive fewer results; out-of-scope or foreign organisation documents are never revealed.
- **DE-05 Analytics Endpoints:**
  - `GET /api/v1/documents/stats/dept-classification`: Documents per department per classification (Q01).
  - `GET /api/v1/documents/stats/multi-versions`: Documents with multiple versions (Q05).
  - `GET /api/v1/documents/stats/ranked-positions`: Positions ranked by documents opened (Q12).
- Proven by comprehensive acceptance tests in `tests/documents.test.js` (26 tests covering upload, versioning, concurrency, download verification, tamper detection, search, and analytics).

### Frontend Auth UI, Organisation Admin Dashboard & Vault Navigation (Step 9)

Step 9 implements the web client infrastructure, tenant onboarding, authentication interfaces, the full Organisation Admin Dashboard, and bidirectional Vault navigation with RBAC enforcement:

- **Web Client Pipeline & Hardened Security (`public/`):**
  - Static asset serving mounted via Express with custom Content Security Policy (CSP) directives permitting Tailwind CSS CDN, Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`), and embedded webview runners.
  - Reusable toast notification module (`public/toast.js`) providing non-blocking visual feedback for asynchronous operations.
- **Tenant Onboarding & Authentication UI (`public/login.html`, `public/register.html`, `public/index.html`):**
  - Official brand palette styling: **Soft Fawn** (`#B59778`), **Space Indigo** (`#1E2952`), and **Dusk Blue** (`#2E5090`).
  - Streamlined login interface with client-side format validation, loading spinner states, credential submission against `POST /api/v1/auth/login`, and session JWT storage.
  - Multi-step organisation registration with instant bootstrap via `POST /api/v1/orgs`, immediately redirecting initial administrators directly to the Organisation Admin Dashboard (`/dashboard`).
  - Session dispatch gateway in `index.html` routing authenticated users to `/home.html` and unauthenticated sessions to `/login.html`.
- **Organisation Admin Backend APIs (`src/modules/`):**
  - Department hierarchy and dictionary endpoints (`/api/v1/departments`) with unique code constraints and member protection.
  - Position management (`/api/v1/positions`) linking clearance levels (1–4), departmental scopes, and permission sets.
  - User and employee administration (`/api/v1/users`) supporting secure password hashing, department/position foreign-key validation, and granular permission editing (`VIEW`, `UPLOAD`, `EDIT`, `SIGN`, `SHARE`, `AUDIT`, `MANAGE_ORG`).
  - Transactional persistence in Neon PostgreSQL ensuring all employee modifications persist reliably across restarts and page reloads.
- **Organisation Admin Dashboard UI (`public/dashboard.html`):**
  - Live metric summary cards: Total Departments, Positions, and Active Members.
  - Searchable and filterable data tables for departments, positions, and organisation members.
  - Modal workflows: Create Department, Configure Position & Clearance, Add Member, Edit Member Permissions, and Member Deactivation with audit logging.
  - Navigation options: "Take Me to Vault" sidebar button (`id="nav-btn-vault"`) and user profile dropdown link (`id="dropdown-vault-link"`).
  - RBAC protection: Automatically redirects users lacking the `MANAGE_ORG` permission to `/home.html`.
- **Temporary Home Page & Vault Navigation (`public/home.html`):**
  - Polished, responsive landing page served directly at `/home` and `/vault`.
  - Dynamic user profile greeting and organisation metadata resolved from `GET /api/v1/auth/me`.
  - Displays preparation notice: _"Your Vault workspace is being prepared. Document management features will be available soon."_
  - Dedicated "Organisation Administration" access button dynamically revealed strictly to users with `MANAGE_ORG` permission (hidden for regular employees).
  - Normal login navigation routes all standard employee and administrator logins to `/home.html`.
  - Preserves clean modular boundaries for Sakshi's upcoming Step 10 Vault UI (zero document uploads, mock lists, or audit viewers introduced).
- Proven by comprehensive acceptance tests across 3 suites (48 tests total):
  - `tests/auth.ui.test.js`: 21 tests validating static routing, registration/login forms, CSP headers, and dashboard modal elements.
  - `tests/users.persistence.test.js`: 16 tests verifying Neon PostgreSQL database persistence, employee creation, permission updates, department cascades, and multi-tenant isolation.
  - `tests/vault.nav.test.js`: 11 tests verifying all 9 Step 9 navigation and RBAC flows.

### Frontend Auth UI, Organisation Admin Dashboard & Vault Navigation (Step 9)

Step 9 implements the web client infrastructure, tenant onboarding, authentication interfaces, the full Organisation Admin Dashboard, and bidirectional Vault navigation with RBAC enforcement:

- **Web Client Pipeline & Hardened Security (`public/`):**
  - Static asset serving mounted via Express with custom Content Security Policy (CSP) directives permitting Tailwind CSS CDN, Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`), and embedded webview runners.
  - Reusable toast notification module (`public/toast.js`) providing non-blocking visual feedback for asynchronous operations.
- **Tenant Onboarding & Authentication UI (`public/login.html`, `public/register.html`, `public/index.html`):**
  - Official brand palette styling: **Soft Fawn** (`#B59778`), **Space Indigo** (`#1E2952`), and **Dusk Blue** (`#2E5090`).
  - Streamlined login interface with client-side format validation, loading spinner states, credential submission against `POST /api/v1/auth/login`, and session JWT storage.
  - Multi-step organisation registration with instant bootstrap via `POST /api/v1/orgs`, immediately redirecting initial administrators directly to the Organisation Admin Dashboard (`/dashboard`).
  - Session dispatch gateway in `index.html` routing authenticated users to `/home.html` and unauthenticated sessions to `/login.html`.
- **Organisation Admin Backend APIs (`src/modules/`):**
  - Department hierarchy and dictionary endpoints (`/api/v1/departments`) with unique code constraints and member protection.
  - Position management (`/api/v1/positions`) linking clearance levels (1–4), departmental scopes, and permission sets.
  - User and employee administration (`/api/v1/users`) supporting secure password hashing, department/position foreign-key validation, and granular permission editing (`VIEW`, `UPLOAD`, `EDIT`, `SIGN`, `SHARE`, `AUDIT`, `MANAGE_ORG`).
  - Transactional persistence in Neon PostgreSQL ensuring all employee modifications persist reliably across restarts and page reloads.
- **Organisation Admin Dashboard UI (`public/dashboard.html`):**
  - Live metric summary cards: Total Departments, Positions, and Active Members.
  - Searchable and filterable data tables for departments, positions, and organisation members.
  - Modal workflows: Create Department, Configure Position & Clearance, Add Member, Edit Member Permissions, and Member Deactivation with audit logging.
  - Navigation options: "Take Me to Vault" sidebar button (`id="nav-btn-vault"`) and user profile dropdown link (`id="dropdown-vault-link"`).
  - RBAC protection: Automatically redirects users lacking the `MANAGE_ORG` permission to `/home.html`.
- **Temporary Home Page & Vault Navigation (`public/home.html`):**
  - Polished, responsive landing page served directly at `/home` and `/vault`.
  - Dynamic user profile greeting and organisation metadata resolved from `GET /api/v1/auth/me`.
  - Displays preparation notice: *"Your Vault workspace is being prepared. Document management features will be available soon."*
  - Dedicated "Organisation Administration" access button dynamically revealed strictly to users with `MANAGE_ORG` permission (hidden for regular employees).
  - Normal login navigation routes all standard employee and administrator logins to `/home.html`.
  - Preserves clean modular boundaries for Sakshi's upcoming Step 10 Vault UI (zero document uploads, mock lists, or audit viewers introduced).
- Proven by comprehensive acceptance tests across 3 suites (48 tests total):
  - `tests/auth.ui.test.js`: 21 tests validating static routing, registration/login forms, CSP headers, and dashboard modal elements.
  - `tests/users.persistence.test.js`: 16 tests verifying Neon PostgreSQL database persistence, employee creation, permission updates, department cascades, and multi-tenant isolation.
  - `tests/vault.nav.test.js`: 11 tests verifying all 9 Step 9 navigation and RBAC flows.

### Platform Super Admin Dashboard (Step 11 — Planned Phase)

> **Status:** 📋 Planned (Standalone phase scheduled after Steps 9 and 10)  
> **Ownership:** Unassigned (Separate from existing responsibilities of Member 1 and Member 2)  
> **Documentation:** Master specification documented in [`docs/STEP11-PLAN.md`](docs/STEP11-PLAN.md)  
> **Implementation Notice:** Planning and architectural specification only. No runtime application code, database migrations, or APIs have been implemented yet.

Step 11 defines a dedicated administrative capability for the team managing the overarching DocuVault multi-tenant infrastructure:

- **Clear Role & Access Boundaries:**
  - **Organisation Admin:** Manages employees, functional departments, positions, clearance assignments, and granular permissions strictly within their own organisation's enclave.
  - **Platform Super Admin:** Manages the DocuVault platform and maintains high-level operational oversight across all registered tenant organisations and employees.
- **Strict Isolation Guarantees:**
  - Organisation administrators cannot access the super-admin interface or platform endpoints.
  - Platform super administrators use a separate authentication flow and cannot bypass security or privacy controls without explicit authorization and immutable audit logging.
- **Planned Capabilities:**
  1. **Platform Overview:** Global tenant counts (active, suspended), system health, and cross-platform metric cards.
  2. **Organisation Management:** Searchable tenant registry, legal entity detail inspector, and rule-based lifecycle management (activation, suspension, deactivation).
  3. **Platform Administration:** Platform-level runtime configurations, service health diagnostics, and operational telemetry.
  4. **Super Admin Access Control:** Dedicated platform roles, permissions, and session handling separate from tenant user authentication.
  5. **Platform Audit & Security:** Cryptographic traceability for all platform-level actions, tenant status transitions, and administrative interventions.

## API

Base path `/api/v1`. All responses use `{ success, message, data }` or
`{ success: false, error: { code, message, details } }`.

| Endpoint                                 | Method | Access     | Status  | Description                                                  |
| ---------------------------------------- | ------ | ---------- | ------- | ------------------------------------------------------------ |
| `/health`                                | GET    | Public     | ✅ Live | Liveness probe; does not touch database                      |
| `/orgs`                                  | POST   | Public     | ✅ Live | Bootstrap organisation with root admin + JWT (AP-01)         |
| `/auth/login`                            | POST   | Public     | ✅ Live | Credential verification and JWT token issuance (AP-01)       |
| `/auth/me`                               | GET    | Signed in  | ✅ Live | Current user, clearance, position & permissions (AP-01)      |
| `/departments`                           | GET    | Signed in  | ✅ Live | Lists departments for organisation                           |
| `/departments`                           | POST   | MANAGE_ORG | ✅ Live | Creates departmental unit with unique code                   |
| `/departments/:id`                       | DELETE | MANAGE_ORG | ✅ Live | Deletes empty department (protected against active members)  |
| `/positions`                             | GET    | Signed in  | ✅ Live | Lists positions with clearance levels and scopes             |
| `/positions`                             | POST   | MANAGE_ORG | ✅ Live | Creates position with clearance and permission templates     |
| `/positions/:id`                         | DELETE | MANAGE_ORG | ✅ Live | Deletes position without assigned members                    |
| `/users`                                 | GET    | Signed in  | ✅ Live | Lists organisation employees with clearance and positions    |
| `/users`                                 | POST   | MANAGE_ORG | ✅ Live | Creates new employee with hashed password and permissions    |
| `/users/:id`                             | PUT    | MANAGE_ORG | ✅ Live | Updates employee attributes and granular permissions         |
| `/users/:id`                             | DELETE | MANAGE_ORG | ✅ Live | Deactivates employee and revokes active access               |
| `/workspaces`                            | POST   | UPLOAD     | ✅ Live | Creates a workspace in a department (AP-04)                  |
| `/workspaces`                            | GET    | Signed in  | ✅ Live | Lists reachable workspaces within caller scope (AP-04)       |
| `/workspaces/:id`                        | GET    | Signed in  | ✅ Live | Workspace details and member list (AP-04)                    |
| `/workspaces/:id/status`                 | PATCH  | Admin      | ✅ Live | Updates workspace status (OPEN, CLOSED, ARCHIVED) (BR-14)    |
| `/workspaces/:id/members`                | POST   | Admin      | ✅ Live | Assigns user as member to workspace (AP-04)                  |
| `/workspaces/:id/documents`              | POST   | UPLOAD     | ✅ Live | Uploads initial document v1 with SHA-256 fingerprint (AP-05) |
| `/documents`                             | GET    | VIEW       | ✅ Live | Access-filtered full-text search and listing (AP-09)         |
| `/documents/:id`                         | GET    | VIEW       | ✅ Live | Document metadata, versions, and digital signatures (AP-09)  |
| `/documents/:id/versions`                | POST   | EDIT       | ✅ Live | Concurrency-safe new version upload (AP-06)                  |
| `/documents/:id/versions/:no/download`   | GET    | VIEW       | ✅ Live | Integrity-checked streaming download (AP-07)                 |
| `/documents/:id/verify`                  | POST   | VIEW       | ✅ Live | Re-hashes all versions of document (AP-07)                   |
| `/documents/:id/versions/:no/sign`       | POST   | SIGN       | ✅ Live | Signs document version with Ed25519 signature (AP-10)        |
| `/documents/:id/versions/:no/signatures` | GET    | VIEW       | ✅ Live | Verifies each signature on document version (AP-10)          |
| `/document-types`                        | GET    | Signed in  | ✅ Live | Lists document types for organisation                        |
| `/document-types`                        | POST   | MANAGE_ORG | ✅ Live | Creates document type for organisation                       |
| `/audit`                                 | GET    | AUDIT      | ✅ Live | Filtered & paginated audit log entries (AP-08)               |
| `/audit/verify-chain`                    | GET    | AUDIT      | ✅ Live | Cryptographic chain recomputation & break detection          |
| `/audit/:seq`                            | GET    | AUDIT      | ✅ Live | Individual audit entry by sequence number                    |
| `/audit/verify-all`                      | POST   | AUDIT      | ✅ Live | Re-hashes every file in organisation (AP-07)                 |
| `/signatures/stats/unsigned-latest`      | GET    | Signed in  | ✅ Live | Latest document versions without signatures (DE-05 Q06)      |
| `/signatures/:id/verify`                 | GET    | Signed in  | ✅ Live | Cryptographic verification of single signature by ID         |

## Security principles

- Deny by default; a document you may not see returns **404**, not 403, and the attempt is audited.
- No secrets in the repository; `.env.example` lists names only.
- Parameterised SQL only; stack traces never leave the server.

## Commit convention

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), one logical change per commit,
committed right after the work is verified.
