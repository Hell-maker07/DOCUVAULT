import { getPool } from '../../config/db.js';
import { buildAccessFilter } from '../../policy/decide.js';

/**
 * Inserts a document identity record.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {object} params
 */
export async function insertDocument(
  client = getPool(),
  { id, workspaceId, typeId, classification, title, description = null, createdBy },
) {
  const { rows } = await client.query(
    `INSERT INTO documents (id, workspace_id, type_id, classification, title, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, workspace_id, type_id, classification, title, description, created_by, created_at`,
    [id, workspaceId, typeId, classification, title, description, createdBy],
  );
  return rows[0];
}

/**
 * Inserts a new immutable document version row.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {object} params
 */
export async function insertDocumentVersion(
  client = getPool(),
  {
    documentId,
    versionNo,
    fileName,
    mimeType,
    sizeBytes,
    sha256,
    storagePath,
    changeNote = null,
    uploadedBy,
  },
) {
  const { rows } = await client.query(
    `INSERT INTO document_versions (
       document_id, version_no, file_name, mime_type, size_bytes,
       sha256, storage_path, change_note, uploaded_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, document_id, version_no, file_name, mime_type, size_bytes, sha256, storage_path, change_note, uploaded_by, uploaded_at`,
    [
      documentId,
      versionNo,
      fileName,
      mimeType,
      sizeBytes,
      sha256,
      storagePath,
      changeNote,
      uploadedBy,
    ],
  );
  return rows[0];
}

/**
 * Locks the document row inside an active transaction to serialize concurrent version increments.
 *
 * @param {import('pg').PoolClient} tx
 * @param {string} documentId
 */
export async function lockDocumentForUpdate(tx, documentId) {
  const { rows } = await tx.query(
    `SELECT d.id, d.workspace_id, d.classification, w.status AS workspace_status, dp.org_id
     FROM documents d
     JOIN workspaces w ON w.id = d.workspace_id
     JOIN departments dp ON dp.id = w.department_id
     WHERE d.id = $1
     FOR UPDATE`,
    [documentId],
  );
  return rows[0] || null;
}

/**
 * Calculates the next version number for a document inside a transaction.
 *
 * @param {import('pg').PoolClient} tx
 * @param {string} documentId
 */
export async function getNextVersionNo(tx, documentId) {
  const { rows } = await tx.query(
    `SELECT COALESCE(MAX(version_no), 0) + 1 AS next
     FROM document_versions
     WHERE document_id = $1`,
    [documentId],
  );
  return Number(rows[0].next);
}

/**
 * Fetches document metadata, workspace context, and department.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} documentId
 */
export async function findDocumentById(client = getPool(), documentId) {
  const { rows } = await client.query(
    `SELECT d.id, d.title, d.description, d.classification, d.created_at, d.created_by,
            d.workspace_id, w.name AS workspace_name, w.status AS workspace_status,
            d.type_id, dt.name AS type_name,
            w.department_id, dp.name AS department_name, dp.org_id,
            u.full_name AS creator_name, u.email AS creator_email
     FROM documents d
     JOIN workspaces w ON w.id = d.workspace_id
     JOIN departments dp ON dp.id = w.department_id
     JOIN document_types dt ON dt.id = d.type_id
     JOIN users u ON u.id = d.created_by
     WHERE d.id = $1`,
    [documentId],
  );
  return rows[0] || null;
}

/**
 * Retrieves all versions of a document ordered by version_no ASC.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} documentId
 */
export async function findDocumentVersions(client = getPool(), documentId) {
  const { rows } = await client.query(
    `SELECT v.id, v.document_id, v.version_no, v.file_name, v.mime_type,
            v.size_bytes, v.sha256, v.storage_path, v.change_note,
            v.uploaded_by, v.uploaded_at,
            u.full_name AS uploader_name, u.email AS uploader_email
     FROM document_versions v
     JOIN users u ON u.id = v.uploaded_by
     WHERE v.document_id = $1
     ORDER BY v.version_no ASC`,
    [documentId],
  );
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    versionNo: Number(r.version_no),
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    sha256: r.sha256.trim(),
    storagePath: r.storage_path,
    changeNote: r.change_note,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at,
    uploader: {
      id: r.uploaded_by,
      fullName: r.uploader_name,
      email: r.uploader_email,
    },
  }));
}

/**
 * Loads a single document version by document ID and version number.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} documentId
 * @param {number} versionNo
 */
