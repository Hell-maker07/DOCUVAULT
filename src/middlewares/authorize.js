import { getPool } from '../config/db.js';
import { decide, decideWorkspace, loadUser } from '../policy/decide.js';
import { writeAudit } from '../modules/audit/auditWriter.js';
import AppError from '../utils/AppError.js';

/**
 * Express middleware to enforce RBAC & classification rules on document routes (AP-03).
 *
 * @param {'VIEW'|'UPLOAD'|'EDIT'|'SIGN'|'SHARE'|'AUDIT'|'MANAGE_ORG'} permission
 * @param {(req: import('express').Request) => string} [getDocId] Function extracting document UUID
 */
export function authorizeDocument(
  permission,
  getDocId = (req) => req.params.id || req.params.docId,
) {
  return async (req, _res, next) => {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
      }

      const docId = getDocId(req);
      if (!docId) {
        throw new AppError('Document ID required', 400, 'VALIDATION_ERROR');
      }

      const decision = await decide(getPool(), req.user.id, docId, permission);

      if (!decision.ok) {
        if (decision.audit && decision.orgId) {
          await writeAudit({
            orgId: decision.orgId,
            actorId: decision.actorId,
            action: 'ACCESS_DENIED',
            outcome: 'DENIED',
            entityType: decision.entityType,
            entityId: decision.entityId,
            details: decision.details,
            ip: req.ip,
          }).catch((err) => console.error('Failed to log ACCESS_DENIED audit entry:', err));
        }

        throw new AppError(decision.message, decision.status, decision.code);
      }

      req.document = decision.document;
      req.policyUser = decision.user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Alias for authorizeDocument as the default document authorization middleware.
 */
export const authorize = authorizeDocument;

/**
 * Express middleware to enforce RBAC rules on workspace routes (e.g. uploading document v1).
 *
 * @param {'UPLOAD'|'VIEW'|'EDIT'|'MANAGE_ORG'} permission
 * @param {(req: import('express').Request) => string} [getWorkspaceId]
 */
export function authorizeWorkspace(
  permission,
  getWorkspaceId = (req) => req.params.id || req.params.workspaceId,
) {
  return async (req, _res, next) => {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
      }

      const wsId = getWorkspaceId(req);
      if (!wsId) {
        throw new AppError('Workspace ID required', 400, 'VALIDATION_ERROR');
      }

      const classification = req.body?.classification ? Number(req.body.classification) : undefined;
      const decision = await decideWorkspace(getPool(), req.user.id, wsId, permission, {
        classification,
      });

      if (!decision.ok) {
        if (decision.audit && decision.orgId) {
          await writeAudit({
            orgId: decision.orgId,
            actorId: decision.actorId,
            action: 'ACCESS_DENIED',
            outcome: 'DENIED',
            entityType: decision.entityType,
            entityId: decision.entityId,
            details: decision.details,
            ip: req.ip,
          }).catch((err) => console.error('Failed to log ACCESS_DENIED audit entry:', err));
        }

        throw new AppError(decision.message, decision.status, decision.code);
      }

      req.workspace = decision.workspace;
      req.policyUser = decision.user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Express middleware ensuring the authenticated user holds a specific system permission
 * (e.g. MANAGE_ORG for admin routes, AUDIT for audit log routes).
 *
 * @param {'MANAGE_ORG'|'AUDIT'|'VIEW'|'UPLOAD'|'EDIT'|'SIGN'|'SHARE'} permission
 */
export function requirePermission(permission) {
  return async (req, _res, next) => {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
      }

      const u = await loadUser(getPool(), req.user.id);
      if (!u || !u.isActive) {
        throw new AppError('User not found or inactive', 401, 'UNAUTHENTICATED');
      }

      if (!u.permissions.includes(permission)) {
        await writeAudit({
          orgId: u.orgId,
          actorId: u.id,
          action: 'ACCESS_DENIED',
          outcome: 'DENIED',
          entityType: 'ORGANIZATION',
          entityId: u.orgId,
          details: {
            reason: 'MISSING_PERMISSION',
            requiredPermission: permission,
            userPermissions: u.permissions,
          },
          ip: req.ip,
        }).catch((err) => console.error('Failed to log ACCESS_DENIED audit entry:', err));

        throw new AppError('Forbidden: Insufficient position permission', 403, 'FORBIDDEN');
      }

      req.policyUser = u;
      next();
    } catch (err) {
      next(err);
    }
  };
}
