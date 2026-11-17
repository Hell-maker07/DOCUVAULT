import { getPool } from '../../config/db.js';

/**
 * Normalizes a raw database audit row into a clean, typed API response object.
 *
 * @param {object} row
 * @returns {object} Formatted audit entry
 */
export function formatAuditRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    actorId: row.actor_id ?? null,
    actorEmail: row.actor_email ?? null,
    actorName: row.actor_name ?? null,
    seq: Number(row.seq),
    action: row.action,
    entityType: row.entity_type ?? null,
    entityId: row.entity_id ?? null,
    outcome: row.outcome,
    details: row.details ?? null,
    ip: row.ip ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    prevHash: (row.prev_hash || '').trim(),
    hash: (row.hash || '').trim(),
  };
}

/**
 * Fetches the complete sequence of audit log entries for an organisation in ascending order.
 * Used by the audit verification service to recompute the entire hash chain from seq 1 to head.
 *
 * @param {string} orgId Organization UUID
 * @param {import('pg').PoolClient|import('pg').Pool} [client] Database client
 * @returns {Promise<Array<object>>} Ordered audit rows
 */
export async function fetchAuditChain(orgId, client = getPool()) {
  const { rows } = await client.query(
    `SELECT id, org_id, actor_id, seq, action, entity_type, entity_id,
            outcome, details, ip, created_at, prev_hash, hash
     FROM audit_logs
     WHERE org_id = $1
     ORDER BY seq ASC`,
    [orgId],
  );
  return rows;
}

/**
 * Queries audit log entries with dynamic parameterised filters and pagination.
 *
 * @param {object} filters
 * @param {string} filters.orgId
 * @param {string} [filters.action]
 * @param {string} [filters.actorId]
 * @param {string} [filters.entityType]
 * @param {string} [filters.entityId]
 * @param {string} [filters.outcome]
 * @param {string} [filters.from]
 * @param {string} [filters.to]
 * @param {number} [filters.page=1]
 * @param {number} [filters.pageSize=20]
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 * @returns {Promise<{ items: Array<object>, page: number, pageSize: number, total: number, totalPages: number }>}
 */
export async function queryAuditLogs(filters, client = getPool()) {
  const {
    orgId,
    action,
    actorId,
    entityType,
    entityId,
    outcome,
    from,
    to,
    page = 1,
    pageSize = 20,
  } = filters;

  const conditions = ['a.org_id = $1'];
  const params = [orgId];
  let paramIdx = 2;

  if (action) {
    conditions.push(`a.action = $${paramIdx++}`);
    params.push(action);
  }
  if (actorId) {
    conditions.push(`a.actor_id = $${paramIdx++}`);
    params.push(actorId);
  }
  if (entityType) {
    conditions.push(`a.entity_type = $${paramIdx++}`);
    params.push(entityType);
  }
  if (entityId) {
    conditions.push(`a.entity_id = $${paramIdx++}`);
    params.push(entityId);
  }
  if (outcome) {
    conditions.push(`a.outcome = $${paramIdx++}`);
    params.push(outcome);
  }
  if (from) {
    conditions.push(`a.created_at >= $${paramIdx++}`);
    params.push(new Date(from).toISOString());
  }
  if (to) {
    conditions.push(`a.created_at <= $${paramIdx++}`);
    params.push(new Date(to).toISOString());
  }

  const whereClause = conditions.join(' AND ');

  // 1. Get total count
  const countSql = `SELECT count(*)::int AS total FROM audit_logs a WHERE ${whereClause}`;
  const countRes = await client.query(countSql, params);
  const total = countRes.rows[0].total;

  // 2. Fetch paginated data
  const offset = (page - 1) * pageSize;
  const dataSql = `
    SELECT a.id, a.org_id, a.actor_id, a.seq, a.action, a.entity_type, a.entity_id,
           a.outcome, a.details, a.ip, a.created_at, a.prev_hash, a.hash,
           u.email AS actor_email, u.full_name AS actor_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE ${whereClause}
    ORDER BY a.seq DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;
  const dataParams = [...params, pageSize, offset];
  const { rows } = await client.query(dataSql, dataParams);

  return {
    items: rows.map(formatAuditRow),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
}

/**
 * Fetches an individual audit entry by organization UUID and sequence number.
 *
 * @param {string} orgId
 * @param {number} seq
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 * @returns {Promise<object|null>} Formatted audit row or null
 */
export async function findAuditRowBySeq(orgId, seq, client = getPool()) {
  const { rows } = await client.query(
    `SELECT a.id, a.org_id, a.actor_id, a.seq, a.action, a.entity_type, a.entity_id,
            a.outcome, a.details, a.ip, a.created_at, a.prev_hash, a.hash,
            u.email AS actor_email, u.full_name AS actor_name
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.org_id = $1 AND a.seq = $2`,
    [orgId, seq],
  );
  if (rows.length === 0) return null;
  return formatAuditRow(rows[0]);
}

/**
 * DE-05 Q07: Denied access attempts grouped by position.
 * Aggregates all ACCESS_DENIED audit events for the given organisation.
 *
 * @param {string} orgId
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 * @returns {Promise<Array<{ positionId: string, positionTitle: string, deniedCount: number }>>}
 */
export async function getDeniedAccessByPosition(orgId, client = getPool()) {
  const { rows } = await client.query(
    `SELECT p.id AS position_id, p.title AS position_title, count(*)::int AS denied_count
     FROM audit_logs a
     JOIN users u ON u.id = a.actor_id
     JOIN positions p ON p.id = u.position_id
     WHERE a.org_id = $1 AND a.action = 'ACCESS_DENIED'
     GROUP BY p.id, p.title
     ORDER BY denied_count DESC`,
    [orgId],
  );
  return rows.map((r) => ({
    positionId: r.position_id,
    positionTitle: r.position_title,
    deniedCount: r.denied_count,
  }));
}

/**
 * DE-05 Q08: Most active users over a recent time window (default: 30 days).
 *
 * @param {string} orgId
 * @param {number} [days=30]
 * @param {number} [limit=10]
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 * @returns {Promise<Array<{ userId: string, email: string, fullName: string, actionCount: number }>>}
 */
export async function getMostActiveUsers(orgId, days = 30, limit = 10, client = getPool()) {
  const { rows } = await client.query(
    `SELECT u.id AS user_id, u.email, u.full_name, count(*)::int AS action_count
     FROM audit_logs a
     JOIN users u ON u.id = a.actor_id
     WHERE a.org_id = $1 AND a.created_at >= now() - make_interval(days => $2)
     GROUP BY u.id, u.email, u.full_name
     ORDER BY action_count DESC
     LIMIT $3`,
    [orgId, days, limit],
  );
  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    fullName: r.full_name,
    actionCount: r.action_count,
  }));
}

/**
 * DE-05 Q11: Integrity failures logged in the audit trail.
 *
 * @param {string} orgId
 * @param {import('pg').PoolClient|import('pg').Pool} [client]
 * @returns {Promise<Array<object>>}
 */
export async function getIntegrityFailures(orgId, client = getPool()) {
  const { rows } = await client.query(
    `SELECT a.id, a.seq, a.action, a.outcome, a.entity_type, a.entity_id, a.details, a.created_at
     FROM audit_logs a
     WHERE a.org_id = $1 AND (a.outcome = 'FAILED' OR (a.action = 'VERIFY' AND a.outcome = 'DENIED'))
     ORDER BY a.seq DESC`,
    [orgId],
  );
  return rows.map(formatAuditRow);
}