export async function findVersionByDocAndNo(client = getPool(), documentId, versionNo) {
  const { rows } = await client.query(
    `SELECT v.id, v.document_id, v.version_no, v.file_name, v.mime_type,
            v.size_bytes, v.sha256, v.storage_path, v.change_note,
            v.uploaded_by, v.uploaded_at,
            dp.org_id, w.status AS workspace_status,
            u.full_name AS uploader_name, u.email AS uploader_email
     FROM document_versions v
     JOIN documents d ON d.id = v.document_id
     JOIN workspaces w ON w.id = d.workspace_id
     JOIN departments dp ON dp.id = w.department_id
     JOIN users u ON u.id = v.uploaded_by
     WHERE v.document_id = $1 AND v.version_no = $2`,
    [documentId, versionNo],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id,
    documentId: r.document_id,
    versionNo: Number(r.version_no),
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    sha256: r.sha256.trim(),
    storagePath: r.storage_path,
    changeNote: r.change_note,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at,
    orgId: r.org_id,
    workspaceStatus: r.workspace_status,
    uploader: {
      id: r.uploaded_by,
      fullName: r.uploader_name,
      email: r.uploader_email,
    },
  };
}

/**
 * Searches and filters documents accessible to the caller, applying the RBAC access filter and full-text search.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {object} user Policy user context
 * @param {object} filters Search and pagination filters
 */
export async function searchAccessibleDocuments(client = getPool(), user, filters = {}) {
  const { q, typeId, workspaceId, classification, from, to, page = 1, pageSize = 20 } = filters;

  const userContext = {
    ...user,
    clearance: user.clearance !== undefined ? user.clearance : user.clearanceLevel,
  };
  const access = buildAccessFilter(userContext, 1, 'd', 'w', 'dp');
  const conditions = [access.sql];
  const params = [...access.params];
  let idx = params.length + 1;

  if (q && q.trim()) {
    conditions.push(`d.search_vec @@ plainto_tsquery('english', $${idx++})`);
    params.push(q.trim());
  }
  if (typeId) {
    conditions.push(`d.type_id = $${idx++}`);
    params.push(typeId);
  }
  if (workspaceId) {
    conditions.push(`d.workspace_id = $${idx++}`);
    params.push(workspaceId);
  }
  if (classification !== undefined) {
    conditions.push(`d.classification = $${idx++}`);
    params.push(Number(classification));
  }
  if (from) {
    conditions.push(`d.created_at >= $${idx++}`);
    params.push(new Date(from).toISOString());
  }
  if (to) {
    conditions.push(`d.created_at <= $${idx++}`);
    params.push(new Date(to).toISOString());
  }

  const whereClause = conditions.join(' AND ');

  // 1. Total matching count
  const countSql = `
    SELECT count(*)::int AS total
    FROM documents d
    JOIN workspaces w ON w.id = d.workspace_id
    JOIN departments dp ON dp.id = w.department_id
    WHERE ${whereClause}
  `;
  const countRes = await client.query(countSql, params);
  const total = countRes.rows[0].total;

  // 2. Data page
  const offset = (page - 1) * pageSize;
  const dataSql = `
    SELECT d.id, d.title, d.description, d.classification, d.created_at, d.created_by,
           d.workspace_id, w.name AS workspace_name,
           d.type_id, dt.name AS type_name,
           dp.id AS department_id, dp.name AS department_name,
           v.version_no AS latest_version_no, v.file_name AS latest_file_name,
           v.sha256 AS latest_sha256, v.uploaded_at AS latest_uploaded_at,
           v.mime_type AS latest_mime_type, v.size_bytes AS latest_size_bytes
    FROM documents d
    JOIN workspaces w ON w.id = d.workspace_id
    JOIN departments dp ON dp.id = w.department_id
    JOIN document_types dt ON dt.id = d.type_id
    JOIN LATERAL (
      SELECT version_no, file_name, sha256, uploaded_at, mime_type, size_bytes
      FROM document_versions
      WHERE document_id = d.id
      ORDER BY version_no DESC
      LIMIT 1
    ) v ON true
    WHERE ${whereClause}
    ORDER BY d.created_at DESC
    LIMIT $${idx++} OFFSET $${idx++}
  `;
  const dataParams = [...params, pageSize, offset];
  const { rows } = await client.query(dataSql, dataParams);

  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      classification: Number(r.classification),
      createdAt: r.created_at,
      createdBy: r.created_by,
      workspace: {
        id: r.workspace_id,
        name: r.workspace_name,
      },
      department: {
        id: r.department_id,
        name: r.department_name,
      },
      type: {
        id: r.type_id,
        name: r.type_name,
      },
      latestVersion: {
        versionNo: Number(r.latest_version_no),
        fileName: r.latest_file_name,
        sha256: r.latest_sha256.trim(),
        mimeType: r.latest_mime_type,
        sizeBytes: Number(r.latest_size_bytes),
        uploadedAt: r.latest_uploaded_at,
      },
    })),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
}

/**
 * Loads all signatures for any version of a document.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} documentId
 */
