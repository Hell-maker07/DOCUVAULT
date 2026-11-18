import crypto from 'node:crypto';
import { getPool, withTransaction } from '../../config/db.js';
import { storage } from '../../storage/index.js';
import { buildStoragePath, sha256, verifyIntegrity } from '../../utils/hash.js';
import { appendAudit, writeAudit } from '../audit/auditWriter.js';
import AppError from '../../utils/AppError.js';
import {
  insertDocument,
  insertDocumentVersion,
  lockDocumentForUpdate,
  getNextVersionNo,
  findDocumentById,
  findDocumentVersions,
  findVersionByDocAndNo,
  searchAccessibleDocuments,
  findDocumentSignatures,
  insertDocumentType,
  findDocumentTypesByOrg,
  findDocumentTypeById,
  findAllVersionsInOrg,
  getDocumentsPerDeptClassification,
  getDocumentsWithMultipleVersions,
  getPositionsRankedByDocsOpened,
} from './repo.js';

/**
 * Uploads an initial file as version 1 of a new document (request 14, AP-05).
 * Generates an isolated storage path, calculates SHA-256 fingerprint, saves file in object storage,
 * and inserts document and version 1 records in a single database transaction with audit logging.
 *
 * @param {object} params
 * @param {string} params.workspaceId
 * @param {string} params.title
 * @param {string} params.typeId
 * @param {number} params.classification
 * @param {string} [params.description]
 * @param {Express.Multer.File} params.file Uploaded file in memory
 * @param {object} params.user Authenticated policy user
 * @param {string|null} [params.ip]
 */
export async function uploadDocument({
  workspaceId,
  title,
  typeId,
  classification,
  description = null,
  file,
  user,
  ip = null,
}) {
  if (!file || !file.buffer) {
    throw new AppError('File upload is required', 400, 'VALIDATION_ERROR');
  }

  // 1. Verify document type belongs to this organisation
  const docType = await findDocumentTypeById(getPool(), typeId);
  if (!docType || docType.org_id !== user.orgId) {
    throw new AppError('Invalid document type for this organisation', 400, 'VALIDATION_ERROR');
  }

  const docId = crypto.randomUUID();
  const fileHash = file.sha256 || sha256(file.buffer);
  const storagePath = buildStoragePath({
    orgId: user.orgId,
    docId,
    versionNo: 1,
    fileName: file.originalname,
  });

  // 2. Put file to storage
  await storage.put(storagePath, file.buffer, file.mimetype);

  // 3. Atomically persist document identity, version 1, and audit entry in database
  try {
    return await withTransaction(async (tx) => {
      const doc = await insertDocument(tx, {
        id: docId,
        workspaceId,
        typeId,
        classification: Number(classification),
        title,
        description,
        createdBy: user.id,
      });

      const version = await insertDocumentVersion(tx, {
        documentId: docId,
        versionNo: 1,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256: fileHash,
        storagePath,
        changeNote: 'Initial upload',
        uploadedBy: user.id,
      });

      await appendAudit(tx, {
        orgId: user.orgId,
        actorId: user.id,
        action: 'UPLOAD',
        outcome: 'ALLOWED',
        entityType: 'DOCUMENT',
        entityId: docId,
        details: {
          versionNo: 1,
          sha256: fileHash,
          fileName: file.originalname,
          sizeBytes: file.size,
          classification: Number(classification),
          title,
        },
        ip,
      });

      return {
        documentId: doc.id,
        versionNo: Number(version.version_no),
        sha256: version.sha256.trim(),
        storagePath: version.storage_path,
        title: doc.title,
        classification: Number(doc.classification),
        fileName: version.file_name,
        sizeBytes: Number(version.size_bytes),
        uploadedAt: version.uploaded_at,
      };
    });
  } catch (err) {
    // On any database failure, clean up the written file from object storage
    await storage.delete(storagePath).catch(() => {});
    throw err;
  }
}

/**
 * Uploads a new version of an existing document without modifying historical versions (request 15, AP-06).
 * Enforces concurrency safety: locks the document row (SELECT FOR UPDATE) to prevent race conditions on version_no.
 *
 * @param {object} params
 * @param {string} params.documentId
 * @param {Express.Multer.File} params.file Uploaded file in memory
 * @param {string} [params.changeNote]
 * @param {object} params.user Authenticated user context
 * @param {string|null} [params.ip]
 */
