import { withTransaction, getPool } from '../../config/db.js';
import { storage } from '../../storage/index.js';
import { verifyIntegrity } from '../../utils/hash.js';
import { signHash, verifyHash, unwrap } from '../../utils/keys.js';
import { appendAudit, writeAudit } from '../audit/auditWriter.js';
import AppError from '../../utils/AppError.js';
import {
  findVersionForSigning,
  findSignerKeys,
  findSignature,
  insertSignature,
  findSignaturesByVersion,
  findSignatureById,
  findUnsignedLatestVersions,
} from './repo.js';

/**
 * Digitally signs a specific document version using the caller's Ed25519 private key.
 *
 * Implements AP-10 & BR-12:
 * 1. Checks that the version exists.
 * 2. Enforces one signature per user per version (returns 409 CONFLICT if already signed).
 * 3. Re-verifies stored file integrity against version.sha256 prior to signing (BR-09).
 *    A hash mismatch blocks the operation with 409 INTEGRITY_FAILURE and logs an audit failure.
 * 4. Decrypts the user's AES-256-GCM encrypted private key.
 * 5. Generates the Ed25519 digital signature over the version's SHA-256 hex string.
 * 6. Atomically inserts the signature record and appends a 'SIGN' audit entry.
 *
 * @param {object} params
 * @param {string} params.documentId
 * @param {number} params.versionNo
 * @param {string} params.signerId
 * @param {string|null} [params.ip]
 * @returns {Promise<{ signatureId: string, signedAt: string, versionId: string, versionNo: number, signerId: string, signature: string }>}
 */
export async function signDocumentVersion({ documentId, versionNo, signerId, ip = null }) {
  // 1. Fetch document version record
  const version = await findVersionForSigning(getPool(), documentId, versionNo);
  if (!version) {
    throw new AppError(
      `Version ${versionNo} not found for document ${documentId}`,
      404,
      'NOT_FOUND',
    );
  }

  // 2. Check for duplicate signature by this user (BR-12)
  const existing = await findSignature(getPool(), version.id, signerId);
  if (existing) {
    throw new AppError('Document version has already been signed by this user', 409, 'CONFLICT');
  }

  // 3. Re-verify physical file integrity before signing (BR-09)
  let fileBytes;
  try {
    const fileResult = await storage.get(version.storage_path);
    fileBytes = fileResult.buffer;
  } catch (err) {
    await writeAudit({
      orgId: version.org_id,
      actorId: signerId,
      action: 'VERIFY',
      outcome: 'FAILED',
      entityType: 'document_version',
      entityId: version.id,
      details: {
        documentId,
        versionNo,
        status: 'MISSING',
        storagePath: version.storage_path,
        error: err.message,
      },
      ip,
    }).catch(() => {});

    throw new AppError(
      'Document file not found in storage: integrity verification failed',
      409,
      'INTEGRITY_FAILURE',
    );
  }

  const integrity = verifyIntegrity(fileBytes, version.sha256.trim());
  if (!integrity.verified) {
    await writeAudit({
      orgId: version.org_id,
      actorId: signerId,
      action: 'VERIFY',
      outcome: 'FAILED',
      entityType: 'document_version',
      entityId: version.id,
      details: {
        documentId,
        versionNo,
        expected: version.sha256.trim(),
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

  // 4. Fetch signer keys and decrypt private key
  const user = await findSignerKeys(getPool(), signerId);
  if (!user || !user.is_active) {
    throw new AppError('Signer account is inactive or not found', 401, 'UNAUTHENTICATED');
  }

  const privatePem = unwrap(user.private_key_enc);

  // 5. Compute Ed25519 signature over SHA-256 fingerprint
  const signatureB64 = signHash(privatePem, version.sha256.trim());

  // 6. Atomically insert signature row and append SIGN audit entry
  return withTransaction(async (tx) => {
    const sigRow = await insertSignature(tx, {
      versionId: version.id,
      signerId,
      signature: signatureB64,
    });

    await appendAudit(tx, {
      orgId: version.org_id,
      actorId: signerId,
      action: 'SIGN',
      outcome: 'ALLOWED',
      entityType: 'document_version',
      entityId: version.id,
      details: {
        documentId,
        versionNo,
        signatureId: sigRow.id,
        sha256: version.sha256.trim(),
      },
      ip,
    });

    return {
      signatureId: sigRow.id,
      signedAt: sigRow.signed_at,
      versionId: version.id,
      versionNo: version.version_no,
      signerId,
      signature: signatureB64,
    };
  });
}

/**
 * Retrieves and dynamically verifies all digital signatures for a given version.
 *
 * @param {object} params
 * @param {string} params.documentId
 * @param {number} params.versionNo
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 */
export async function getSignaturesForVersion({ documentId, versionNo }, client = getPool()) {
  const version = await findVersionForSigning(client, documentId, versionNo);
  if (!version) {
    throw new AppError(
      `Version ${versionNo} not found for document ${documentId}`,
      404,
      'NOT_FOUND',
    );
  }

  const rows = await findSignaturesByVersion(client, documentId, versionNo);

  const verifiedSignatures = rows.map((row) => {
    const isCryptographicallyValid = verifyHash(row.public_key, row.sha256.trim(), row.signature);
    return {
      id: row.id,
      versionId: row.version_id,
      versionNo: row.version_no,
      signedAt: row.signed_at,
      signature: row.signature,
      verified: isCryptographicallyValid,
      signer: {
        id: row.signer_id,
        fullName: row.full_name,
        email: row.email,
        publicKey: row.public_key,
      },
    };
  });

  return {
    documentId,
    versionNo,
    sha256: version.sha256.trim(),
    count: verifiedSignatures.length,
    allVerified: verifiedSignatures.every((s) => s.verified),
    signatures: verifiedSignatures,
  };
}

/**
 * Re-verifies a single signature by primary key.
 *
 * @param {string} signatureId
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 */
export async function verifySignatureById(signatureId, client = getPool()) {
  const row = await findSignatureById(client, signatureId);
  if (!row) {
    throw new AppError('Signature not found', 404, 'NOT_FOUND');
  }

  const isValid = verifyHash(row.public_key, row.sha256.trim(), row.signature);

  return {
    signatureId: row.id,
    versionId: row.version_id,
    versionNo: row.version_no,
    documentId: row.document_id,
    signedAt: row.signed_at,
    sha256: row.sha256.trim(),
    signature: row.signature,
    verified: isValid,
    signer: {
      id: row.signer_id,
      fullName: row.full_name,
      email: row.email,
      publicKey: row.public_key,
    },
  };
}

/**
 * DE-05 Q06: Retrieves latest versions that nobody has signed yet.
 *
 * @param {string} orgId
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 */
export async function getUnsignedLatest(orgId, client = getPool()) {
  return findUnsignedLatestVersions(client, orgId);
}
