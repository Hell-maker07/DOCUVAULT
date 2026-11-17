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

/**
 * Evaluates whether a user may perform an action on a document.
 * Follows the DocuVault 'deny by default' access policy engine specification (AP-03):
 *
 * 1. User must exist and be active.
 * 2. Document must be in the same organisation as the caller. (Missing/foreign org returns 404).
 * 3. User's clearance level must be >= document classification. (Insufficient clearance returns 404 + audited).
 * 4. Caller must be in scope:
 *    - deptScope === 'ORG'
 *    - deptScope === 'OWN_DEPT' and document department === user department
 *    - User is an assigned workspace member
 *    - User holds an active, unexpired access grant (VIEW permission only)
 *    (Out-of-scope returns 404 + audited).
 * 5. Position must hold the required permission (VIEW, EDIT, SIGN, SHARE, etc.).
 *    (Missing permission returns 403 FORBIDDEN + audited).
 * 6. For write actions (EDIT): workspace must not be CLOSED or ARCHIVED.
 *    (Closed workspace returns 409 WORKSPACE_CLOSED + audited).
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} userId
 * @param {string} docId
 * @param {'VIEW'|'UPLOAD'|'EDIT'|'SIGN'|'SHARE'|'AUDIT'|'MANAGE_ORG'} permission
 * @returns {Promise<{
 *   ok: boolean,
 *   status?: number,
 *   code?: string,
 *   message?: string,
 *   audit?: boolean,
 *   orgId?: string,
 *   actorId?: string,
 *   entityType?: string,
 *   entityId?: string,
 *   details?: object,
 *   user?: object,
 *   document?: object
 * }>}
 */
export async function decide(db = getPool(), userId, docId, permission) {
  const u = await loadUser(db, userId);
  if (!u || !u.isActive) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'User not found or inactive',
      audit: false,
    };
  }

  const d = await loadDocument(db, docId, userId);
  // Hide document existence from different organisations or if missing entirely
  if (!d || d.orgId !== u.orgId) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'Document not found',
      audit: false,
    };
  }

  // BR-04: Clearance must be at least classification. A grant NEVER overrides clearance.
  if (u.clearance < d.classification) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'Document not found',
      audit: true,
      orgId: u.orgId,
      actorId: u.id,
      entityType: 'DOCUMENT',
      entityId: docId,
      details: {
        reason: 'INSUFFICIENT_CLEARANCE',
        userClearance: u.clearance,
        docClassification: d.classification,
        action: permission,
      },
    };
  }

  // BR-05: Department scope check (ORG, OWN_DEPT, workspace member, or unexpired grant for VIEW)
  const inScope =
    u.deptScope === 'ORG' ||
    (u.deptScope === 'OWN_DEPT' && d.departmentId === u.departmentId) ||
    d.isMember ||
    (permission === 'VIEW' && d.hasActiveGrant);

  if (!inScope) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'Document not found',
      audit: true,
      orgId: u.orgId,
      actorId: u.id,
      entityType: 'DOCUMENT',
      entityId: docId,
      details: {
        reason: 'OUT_OF_SCOPE',
        deptScope: u.deptScope,
        departmentId: d.departmentId,
        action: permission,
      },
    };
  }

  // Permission check: caller's position must hold the required permission
  if (!u.permissions.includes(permission)) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Forbidden: Insufficient position permission',
      audit: true,
      orgId: u.orgId,
      actorId: u.id,
      entityType: 'DOCUMENT',
      entityId: docId,
      details: {
        reason: 'MISSING_PERMISSION',
        requiredPermission: permission,
        userPermissions: u.permissions,
      },
    };
  }

  // BR-14: Workspace lifecycle status checks
  if (permission === 'EDIT') {
    if (d.workspaceStatus === 'CLOSED' || d.workspaceStatus === 'ARCHIVED') {
      return {
        ok: false,
        status: 409,
        code: 'WORKSPACE_CLOSED',
        message: `Workspace is ${d.workspaceStatus.toLowerCase()}`,
        audit: true,
        orgId: u.orgId,
        actorId: u.id,
        entityType: 'DOCUMENT',
        entityId: docId,
        details: {
          reason: 'WORKSPACE_CLOSED',
          workspaceStatus: d.workspaceStatus,
          action: permission,
        },
      };
    }
  }

  return { ok: true, user: u, document: d };
}

