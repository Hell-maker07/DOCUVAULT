import crypto from 'node:crypto';
import path from 'node:path';

/**
 * Computes SHA-256 hex digest of a Buffer or string.
 * @param {Buffer|string} buf
 * @returns {string} 64 lower-case hex characters
 */
export const sha256 = (buf) => {
  const input = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return crypto.createHash('sha256').update(input).digest('hex');
};

/**
 * Computes SHA-256 hex digest of a readable stream.
 * @param {import('node:stream').Readable} stream
 * @returns {Promise<string>} 64 lower-case hex characters
 */
export const sha256Stream = (stream) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });

/**
 * Constant-time comparison between two SHA-256 hex strings.
 * Prevents timing attacks when comparing cryptographic fingerprints.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export const timingSafeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length !== 64) return false;
  const bufA = Buffer.from(a.toLowerCase(), 'utf8');
  const bufB = Buffer.from(b.toLowerCase(), 'utf8');
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Evaluates whether file bytes match an expected SHA-256 fingerprint.
 * Returns the status 'VERIFIED' or 'TAMPERED' as required by the DocuVault specification.
 *
 * @param {Buffer|string} fileBytes
 * @param {string} expectedSha256
 * @returns {{ verified: boolean, actualHash: string, expectedHash: string, status: 'VERIFIED' | 'TAMPERED' }}
 */
export const verifyIntegrity = (fileBytes, expectedSha256) => {
  const actualHash = sha256(fileBytes);
  const verified = timingSafeCompare(actualHash, expectedSha256);
  return {
    verified,
    actualHash,
    expectedHash: expectedSha256,
    status: verified ? 'VERIFIED' : 'TAMPERED',
  };
};

/**
 * Generates an isolated, safe storage path for a document version.
 * Format: orgs/{orgId}/docs/{docId}/v{versionNo}_{cleanName}
 * Prevents directory traversal attacks by stripping relative navigation characters.
 *
 * @param {object} params
 * @param {string} params.orgId
 * @param {string} params.docId
 * @param {number} params.versionNo
 * @param {string} params.fileName
 * @returns {string} Sanitized storage path
 */
export const buildStoragePath = ({ orgId, docId, versionNo, fileName }) => {
  if (!orgId || !docId || !versionNo || !fileName) {
    throw new Error('orgId, docId, versionNo, and fileName are all required to build storage path');
  }
  // Strip directory paths and sanitize special characters
  const cleanBase = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `orgs/${orgId}/docs/${docId}/v${versionNo}_${cleanBase}`;
};

/**
 * Deterministic JSON serialization with recursively sorted object keys.
 * Used for hash-chaining in the audit log so key order differences never break the chain.
 * @param {unknown} val
 * @returns {string} Canonical JSON string
 */
export function canonicalJson(val) {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map((v) => canonicalJson(v)).join(',') + ']';
  }
  const keys = Object.keys(val).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(val[k])).join(',') + '}';
}
