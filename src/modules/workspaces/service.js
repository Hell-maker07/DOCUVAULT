import { getPool, withTransaction } from '../../config/db.js';
import { appendAudit } from '../audit/auditWriter.js';
import { loadUser } from '../../policy/decide.js';
import AppError from '../../utils/AppError.js';
import {
  findWorkspaceById,
  findReachableWorkspaces,
  insertWorkspace,
  insertWorkspaceMember,
  updateWorkspaceStatus,
  findWorkspaceMembers,
  findDepartmentById,
} from './repo.js';

/**
 * Creates a new workspace in a department and registers the creator as its first member.
 *
 * @param {object} params
 * @param {string} params.departmentId
 * @param {string} params.name
 * @param {string} [params.description]
 * @param {object} params.user Authenticated user context
 * @param {string|null} [params.ip]
 */
export async function createWorkspace({ departmentId, name, description, user, ip = null }) {
  const dept = await findDepartmentById(getPool(), departmentId);
  if (!dept || dept.org_id !== user.orgId) {
    throw new AppError('Department not found', 404, 'NOT_FOUND');
  }

  return withTransaction(async (tx) => {
    const ws = await insertWorkspace(tx, {
      departmentId,
      name,
      description,
      createdBy: user.id,
    });

    // Creator is automatically registered as a workspace member
    await insertWorkspaceMember(tx, {
      workspaceId: ws.id,
      userId: user.id,
    });

    await appendAudit(tx, {
      orgId: user.orgId,
      actorId: user.id,
      action: 'ADMIN_CHANGE',
      outcome: 'ALLOWED',
      entityType: 'WORKSPACE',
      entityId: ws.id,
      details: {
        action: 'CREATE_WORKSPACE',
        workspaceId: ws.id,
        name: ws.name,
        departmentId,
      },
      ip,
    });

    return ws;
  });
}

/**
 * Lists workspaces reachable by the authenticated user based on their clearance and department scope.
 *
 * @param {object} user Authenticated user context
 */
export async function listReachableWorkspaces(user) {
  return findReachableWorkspaces(getPool(), user);
}

/**
 * Loads workspace details, verifying tenant boundaries and user access scope.
 *
 * @param {string} workspaceId
 * @param {object} user Authenticated user context
 */
export async function getWorkspaceDetails(workspaceId, user) {
  const ws = await findWorkspaceById(getPool(), workspaceId);
  if (!ws || ws.org_id !== user.orgId) {
    throw new AppError('Workspace not found', 404, 'NOT_FOUND');
  }

  // Scope check
  const inScope =
    user.deptScope === 'ORG' ||
    (user.deptScope === 'OWN_DEPT' && ws.department_id === user.departmentId) ||
    ws.created_by === user.id ||
    (await findWorkspaceMembers(getPool(), workspaceId)).some((m) => m.user_id === user.id);

  if (!inScope) {
    throw new AppError('Workspace not found', 404, 'NOT_FOUND');
  }

  const members = await findWorkspaceMembers(getPool(), workspaceId);
  return { workspace: ws, members };
}

/**
 * Updates workspace lifecycle status (OPEN, CLOSED, ARCHIVED) following BR-14 state machine rules.
 * Enforces: ARCHIVED is a terminal state that can never be reopened.
 *
 * @param {object} params
 * @param {string} params.workspaceId
 * @param {'OPEN'|'CLOSED'|'ARCHIVED'} params.status
 * @param {object} params.user Authenticated user context
 * @param {string|null} [params.ip]
 */
export async function changeWorkspaceStatus({ workspaceId, status, user, ip = null }) {
  const ws = await findWorkspaceById(getPool(), workspaceId);
  if (!ws || ws.org_id !== user.orgId) {
    throw new AppError('Workspace not found', 404, 'NOT_FOUND');
  }

  // Only creator or an administrator holding MANAGE_ORG may change status
  const userPolicy = await loadUser(getPool(), user.id);
  const canManage = ws.created_by === user.id || userPolicy?.permissions?.includes('MANAGE_ORG');
  if (!canManage) {
    throw new AppError(
      'Forbidden: Only workspace creator or organisation administrator may update status',
      403,
      'FORBIDDEN',
    );
  }

  // BR-14: ARCHIVED is terminal
  if (ws.status === 'ARCHIVED' && status !== 'ARCHIVED') {
    throw new AppError('Cannot reopen or modify an archived workspace', 409, 'CONFLICT');
  }

  if (ws.status === status) {
    return ws;
  }

  return withTransaction(async (tx) => {
    const updated = await updateWorkspaceStatus(tx, workspaceId, status);

    await appendAudit(tx, {
      orgId: user.orgId,
      actorId: user.id,
      action: 'ADMIN_CHANGE',
      outcome: 'ALLOWED',
      entityType: 'WORKSPACE',
      entityId: workspaceId,
      details: {
        action: 'UPDATE_WORKSPACE_STATUS',
        workspaceId,
        previousStatus: ws.status,
        newStatus: status,
      },
      ip,
    });

    return updated;
  });
}

/**
 * Assigns a user to a workspace as a member.
 *
 * @param {object} params
 * @param {string} params.workspaceId
 * @param {string} params.targetUserId
 * @param {object} params.user Authenticated user context
 * @param {string|null} [params.ip]
 */
export async function addWorkspaceMember({ workspaceId, targetUserId, user, ip = null }) {
  const ws = await findWorkspaceById(getPool(), workspaceId);
  if (!ws || ws.org_id !== user.orgId) {
    throw new AppError('Workspace not found', 404, 'NOT_FOUND');
  }

  // Creator or MANAGE_ORG required
  const userPolicy = await loadUser(getPool(), user.id);
  const canManage = ws.created_by === user.id || userPolicy?.permissions?.includes('MANAGE_ORG');
  if (!canManage) {
    throw new AppError(
      'Forbidden: Only workspace creator or organisation administrator may assign members',
      403,
      'FORBIDDEN',
    );
  }

  // Target user must exist and belong to the same organisation
  const targetUser = await loadUser(getPool(), targetUserId);
  if (!targetUser || targetUser.orgId !== user.orgId) {
    throw new AppError('Target user not found in this organisation', 404, 'NOT_FOUND');
  }

  return withTransaction(async (tx) => {
    const member = await insertWorkspaceMember(tx, {
      workspaceId,
      userId: targetUserId,
    });

    await appendAudit(tx, {
      orgId: user.orgId,
      actorId: user.id,
      action: 'ADMIN_CHANGE',
      outcome: 'ALLOWED',
      entityType: 'WORKSPACE',
      entityId: workspaceId,
      details: {
        action: 'ADD_WORKSPACE_MEMBER',
        workspaceId,
        targetUserId,
      },
      ip,
    });

    return member;
  });
}