/**
 * Evaluates whether a user may perform an action on a workspace directly (e.g. UPLOAD a document).
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} userId
 * @param {string} workspaceId
 * @param {'UPLOAD'|'VIEW'|'EDIT'|'MANAGE_ORG'} permission
 * @param {object} [options]
 * @param {number} [options.classification] Intended classification of uploaded document
 */
export async function decideWorkspace(
  db = getPool(),
  userId,
  workspaceId,
  permission,
  options = {},
) {
  const u = await loadUser(db, userId);
  if (!u || !u.isActive) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'User not found or inactive',
      audit: false,
    };
  }

  const w = await loadWorkspace(db, workspaceId, userId);
  if (!w || w.orgId !== u.orgId) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'Workspace not found',
      audit: false,
    };
  }

  // Scope check for workspace access
  const inScope =
    u.deptScope === 'ORG' ||
    (u.deptScope === 'OWN_DEPT' && w.departmentId === u.departmentId) ||
    w.isMember;

  if (!inScope) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'Workspace not found',
      audit: true,
      orgId: u.orgId,
      actorId: u.id,
      entityType: 'WORKSPACE',
      entityId: workspaceId,
      details: {
        reason: 'OUT_OF_SCOPE',
        deptScope: u.deptScope,
        departmentId: w.departmentId,
        action: permission,
      },
    };
  }

  // Permission check
  if (!u.permissions.includes(permission)) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Forbidden: Insufficient position permission',
      audit: true,
      orgId: u.orgId,
      actorId: u.id,
      entityType: 'WORKSPACE',
      entityId: workspaceId,
      details: {
        reason: 'MISSING_PERMISSION',
        requiredPermission: permission,
      },
    };
  }

  // BR-14: Uploads only into OPEN workspaces
  if (permission === 'UPLOAD') {
    if (w.status !== 'OPEN') {
      return {
        ok: false,
        status: 409,
        code: 'WORKSPACE_CLOSED',
        message: `Workspace is ${w.status.toLowerCase()}`,
        audit: true,
        orgId: u.orgId,
        actorId: u.id,
        entityType: 'WORKSPACE',
        entityId: workspaceId,
        details: {
          reason: 'WORKSPACE_CLOSED',
          workspaceStatus: w.status,
          action: permission,
        },
      };
    }

    // BR-04: An uploader cannot classify above their own clearance
    if (options.classification && options.classification > u.clearance) {
      return {
        ok: false,
        status: 403,
        code: 'FORBIDDEN',
        message: 'Cannot classify document above your own clearance level',
        audit: true,
        orgId: u.orgId,
        actorId: u.id,
        entityType: 'WORKSPACE',
        entityId: workspaceId,
        details: {
          reason: 'CLASSIFICATION_EXCEEDS_CLEARANCE',
          userClearance: u.clearance,
          requestedClassification: options.classification,
        },
      };
    }
  }

  return { ok: true, user: u, workspace: w };
}

/**
 * Builds the parameterised SQL predicate representing the access policy for search and list queries (AP-09).
 *
 * @param {object} user
 * @param {string} user.orgId
 * @param {number} user.clearance
 * @param {string} user.deptScope
 * @param {string} user.departmentId
 * @param {string} user.id
 * @param {number} startIdx Index of first SQL bound parameter
 * @param {string} [docAlias='d'] Table alias for documents
 * @param {string} [wsAlias='w'] Table alias for workspaces
 * @param {string} [deptAlias='dp'] Table alias for departments
 * @returns {{ sql: string, params: unknown[] }}
 */
export function buildAccessFilter(
  user,
  startIdx = 1,
  docAlias = 'd',
  wsAlias = 'w',
  deptAlias = 'dp',
) {
  const p1 = `$${startIdx}`;
  const p2 = `$${startIdx + 1}`;
  const p3 = `$${startIdx + 2}`;
  const p4 = `$${startIdx + 3}`;
  const p5 = `$${startIdx + 4}`;

  const sql = `
    ${deptAlias}.org_id = ${p1}
    AND ${docAlias}.classification <= ${p2}
    AND (
      ${p3} = 'ORG'
      OR (${p3} = 'OWN_DEPT' AND ${wsAlias}.department_id = ${p4})
      OR EXISTS (
        SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = ${wsAlias}.id AND wm.user_id = ${p5}
      )
      OR EXISTS (
        SELECT 1 FROM access_grants ag
        WHERE ag.document_id = ${docAlias}.id AND ag.user_id = ${p5} AND ag.expires_at > now()
      )
    )
  `.trim();

  const params = [user.orgId, user.clearance, user.deptScope, user.departmentId, user.id];
  return { sql, params };
}