export async function findDocumentSignatures(client = getPool(), documentId) {
  const { rows } = await client.query(
    `SELECT s.id, s.version_id, v.version_no, s.signer_id, s.signature, s.signed_at,
            u.full_name, u.email, u.public_key, v.sha256
     FROM signatures s
     JOIN document_versions v ON v.id = s.version_id
     JOIN users u ON u.id = s.signer_id
     WHERE v.document_id = $1
     ORDER BY v.version_no ASC, s.signed_at ASC`,
    [documentId],
  );
  return rows.map((r) => ({
    id: r.id,
    versionId: r.version_id,
    versionNo: Number(r.version_no),
    signature: r.signature,
    signedAt: r.signed_at,
    sha256: r.sha256.trim(),
    signer: {
      id: r.signer_id,
      fullName: r.full_name,
      email: r.email,
      publicKey: r.public_key,
    },
  }));
}

/**
 * Inserts a new document type for an organisation.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {object} params
 */
export async function insertDocumentType(client = getPool(), { orgId, name }) {
  const { rows } = await client.query(
    `INSERT INTO document_types (org_id, name)
     VALUES ($1, $2)
     RETURNING id, org_id, name`,
    [orgId, name],
  );
  return rows[0];
}

/**
 * Lists all document types for an organisation.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} orgId
 */
export async function findDocumentTypesByOrg(client = getPool(), orgId) {
  const { rows } = await client.query(
    `SELECT id, org_id, name FROM document_types WHERE org_id = $1 ORDER BY name ASC`,
    [orgId],
  );
  return rows;
}

/**
 * Fetches a document type by ID.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} id
 */
export async function findDocumentTypeById(client = getPool(), id) {
  const { rows } = await client.query(`SELECT id, org_id, name FROM document_types WHERE id = $1`, [
    id,
  ]);
  return rows[0] || null;
}

/**
 * Fetches all document versions in an organisation for batch verification (POST /audit/verify-all).
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} orgId
 */
export async function findAllVersionsInOrg(client = getPool(), orgId) {
  const { rows } = await client.query(
    `SELECT v.id, v.document_id, v.version_no, v.file_name, v.sha256, v.storage_path,
            d.title, dp.name AS department_name
     FROM document_versions v
     JOIN documents d ON d.id = v.document_id
     JOIN workspaces w ON w.id = d.workspace_id
     JOIN departments dp ON dp.id = w.department_id
     WHERE dp.org_id = $1
     ORDER BY v.uploaded_at DESC`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    versionNo: Number(r.version_no),
    fileName: r.file_name,
    sha256: r.sha256.trim(),
    storagePath: r.storage_path,
    documentTitle: r.title,
    departmentName: r.department_name,
  }));
}

/**
 * DE-05 Q01: Documents per department per classification level.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} orgId
 */
export async function getDocumentsPerDeptClassification(client = getPool(), orgId) {
  const { rows } = await client.query(
    `SELECT dp.id AS department_id, dp.name AS department_name,
            d.classification, count(d.id)::int AS document_count
     FROM departments dp
     JOIN workspaces w ON w.department_id = dp.id
     JOIN documents d ON d.workspace_id = w.id
     WHERE dp.org_id = $1
     GROUP BY dp.id, dp.name, d.classification
     ORDER BY dp.name ASC, d.classification ASC`,
    [orgId],
  );
  return rows;
}

/**
 * DE-05 Q05: Documents with more than a given number of versions.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} orgId
 * @param {number} [minVersions=3]
 */
export async function getDocumentsWithMultipleVersions(client = getPool(), orgId, minVersions = 3) {
  const { rows } = await client.query(
    `SELECT d.id, d.title, d.classification, count(v.id)::int AS version_count
     FROM documents d
     JOIN workspaces w ON w.id = d.workspace_id
     JOIN departments dp ON dp.id = w.department_id
     JOIN document_versions v ON v.document_id = d.id
     WHERE dp.org_id = $1
     GROUP BY d.id, d.title, d.classification
     HAVING count(v.id) > $2
     ORDER BY version_count DESC`,
    [orgId, minVersions],
  );
  return rows;
}

/**
 * DE-05 Q12: Rank positions by documents opened (viewed/downloaded).
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} orgId
 */
export async function getPositionsRankedByDocsOpened(client = getPool(), orgId) {
  const { rows } = await client.query(
    `SELECT p.id AS position_id, p.title AS position_title,
            count(a.id)::int AS opened_count,
            RANK() OVER (ORDER BY count(a.id) DESC)::int AS rank
     FROM audit_logs a
     JOIN users u ON u.id = a.actor_id
     JOIN positions p ON p.id = u.position_id
     WHERE a.org_id = $1 AND a.action IN ('VIEW', 'DOWNLOAD') AND a.outcome = 'ALLOWED'
     GROUP BY p.id, p.title
     ORDER BY rank ASC`,
    [orgId],
  );
  return rows;
}
