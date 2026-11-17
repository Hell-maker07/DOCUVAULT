import { getPool } from '../config/db.js';

/**
 * Loads user identity, clearance level, department scope, and effective permissions.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} userId
 * @returns {Promise<{
 *   id: string,
 *   email: string,
 *   fullName: string,
 *   isActive: boolean,
 *   orgId: string,
 *   departmentId: string,
 *   positionId: string,
 *   clearance: number,
 *   deptScope: 'ORG'|'OWN_DEPT'|'ASSIGNED',
 *   permissions: string[]
 * }|null>}
 */
export async function loadUser(db = getPool(), userId) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.full_name, u.is_active,
            d.org_id, u.department_id, u.position_id,
            p.clearance_level AS clearance, p.dept_scope,
            COALESCE(array_agg(perm.code) FILTER (WHERE perm.code IS NOT NULL), '{}') AS permissions
     FROM users u
     JOIN departments d ON d.id = u.department_id
     JOIN positions p ON p.id = u.position_id
     LEFT JOIN position_permissions pp ON pp.position_id = p.id
     LEFT JOIN permissions perm ON perm.id = pp.permission_id
     WHERE u.id = $1
     GROUP BY u.id, u.email, u.full_name, u.is_active, d.org_id, u.department_id, u.position_id, p.clearance_level, p.dept_scope`,
    [userId],
  );

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    isActive: r.is_active,
    orgId: r.org_id,
    departmentId: r.department_id,
    positionId: r.position_id,
    clearance: Number(r.clearance),
    deptScope: r.dept_scope,
    permissions: r.permissions || [],
  };
}

/**
 * Loads document context including container workspace, owning organisation,
 * caller workspace membership, and active access grants.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} docId
 * @param {string} userId
 * @returns {Promise<{
 *   id: string,
 *   title: string,
 *   classification: number,
 *   typeId: string,
 *   workspaceId: string,
 *   workspaceName: string,
 *   workspaceStatus: 'OPEN'|'CLOSED'|'ARCHIVED',
 *   departmentId: string,
 *   orgId: string,
 *   isMember: boolean,
 *   hasActiveGrant: boolean
 * }|null>}
 */
export async function loadDocument(db = getPool(), docId, userId) {
  const { rows } = await db.query(
    `SELECT d.id, d.title, d.classification, d.type_id,
            w.id AS workspace_id, w.name AS workspace_name, w.status AS workspace_status,
            w.department_id, dp.org_id,
            EXISTS (
              SELECT 1 FROM workspace_members wm
              WHERE wm.workspace_id = w.id AND wm.user_id = $2
            ) AS is_member,
            EXISTS (
              SELECT 1 FROM access_grants ag
              WHERE ag.document_id = d.id AND ag.user_id = $2 AND ag.expires_at > now()
            ) AS has_active_grant
     FROM documents d
     JOIN workspaces w ON w.id = d.workspace_id
     JOIN departments dp ON dp.id = w.department_id
     WHERE d.id = $1`,
    [docId, userId],
  );

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    id: r.id,
    title: r.title,
    classification: Number(r.classification),
    typeId: r.type_id,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    workspaceStatus: r.workspace_status,
    departmentId: r.department_id,
    orgId: r.org_id,
    isMember: Boolean(r.is_member),
    hasActiveGrant: Boolean(r.has_active_grant),
  };
}

/**
 * Loads workspace context including owning department, organisation, and membership.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} workspaceId
 * @param {string} userId
 */
export async function loadWorkspace(db = getPool(), workspaceId, userId) {
  const { rows } = await db.query(
    `SELECT w.id, w.name, w.status, w.department_id, w.created_by,
            dp.org_id,
            EXISTS (
              SELECT 1 FROM workspace_members wm
              WHERE wm.workspace_id = w.id AND wm.user_id = $2
            ) AS is_member
     FROM workspaces w
     JOIN departments dp ON dp.id = w.department_id
     WHERE w.id = $1`,
    [workspaceId, userId],
  );

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    departmentId: r.department_id,
    createdBy: r.created_by,
    orgId: r.org_id,
    isMember: Boolean(r.is_member),
  };
}