export async function uploadNewVersion({ documentId, file, changeNote = null, user, ip = null }) {
  if (!file || !file.buffer) {
    throw new AppError('File upload is required', 400, 'VALIDATION_ERROR');
  }

  const fileHash = file.sha256 || sha256(file.buffer);
  let savedStoragePath = null;

  try {
    return await withTransaction(async (tx) => {
      // 1. Lock document row to prevent concurrent version numbering collisions
      const doc = await lockDocumentForUpdate(tx, documentId);
      if (!doc) {
        throw new AppError('Document not found', 404, 'NOT_FOUND');
      }

      // BR-14: Writes disallowed if workspace is CLOSED or ARCHIVED
      if (doc.workspace_status === 'CLOSED' || doc.workspace_status === 'ARCHIVED') {
        throw new AppError(
          `Workspace is ${doc.workspace_status.toLowerCase()}`,
          409,
          'WORKSPACE_CLOSED',
        );
      }

      // 2. Compute next sequential version number
      const nextVersion = await getNextVersionNo(tx, documentId);

      // 3. Write file bytes to storage
      savedStoragePath = buildStoragePath({
        orgId: doc.org_id,
        docId: documentId,
        versionNo: nextVersion,
        fileName: file.originalname,
      });

      await storage.put(savedStoragePath, file.buffer, file.mimetype);

      // 4. Insert version row
      const version = await insertDocumentVersion(tx, {
        documentId,
        versionNo: nextVersion,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256: fileHash,
        storagePath: savedStoragePath,
        changeNote,
        uploadedBy: user.id,
      });

      // 5. Append audit log
      await appendAudit(tx, {
        orgId: doc.org_id,
        actorId: user.id,
        action: 'NEW_VERSION',
        outcome: 'ALLOWED',
        entityType: 'DOCUMENT',
        entityId: documentId,
        details: {
          versionNo: nextVersion,
          sha256: fileHash,
          fileName: file.originalname,
          sizeBytes: file.size,
          changeNote,
        },
        ip,
      });

      return {
        documentId,
        versionNo: Number(version.version_no),
        sha256: version.sha256.trim(),
        storagePath: version.storage_path,
        fileName: version.file_name,
        sizeBytes: Number(version.size_bytes),
        uploadedAt: version.uploaded_at,
      };
    });
  } catch (err) {
    if (savedStoragePath) {
      await storage.delete(savedStoragePath).catch(() => {});
    }
    throw err;
  }
}

/**
 * Downloads a specific document version and performs cryptographic integrity verification (request 18, AP-07).
 * Re-hashes file bytes upon retrieval and validates against the database sha256 before streaming.
 *
 * @param {object} params
 * @param {string} params.documentId
 * @param {number} params.versionNo
 * @param {object} params.user Authenticated user context
 * @param {string|null} [params.ip]
 */
export async function downloadDocumentVersion({ documentId, versionNo, user, ip = null }) {
  const version = await findVersionByDocAndNo(getPool(), documentId, versionNo);
  if (!version) {
    throw new AppError(
      `Version ${versionNo} not found for document ${documentId}`,
      404,
      'NOT_FOUND',
    );
  }

  // 1. Fetch file bytes from storage
  let fileResult;
  try {
    fileResult = await storage.get(version.storagePath);
  } catch (err) {
    await writeAudit({
      orgId: version.orgId,
      actorId: user.id,
      action: 'VERIFY',
      outcome: 'FAILED',
      entityType: 'DOCUMENT',
      entityId: documentId,
      details: {
        versionNo,
        status: 'MISSING',
        storagePath: version.storagePath,
        error: err.message,
      },
      ip,
    }).catch(() => {});

    throw new AppError('Document file not found in storage', 404, 'NOT_FOUND');
  }

  // 2. Cryptographically re-hash file bytes
  const integrity = verifyIntegrity(fileResult.buffer, version.sha256);

  if (!integrity.verified) {
    // Log integrity tampering violation in the audit trail
    await writeAudit({
      orgId: version.orgId,
      actorId: user.id,
      action: 'VERIFY',
      outcome: 'FAILED',
      entityType: 'DOCUMENT',
      entityId: documentId,
      details: {
        versionNo,
        expected: version.sha256,
        actual: integrity.actualHash,
        status: 'TAMPERED',
      },
      ip,
    }).catch(() => {});

    throw new AppError(
      'Document file integrity verification failed: file is tampered',
      409,
      'INTEGRITY_FAILURE',
    );
  }

  // 3. Log successful download in audit trail
  await writeAudit({
    orgId: version.orgId,
    actorId: user.id,
    action: 'DOWNLOAD',
    outcome: 'ALLOWED',
    entityType: 'DOCUMENT',
    entityId: documentId,
    details: {
      versionNo,
      sha256: version.sha256,
      fileName: version.fileName,
    },
    ip,
  }).catch(() => {});

  return {
    buffer: fileResult.buffer,
    fileName: version.fileName,
    mimeType: version.mimeType,
    size: version.sizeBytes,
    sha256: version.sha256,
  };
}

