import crypto from 'node:crypto';

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
