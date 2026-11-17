-- =====================================================================
-- 004_signatures.sql  (Step 7, Member 1: Saubhagya)
-- Digital signatures over immutable document versions (AP-10, BR-12).
-- Each signature covers one exact version's SHA-256 fingerprint.
-- Table is append-only and protected by immutability triggers.
-- =====================================================================

CREATE TABLE signatures (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id   UUID         NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  signer_id    UUID         NOT NULL REFERENCES users(id)             ON DELETE RESTRICT,
  signature    TEXT         NOT NULL,
  signed_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT signatures_version_signer_key UNIQUE (version_id, signer_id),  -- BR-12: one signature per person per version
  CONSTRAINT signatures_signature_not_blank CHECK (length(btrim(signature)) > 0)
);

-- Foreign key indexes
CREATE INDEX idx_signatures_version_id ON signatures (version_id);
CREATE INDEX idx_signatures_signer_id  ON signatures (signer_id);

-- Immutability triggers (signatures once recorded cannot be modified or deleted)
CREATE TRIGGER signatures_immutable BEFORE UPDATE OR DELETE ON signatures
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER signatures_no_truncate BEFORE TRUNCATE ON signatures
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