/**
 * Re-hashes every version of a document against storage and reports VERIFIED or TAMPERED (request 19, AP-07).
 *
 * @param {object} params
 * @param {string} params.documentId
 * @param {object} params.user Authenticated user context
 * @param {string|null} [params.ip]
 */
export async function verifyDocumentIntegrity({ documentId, user, ip = null }) {
  const doc = await findDocumentById(getPool(), documentId);
  if (!doc) {
    throw new AppError('Document not found', 404, 'NOT_FOUND');
  }

  const versions = await findDocumentVersions(getPool(), documentId);
  const versionResults = [];

  for (const v of versions) {
    try {
      const fileResult = await storage.get(v.storagePath);
      const integrity = verifyIntegrity(fileResult.buffer, v.sha256);
      versionResults.push({
        versionNo: v.versionNo,
        fileName: v.fileName,
        sha256: v.sha256,
        verified: integrity.verified,
        status: integrity.status,
        actualHash: integrity.actualHash,
      });

      if (!integrity.verified) {
        await writeAudit({
          orgId: doc.org_id,
          actorId: user.id,
          action: 'VERIFY',
          outcome: 'FAILED',
          entityType: 'DOCUMENT',
          entityId: documentId,
          details: {
            versionNo: v.versionNo,
            expected: v.sha256,
            actual: integrity.actualHash,
            status: 'TAMPERED',
          },
          ip,
        }).catch(() => {});
      }
    } catch {
      versionResults.push({
        versionNo: v.versionNo,
        fileName: v.fileName,
        sha256: v.sha256,
        verified: false,
        status: 'MISSING',
      });
    }
  }

  const allVerified = versionResults.length > 0 && versionResults.every((r) => r.verified);

  if (allVerified) {
    await writeAudit({
      orgId: doc.org_id,
      actorId: user.id,
      action: 'VERIFY',
      outcome: 'ALLOWED',
      entityType: 'DOCUMENT',
      entityId: documentId,
      details: {
        totalVersions: versions.length,
        status: 'ALL_VERIFIED',
      },
      ip,
    }).catch(() => {});
  }

  return {
    documentId,
    title: doc.title,
    count: versionResults.length,
    allVerified,
    versions: versionResults,
  };
}

/**
 * Re-hashes every document version in the organisation and reports tamper status (request 25, AP-07).
 *
 * @param {string} orgId
 * @param {string} actorId
 * @param {string|null} [ip]
 */
