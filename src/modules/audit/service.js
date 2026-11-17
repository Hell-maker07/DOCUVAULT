import { getPool } from '../../config/db.js';
import { computeAuditHash } from './auditWriter.js';
import {
  fetchAuditChain,
  queryAuditLogs,
  findAuditRowBySeq,
  getDeniedAccessByPosition,
  getMostActiveUsers,
  getIntegrityFailures,
} from './repo.js';

/**
 * Recomputes and verifies the cryptographic audit hash chain for an organisation.
 * Inspects all rows starting from seq 1 to the head of the chain.
 *
 * Verifies three critical cryptographic properties on each link:
 * 1. Strict sequence continuity: seq increases by exactly 1 without gaps or duplicates.
 * 2. Hash pointer link: prev_hash matches the hash of the preceding entry (genesis uses 64 zeros).
 * 3. Canonical payload integrity: recomputed SHA-256(prev_hash + canonicalJson(...)) matches stored hash.
 *
 * If any corruption or tampering is detected, immediately pinpoints the exact sequence number and failure reason.
 *
 * @param {string} orgId Organisation UUID
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 * @returns {Promise<{
 *   verified: boolean,
 *   count: number,
 *   lastSeq: number,
 *   headHash?: string,
 *   brokenSeq?: number,
 *   reason?: 'SEQUENCE_GAP' | 'BROKEN_LINK' | 'HASH_MISMATCH',
 *   message: string,
 *   expectedHash?: string,
 *   actualHash?: string,
 *   expectedPrevHash?: string,
 *   actualPrevHash?: string,
 *   expectedSeq?: number,
 *   actualSeq?: number,
 *   rowId?: number|string
 * }>}
 */
export async function verifyAuditChain(orgId, client = getPool()) {
  const rows = await fetchAuditChain(orgId, client);

  if (rows.length === 0) {
    return {
      verified: true,
      count: 0,
      lastSeq: 0,
      message: 'No audit records found for this organisation',
    };
  }

  let expectedPrevHash = '0'.repeat(64);
  let expectedSeq = 1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const seq = Number(row.seq);
    const prevHash = (row.prev_hash || '').trim();
    const actualHash = (row.hash || '').trim();

    // 1. Verify sequence order and continuity (no gaps or out-of-order blocks)
    if (seq !== expectedSeq) {
      return {
        verified: false,
        brokenSeq: seq,
        reason: 'SEQUENCE_GAP',
        message: `Audit chain sequence discontinuity at index ${i}: expected seq ${expectedSeq}, found ${seq}`,
        expectedSeq,
        actualSeq: seq,
        count: i,
        lastSeq: i > 0 ? Number(rows[i - 1].seq) : 0,
        rowId: row.id,
      };
    }

    // 2. Verify hash pointer link to previous row
    if (prevHash !== expectedPrevHash) {
      return {
        verified: false,
        brokenSeq: seq,
        reason: 'BROKEN_LINK',
        message: `Previous hash pointer mismatch at seq ${seq}: chain link has been severed or rewritten`,
        expectedPrevHash,
        actualPrevHash: prevHash,
        count: i,
        lastSeq: i > 0 ? Number(rows[i - 1].seq) : 0,
        rowId: row.id,
      };
    }

    // 3. Recompute hash from canonical row representation
    const expectedHash = computeAuditHash({
      prevHash,
      seq,
      orgId: row.org_id,
      actorId: row.actor_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      outcome: row.outcome,
      details: row.details,
      createdAt: row.created_at,
    });

    if (actualHash !== expectedHash) {
      return {
        verified: false,
        brokenSeq: seq,
        reason: 'HASH_MISMATCH',
        message: `Data tampering detected at seq ${seq}: row content does not match stored cryptographic hash`,
        expectedHash,
        actualHash,
        count: i,
        lastSeq: i > 0 ? Number(rows[i - 1].seq) : 0,
        rowId: row.id,
      };
    }

    // Advance pointer
    expectedPrevHash = actualHash;
    expectedSeq = seq + 1;
  }

  return {
    verified: true,
    count: rows.length,
    lastSeq: Number(rows[rows.length - 1].seq),
    headHash: (rows[rows.length - 1].hash || '').trim(),
    message: `All ${rows.length} audit entries verified successfully`,
  };
}

/**
 * Returns filtered and paginated audit entries for an organisation.
 *
 * @param {object} filters
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 */
export async function listAuditLogs(filters, client = getPool()) {
  return queryAuditLogs(filters, client);
}

/**
 * Returns a specific audit log entry by organisation and sequence number.
 *
 * @param {string} orgId
 * @param {number} seq
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 */
export async function getAuditRowBySeq(orgId, seq, client = getPool()) {
  return findAuditRowBySeq(orgId, seq, client);
}

/**
 * DE-05 Q07: Retrieves denied access attempts grouped by position.
 *
 * @param {string} orgId
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 */
export async function getDeniedStats(orgId, client = getPool()) {
  return getDeniedAccessByPosition(orgId, client);
}

/**
 * DE-05 Q08: Retrieves the most active users over a rolling window.
 *
 * @param {string} orgId
 * @param {number} [days=30]
 * @param {number} [limit=10]
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 */
export async function getActiveUsersStats(orgId, days = 30, limit = 10, client = getPool()) {
  return getMostActiveUsers(orgId, days, limit, client);
}

/**
 * DE-05 Q11: Retrieves logged integrity failures.
 *
 * @param {string} orgId
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 */
export async function getIntegrityFailuresList(orgId, client = getPool()) {
  return getIntegrityFailures(orgId, client);
}
