-- =====================================================================
-- 003_immutability.sql  (Step 2, Member 2: Sakshi)
-- BR-07: documents are never deleted; document_versions are immutable.
-- BR-11: audit_logs are append-only. Row triggers reject UPDATE/DELETE on
-- versions and audit logs; statement triggers reject TRUNCATE. Document
-- metadata may still be updated, but document identities cannot be removed.
-- =====================================================================

CREATE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER versions_immutable BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER versions_no_truncate BEFORE TRUNCATE ON document_versions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();


-- BR-07 also says a document record itself must never be deleted. The FK from
-- document_versions protects documents that already have versions, but would
-- not protect an empty/new document. These triggers close that gap. Metadata
-- UPDATE remains permitted; only removal is forbidden.
CREATE FUNCTION forbid_document_removal() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'documents cannot be removed: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_no_delete BEFORE DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION forbid_document_removal();
CREATE TRIGGER documents_no_truncate BEFORE TRUNCATE ON documents
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_document_removal();
