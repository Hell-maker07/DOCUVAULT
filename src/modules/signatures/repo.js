import { getPool } from '../../config/db.js';

/**
 * Loads a document version for signing verification.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} documentId
 * @param {number} versionNo
 */
export async function findVersionForSigning(client = getPool(), documentId, versionNo) {
  const { rows } = await client.query(
    `SELECT v.id, v.document_id, v.version_no, v.sha256, v.storage_path, v.file_name,
            d.workspace_id, d.classification, dp.org_id
     FROM document_versions v
     JOIN documents d ON d.id = v.document_id
     JOIN workspaces w ON w.id = d.workspace_id
     JOIN departments dp ON dp.id = w.department_id
     WHERE v.document_id = $1 AND v.version_no = $2`,
    [documentId, versionNo],
  );
  return rows[0] || null;
}

/**
 * Loads the user's public and encrypted private key for signing.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} userId
 */
export async function findSignerKeys(client = getPool(), userId) {
  const { rows } = await client.query(
    `SELECT id, full_name, email, public_key, private_key_enc, is_active
     FROM users
     WHERE id = $1`,
    [userId],
  );
  return rows[0] || null;
}

/**
 * Checks if a specific user has already signed a specific document version.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} versionId
 * @param {string} signerId
 */
export async function findSignature(client = getPool(), versionId, signerId) {
  const { rows } = await client.query(
    `SELECT id, version_id, signer_id, signature, signed_at
     FROM signatures
     WHERE version_id = $1 AND signer_id = $2`,
    [versionId, signerId],
  );
  return rows[0] || null;
}

/**
 * Inserts a new digital signature record.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {object} params
 * @param {string} params.versionId
 * @param {string} params.signerId
 * @param {string} params.signature Base64 Ed25519 signature
 */
export async function insertSignature(client = getPool(), { versionId, signerId, signature }) {
  const { rows } = await client.query(
    `INSERT INTO signatures (version_id, signer_id, signature)
     VALUES ($1, $2, $3)
     RETURNING id, version_id, signer_id, signature, signed_at`,
    [versionId, signerId, signature],
  );
  return rows[0];
}

/**
 * Retrieves all digital signatures for a given document version along with signer identity info.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} documentId
 * @param {number} versionNo
 */
export async function findSignaturesByVersion(client = getPool(), documentId, versionNo) {
  const { rows } = await client.query(
    `SELECT s.id, s.version_id, s.signer_id, s.signature, s.signed_at,
            u.full_name, u.email, u.public_key,
            v.sha256, v.version_no, v.document_id
     FROM signatures s
     JOIN document_versions v ON v.id = s.version_id
     JOIN users u ON u.id = s.signer_id
     WHERE v.document_id = $1 AND v.version_no = $2
     ORDER BY s.signed_at ASC`,
    [documentId, versionNo],
  );
  return rows;
}

/**
 * Retrieves a single signature by primary key with document and signer context.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} signatureId
 */
export async function findSignatureById(client = getPool(), signatureId) {
  const { rows } = await client.query(
    `SELECT s.id, s.version_id, s.signer_id, s.signature, s.signed_at,
            u.full_name, u.email, u.public_key,
            v.sha256, v.version_no, v.document_id, dp.org_id
     FROM signatures s
     JOIN document_versions v ON v.id = s.version_id
     JOIN documents d ON d.id = v.document_id
     JOIN workspaces w ON w.id = d.workspace_id
     JOIN departments dp ON dp.id = w.department_id
     JOIN users u ON u.id = s.signer_id
     WHERE s.id = $1`,
    [signatureId],
  );
  return rows[0] || null;
}

/**
 * DE-05 Q06: Retrieves latest versions that nobody has signed yet.
 * Uses LEFT JOIN with anti-join (s.id IS NULL).
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} orgId
 */
export async function findUnsignedLatestVersions(client = getPool(), orgId) {
  const { rows } = await client.query(
    `SELECT d.id AS document_id, d.title, d.classification,
            v.id AS version_id, v.version_no, v.sha256, v.file_name, v.uploaded_at
     FROM documents d
     JOIN workspaces w ON w.id = d.workspace_id
     JOIN departments dp ON dp.id = w.department_id
     JOIN LATERAL (
       SELECT id, version_no, sha256, file_name, uploaded_at
       FROM document_versions
       WHERE document_id = d.id
       ORDER BY version_no DESC
       LIMIT 1
     ) v ON true
     LEFT JOIN signatures s ON s.version_id = v.id
     WHERE dp.org_id = $1
       AND s.id IS NULL
     ORDER BY v.uploaded_at DESC`,
    [orgId],
  );
  return rows;
}
