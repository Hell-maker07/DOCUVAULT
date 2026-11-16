-- =====================================================================
-- 002_vault.sql  (Step 2, Member 2: Sakshi)
-- Vault tables: document_types, workspaces, workspace_members,
-- documents, document_versions, access_grants, audit_logs.
-- Immutability triggers live in 003_immutability.sql.
-- =====================================================================

CREATE TABLE document_types (
  id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name    VARCHAR(100) NOT NULL,
  CONSTRAINT document_types_org_name_key UNIQUE (org_id, name),      -- BR-02
  CONSTRAINT document_types_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE workspaces (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id  UUID         NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  name           VARCHAR(150) NOT NULL,
  description    TEXT,
  status         VARCHAR(10)  NOT NULL DEFAULT 'OPEN',
  created_by     UUID         NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_dept_name_key UNIQUE (department_id, name), -- BR-02
  CONSTRAINT workspaces_status_check CHECK (status IN ('OPEN', 'CLOSED', 'ARCHIVED')),
  CONSTRAINT workspaces_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE workspace_members (
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- Identity of a record. File contents live in document_versions.
-- The owning department is derived from the workspace, never stored here.
CREATE TABLE documents (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID         NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  type_id         UUID         NOT NULL REFERENCES document_types(id) ON DELETE RESTRICT,
  classification  SMALLINT     NOT NULL REFERENCES classification_levels(level),
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  search_vec      TSVECTOR GENERATED ALWAYS AS (
                    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
                  ) STORED,
  created_by      UUID         NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT documents_title_not_blank CHECK (length(btrim(title)) > 0)
);

-- Every uploaded file state. Rows are immutable (see 003_immutability.sql).
CREATE TABLE document_versions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID         NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  version_no    INT          NOT NULL,
  file_name     VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  size_bytes    BIGINT       NOT NULL,
  sha256        CHAR(64)     NOT NULL,
  storage_path  TEXT         NOT NULL,
  change_note   TEXT,
  uploaded_by   UUID         NOT NULL REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT document_versions_doc_no_key UNIQUE (document_id, version_no),   -- BR-08
  CONSTRAINT document_versions_no_positive CHECK (version_no >= 1),
  CONSTRAINT document_versions_size_positive CHECK (size_bytes > 0),
  CONSTRAINT document_versions_sha256_hex CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

-- A temporary exception: one user may view one document until expires_at.
-- The "at most 30 days" and "receiver clearance >= classification" rules are
-- service rules (BR-13): they depend on other tables / request context.
CREATE TABLE access_grants (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID        NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  user_id      UUID        NOT NULL REFERENCES users(id),
  granted_by   UUID        NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  CONSTRAINT access_grants_expiry_after_creation CHECK (expires_at > created_at)
);

-- Append-only, hash-chained history. One chain per organisation (UNIQUE(org_id, seq)).
-- created_at has no default on purpose: the writer supplies the exact value that is hashed.
CREATE TABLE audit_logs (
  id           BIGSERIAL    PRIMARY KEY,
  org_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_id     UUID         REFERENCES users(id),     -- NULL: failed login by an unknown user
  seq          INT          NOT NULL,
  action       VARCHAR(40)  NOT NULL,
  entity_type  VARCHAR(30),
  entity_id    UUID,
  outcome      VARCHAR(7)   NOT NULL,
  details      JSONB,
  ip           INET,
  created_at   TIMESTAMPTZ  NOT NULL,
  prev_hash    CHAR(64)     NOT NULL,                 -- 64 zeros for the first row of a chain
  hash         CHAR(64)     NOT NULL UNIQUE,
  CONSTRAINT audit_logs_org_seq_key UNIQUE (org_id, seq),
  CONSTRAINT audit_logs_seq_positive CHECK (seq >= 1),
  CONSTRAINT audit_logs_action_check CHECK (action IN (
    'LOGIN', 'LOGIN_FAILED', 'UPLOAD', 'NEW_VERSION', 'VIEW', 'DOWNLOAD',
    'VERIFY', 'SIGN', 'GRANT', 'ACCESS_DENIED', 'ADMIN_CHANGE')),
  CONSTRAINT audit_logs_outcome_check CHECK (outcome IN ('ALLOWED', 'DENIED', 'FAILED')),
  CONSTRAINT audit_logs_prev_hash_hex CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT audit_logs_hash_hex CHECK (hash ~ '^[0-9a-f]{64}$')
);

-- ---------- Indexes ----------
-- Full-text search (DE-08): GIN on the generated tsvector.
CREATE INDEX idx_documents_search_vec     ON documents USING GIN (search_vec);
CREATE INDEX idx_documents_workspace_id   ON documents (workspace_id);
CREATE INDEX idx_documents_classification ON documents (classification);
CREATE INDEX idx_documents_type_id        ON documents (type_id);
CREATE INDEX idx_documents_created_by     ON documents (created_by);

CREATE INDEX idx_workspaces_created_by       ON workspaces (created_by);
CREATE INDEX idx_workspace_members_user_id   ON workspace_members (user_id);
CREATE INDEX idx_document_versions_uploaded_by ON document_versions (uploaded_by);

-- Grant lookups: "does this user hold an unexpired grant on this document?"
-- Supports the policy check on (document_id, user_id, expires_at). The
-- second index supports per-user expiry reports (for example Q09).
CREATE INDEX idx_access_grants_document_user_expires
  ON access_grants (document_id, user_id, expires_at);
CREATE INDEX idx_access_grants_user_expires
  ON access_grants (user_id, expires_at);

CREATE INDEX idx_audit_logs_org_created      ON audit_logs (org_id, created_at);
CREATE INDEX idx_audit_logs_actor_id         ON audit_logs (actor_id);
CREATE INDEX idx_audit_logs_entity           ON audit_logs (entity_type, entity_id);