export async function verifyAllOrganisationFiles(orgId, actorId, ip = null) {
  const versions = await findAllVersionsInOrg(getPool(), orgId);
  const results = [];
  const tamperedList = [];

  for (const v of versions) {
    try {
      const fileResult = await storage.get(v.storagePath);
      const integrity = verifyIntegrity(fileResult.buffer, v.sha256);
      const item = {
        documentId: v.documentId,
        documentTitle: v.documentTitle,
        versionNo: v.versionNo,
        fileName: v.fileName,
        expectedHash: v.sha256,
        actualHash: integrity.actualHash,
        verified: integrity.verified,
        status: integrity.status,
      };
      results.push(item);

      if (!integrity.verified) {
        tamperedList.push(item);
        await writeAudit({
          orgId,
          actorId,
          action: 'VERIFY',
          outcome: 'FAILED',
          entityType: 'DOCUMENT',
          entityId: v.documentId,
          details: {
            versionNo: v.versionNo,
            expected: v.sha256,
            actual: integrity.actualHash,
            status: 'TAMPERED',
          },
          ip,
        }).catch(() => {});
      }
    } catch {
      const missingItem = {
        documentId: v.documentId,
        documentTitle: v.documentTitle,
        versionNo: v.versionNo,
        fileName: v.fileName,
        expectedHash: v.sha256,
        verified: false,
        status: 'MISSING',
      };
      results.push(missingItem);
      tamperedList.push(missingItem);
    }
  }

  const allVerified = tamperedList.length === 0;

  await writeAudit({
    orgId,
    actorId,
    action: 'VERIFY',
    outcome: allVerified ? 'ALLOWED' : 'FAILED',
    details: {
      action: 'VERIFY_ALL_FILES',
      totalChecked: results.length,
      tamperedCount: tamperedList.length,
      allVerified,
    },
    ip,
  }).catch(() => {});

  return {
    totalChecked: results.length,
    allVerified,
    tamperedCount: tamperedList.length,
    tamperedVersions: tamperedList,
  };
}

/**
 * Loads full document metadata, version history, and digital signatures (request 17).
 *
 * @param {object} params
 * @param {string} params.documentId
 * @param {object} params.user
 * @param {string|null} [params.ip]
 */
export async function getDocumentDetails({ documentId, user, ip = null }) {
  const doc = await findDocumentById(getPool(), documentId);
  if (!doc) {
    throw new AppError('Document not found', 404, 'NOT_FOUND');
  }

  const versions = await findDocumentVersions(getPool(), documentId);
  const signatures = await findDocumentSignatures(getPool(), documentId);

  // Audit view event
  await writeAudit({
    orgId: doc.org_id,
    actorId: user.id,
    action: 'VIEW',
    outcome: 'ALLOWED',
    entityType: 'DOCUMENT',
    entityId: documentId,
    details: {
      title: doc.title,
      classification: doc.classification,
    },
    ip,
  }).catch(() => {});

  return {
    document: {
      id: doc.id,
      title: doc.title,
      description: doc.description,
      classification: Number(doc.classification),
      createdAt: doc.created_at,
      createdBy: {
        id: doc.created_by,
        fullName: doc.creator_name,
        email: doc.creator_email,
      },
      workspace: {
        id: doc.workspace_id,
        name: doc.workspace_name,
        status: doc.workspace_status,
      },
      department: {
        id: doc.department_id,
        name: doc.department_name,
      },
      type: {
        id: doc.type_id,
        name: doc.type_name,
      },
    },
    versions,
    signatures,
  };
}

/**
 * Searches documents accessible to the caller with full-text search and clearance filtering (request 16, AP-09).
 *
 * @param {object} params
 * @param {object} params.user Policy user
 * @param {object} params.filters
 */
export async function searchDocuments({ user, filters }) {
  return searchAccessibleDocuments(getPool(), user, filters);
}

/**
 * Creates a new document type for an organisation.
 *
 * @param {object} params
 * @param {string} params.orgId
 * @param {string} params.name
 */
export async function createDocumentType({ orgId, name }) {
  return insertDocumentType(getPool(), { orgId, name });
}

/**
 * Lists all document types for an organisation.
 *
 * @param {string} orgId
 */
export async function listDocumentTypes(orgId) {
  return findDocumentTypesByOrg(getPool(), orgId);
}

/**
 * DE-05 Q01: Documents per department per classification level.
 *
 * @param {string} orgId
 */
export async function getDeptClassificationStats(orgId) {
  return getDocumentsPerDeptClassification(getPool(), orgId);
}

/**
 * DE-05 Q05: Documents with more than N versions.
 *
 * @param {string} orgId
 * @param {number} [minVersions=3]
 */
export async function getMultiVersionDocs(orgId, minVersions = 3) {
  return getDocumentsWithMultipleVersions(getPool(), orgId, minVersions);
}

/**
 * DE-05 Q12: Rank positions by documents opened.
 *
 * @param {string} orgId
 */
export async function getRankedPositions(orgId) {
  return getPositionsRankedByDocsOpened(getPool(), orgId);
}
