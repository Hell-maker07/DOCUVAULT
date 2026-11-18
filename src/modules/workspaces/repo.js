import { getPool } from '../../config/db.js';

/**
 * Loads a workspace record with department, organisation, and member counts.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} id Workspace UUID
 */
export async function findWorkspaceById(client = getPool(), id) {
  const { rows } = await client.query(
    `SELECT w.id, w.name, w.description, w.status, w.department_id, w.created_by, w.created_at,
            dp.name AS department_name, dp.org_id,
            u.full_name AS creator_name, u.email AS creator_email,
            (SELECT count(*)::int FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count,
            (SELECT count(*)::int FROM documents d WHERE d.workspace_id = w.id) AS document_count
     FROM workspaces w
     JOIN departments dp ON dp.id = w.department_id
     JOIN users u ON u.id = w.created_by
     WHERE w.id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Lists workspaces reachable by the authenticated user based on their clearance and department scope.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {object} user
 * @param {string} user.id
 * @param {string} user.orgId
 * @param {string} user.departmentId
 * @param {string} user.deptScope
 */
export async function findReachableWorkspaces(client = getPool(), user) {
  const { rows } = await client.query(
    `SELECT w.id, w.name, w.description, w.status, w.department_id, w.created_by, w.created_at,
            dp.name AS department_name,
            (SELECT count(*)::int FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count,
            (SELECT count(*)::int FROM documents d WHERE d.workspace_id = w.id) AS document_count,
            EXISTS (
              SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.user_id = $4
            ) AS is_member
     FROM workspaces w
     JOIN departments dp ON dp.id = w.department_id
     WHERE dp.org_id = $1
       AND (
         $2 = 'ORG'
         OR ($2 = 'OWN_DEPT' AND w.department_id = $3)
         OR EXISTS (
           SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.user_id = $4
         )
       )
     ORDER BY w.created_at DESC`,
    [user.orgId, user.deptScope, user.departmentId, user.id],
  );
  return rows;
}

/**
 * Inserts a new workspace.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {object} params
 */
export async function insertWorkspace(
  client = getPool(),
  { departmentId, name, description = null, createdBy },
) {
  const { rows } = await client.query(
    `INSERT INTO workspaces (department_id, name, description, status, created_by)
     VALUES ($1, $2, $3, 'OPEN', $4)
     RETURNING id, department_id, name, description, status, created_by, created_at`,
    [departmentId, name, description, createdBy],
  );
  return rows[0];
}

/**
 * Inserts a user into workspace_members.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {object} params
 */
export async function insertWorkspaceMember(client = getPool(), { workspaceId, userId }) {
  const { rows } = await client.query(
    `INSERT INTO workspace_members (workspace_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (workspace_id, user_id) DO NOTHING
     RETURNING workspace_id, user_id, added_at`,
    [workspaceId, userId],
  );
  return rows[0] || null;
}

/**
 * Updates workspace status (OPEN, CLOSED, ARCHIVED).
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} id Workspace UUID
 * @param {'OPEN'|'CLOSED'|'ARCHIVED'} status
 */
export async function updateWorkspaceStatus(client = getPool(), id, status) {
  const { rows } = await client.query(
    `UPDATE workspaces
     SET status = $2
     WHERE id = $1
     RETURNING id, department_id, name, description, status, created_by, created_at`,
    [id, status],
  );
  return rows[0] || null;
}

/**
 * Retrieves members of a given workspace.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} workspaceId
 */
export async function findWorkspaceMembers(client = getPool(), workspaceId) {
  const { rows } = await client.query(
    `SELECT wm.workspace_id, wm.user_id, wm.added_at,
            u.full_name, u.email, p.title AS position_title, p.clearance_level
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     JOIN positions p ON p.id = u.position_id
     WHERE wm.workspace_id = $1
     ORDER BY wm.added_at ASC`,
    [workspaceId],
  );
  return rows;
}

/**
 * Checks whether a user is an explicit member of a workspace.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} workspaceId
 * @param {string} userId
 */
export async function isWorkspaceMember(client = getPool(), workspaceId, userId) {
  const { rows } = await client.query(
    `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  );
  return rows.length > 0;
}

/**
 * Finds a department by ID with organization verification.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} departmentId
 */
export async function findDepartmentById(client = getPool(), departmentId) {
  const { rows } = await client.query(
    `SELECT id, org_id, code, name FROM departments WHERE id = $1`,
    [departmentId],
  );
  return rows[0] || null;
}
