import { sha256, canonicalJson } from '../../utils/hash.js';
import { withTransaction } from '../../config/db.js';

/**
 * Appends a tamper-evident, hash-chained audit entry inside an existing database transaction.
 * Locks the organisation row (SELECT ... FOR UPDATE) to ensure concurrent writers serialize
 * and form a strictly continuous sequence with no gaps or branching.
 *
 * @param {import('pg').PoolClient} tx Active transaction client
 * @param {object} e Audit event
 * @param {string} e.orgId
 * @param {string|null} [e.actorId]
 * @param {string} e.action LOGIN | LOGIN_FAILED | UPLOAD | NEW_VERSION | VIEW | DOWNLOAD | VERIFY | SIGN | GRANT | ACCESS_DENIED | ADMIN_CHANGE
 * @param {string|null} [e.entityType]
 * @param {string|null} [e.entityId]
 * @param {string} e.outcome ALLOWED | DENIED | FAILED
 * @param {object|null} [e.details]
 * @param {string|null} [e.ip]
 * @param {Date|string} [e.createdAt]
 * @returns {Promise<{ seq: number, prevHash: string, hash: string, createdAt: string }>}
 */
export async function appendAudit(tx, e) {
  // 1. Lock the organisation row so concurrent writes for this org serialize
  await tx.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [e.orgId]);

  // 2. Fetch the previous audit row for this organisation
  const { rows } = await tx.query(
    'SELECT seq, hash FROM audit_logs WHERE org_id = $1 ORDER BY seq DESC LIMIT 1',
    [e.orgId],
  );

  const seq = rows.length > 0 ? rows[0].seq + 1 : 1;
  const prevHash = rows.length > 0 ? rows[0].hash : '0'.repeat(64);
  const createdAt = (e.createdAt instanceof Date ? e.createdAt : new Date()).toISOString();

  // 3. Hash prevHash + canonical JSON representation of row fields
  const hash = sha256(
    prevHash +
      canonicalJson([
        seq,
        e.orgId,
        e.actorId ?? null,
        e.action,
        e.entityType ?? null,
        e.entityId ?? null,
        e.outcome,
        e.details ?? null,
        createdAt,
      ]),
  );

  // 4. Insert the new audit entry
  await tx.query(
    `INSERT INTO audit_logs (
       org_id, actor_id, seq, action, entity_type, entity_id,
       outcome, details, ip, created_at, prev_hash, hash
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      e.orgId,
      e.actorId ?? null,
      seq,
      e.action,
      e.entityType ?? null,
      e.entityId ?? null,
      e.outcome,
      e.details ? JSON.stringify(e.details) : null,
      e.ip ?? null,
      createdAt,
      prevHash,
      hash,
    ],
  );

  return { seq, prevHash, hash, createdAt };
}

/**
 * Convenience helper to append an audit entry in a standalone transaction.
 * @param {object} e Audit event
 */
export async function writeAudit(e) {
  return withTransaction((tx) => appendAudit(tx, e));
}
