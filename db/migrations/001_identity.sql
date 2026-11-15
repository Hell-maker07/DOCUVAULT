-- =====================================================================
-- 001_identity.sql  (Step 1, Member 1: Saubhagya)
-- Identity & access tables: organizations, classification_levels,
-- permissions, departments, positions, users, position_permissions.
--
-- NOTE: `signatures` is Member 1's table too, but it references
-- document_versions (Member 2, Step 2). It is created in a later
-- migration (004_signatures.sql, Step 7) so every FK has a parent.
-- gen_random_uuid() is built in to PostgreSQL 13+ (Neon runs 15/16+).
-- =====================================================================

-- ---------- Reference data (3NF) ----------

CREATE TABLE organizations (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(150) NOT NULL UNIQUE,
  org_type    VARCHAR(50)  NOT NULL,                 -- POLICE_JUDICIARY, CORPORATE, OTHER ...
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT organizations_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT organizations_type_not_blank CHECK (length(btrim(org_type)) > 0)
);

-- Natural key: the numeric level itself is the primary key, shared by
-- positions (clearance) and documents (classification).
CREATE TABLE classification_levels (
  level  SMALLINT    PRIMARY KEY,
  name   VARCHAR(30) NOT NULL UNIQUE,
  CONSTRAINT classification_levels_level_range CHECK (level BETWEEN 1 AND 4)
);

CREATE TABLE permissions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code         VARCHAR(30) NOT NULL UNIQUE,
  description  TEXT
);

CREATE TABLE departments (
  id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code    VARCHAR(20)  NOT NULL,
  name    VARCHAR(100) NOT NULL,
  CONSTRAINT departments_org_code_key UNIQUE (org_id, code),   -- BR-02
  CONSTRAINT departments_code_not_blank CHECK (length(btrim(code)) > 0),
  CONSTRAINT departments_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE positions (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  title            VARCHAR(100) NOT NULL,
  clearance_level  SMALLINT     NOT NULL REFERENCES classification_levels(level),
  -- ORG: every department | OWN_DEPT: own department | ASSIGNED: only workspaces joined
  dept_scope       VARCHAR(12)  NOT NULL,
  CONSTRAINT positions_org_title_key UNIQUE (org_id, title),   -- BR-02
  CONSTRAINT positions_dept_scope_check CHECK (dept_scope IN ('ORG', 'OWN_DEPT', 'ASSIGNED')),
  CONSTRAINT positions_title_not_blank CHECK (length(btrim(title)) > 0)
);

-- ---------- Identity and access ----------

CREATE TABLE users (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id    UUID         NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  position_id      UUID         NOT NULL REFERENCES positions(id)   ON DELETE RESTRICT,
  email            VARCHAR(255) NOT NULL UNIQUE,
  employee_no      VARCHAR(30),
  full_name        VARCHAR(100) NOT NULL,
  password_hash    TEXT         NOT NULL,                 -- bcrypt, never plain text
  public_key       TEXT         NOT NULL,                 -- Ed25519 public key (PEM)
  private_key_enc  TEXT         NOT NULL,                 -- Ed25519 private key, AES-256-GCM encrypted
  is_active        BOOLEAN      NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Emails are stored lower-case so UNIQUE is effectively case-insensitive (BR-01).
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_full_name_not_blank CHECK (length(btrim(full_name)) > 0)
  -- BR-06 (position and department must belong to the same organisation)
  -- is a service rule: it spans two tables, so a column CHECK cannot express it.
);

CREATE TABLE position_permissions (
  position_id    UUID NOT NULL REFERENCES positions(id)   ON DELETE CASCADE,
  permission_id  UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (position_id, permission_id)
);

-- ---------- Indexes on foreign keys not already covered by a UNIQUE/PK ----------
-- (departments.org_id and positions.org_id are covered by their composite UNIQUEs.)
CREATE INDEX idx_users_department_id          ON users (department_id);
CREATE INDEX idx_users_position_id            ON users (position_id);
CREATE INDEX idx_position_permissions_perm_id ON position_permissions (permission_id);
CREATE INDEX idx_positions_clearance_level    ON positions (clearance_level);

-- ---------- Keep users.updated_at honest ----------
CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
