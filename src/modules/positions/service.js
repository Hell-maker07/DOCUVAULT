import { withTransaction } from '../../config/db.js';
import { appendAudit } from '../audit/auditWriter.js';
import AppError from '../../utils/AppError.js';
import {
  listPositionsByOrg,
  findPositionByIdAndOrg,
  findPositionByTitle,
  createPosition as repoCreatePosition,
  updatePosition as repoUpdatePosition,
} from './repo.js';

export async function getPositions(orgId) {
  return listPositionsByOrg(orgId);
}

export async function createPosition(adminUser, input, ip = null) {
  const existing = await findPositionByTitle(adminUser.orgId, input.title);
  if (existing) {
    throw new AppError(
      `Position with title '${input.title}' already exists in your organisation`,
      409,
      'CONFLICT',
    );
  }

  return withTransaction(async (tx) => {
    const position = await repoCreatePosition(tx, {
      orgId: adminUser.orgId,
      title: input.title,
      clearanceLevel: input.clearanceLevel,
      deptScope: input.deptScope,
      permissions: input.permissions,
    });

    await appendAudit(tx, {
      orgId: adminUser.orgId,
      actorId: adminUser.id,
      action: 'ADMIN_CHANGE',
      entityType: 'POSITION',
      entityId: position.id,
      outcome: 'ALLOWED',
      details: {
        action: 'POSITION_CREATE',
        title: position.title,
        clearanceLevel: position.clearanceLevel,
        deptScope: position.deptScope,
        permissions: position.permissions,
      },
      ip,
    });

    return position;
  });
}

export async function updatePosition(adminUser, posId, input, ip = null) {
  const current = await findPositionByIdAndOrg(posId, adminUser.orgId);
  if (!current) {
    throw new AppError('Position not found in your organisation', 404, 'NOT_FOUND');
  }

  if (input.title && input.title.toLowerCase() !== current.title.toLowerCase()) {
    const titleConflict = await findPositionByTitle(adminUser.orgId, input.title);
    if (titleConflict) {
      throw new AppError(
        `Position title '${input.title}' already in use in your organisation`,
        409,
        'CONFLICT',
      );
    }
  }

  return withTransaction(async (tx) => {
    const updated = await repoUpdatePosition(tx, posId, adminUser.orgId, {
      title: input.title,
      clearanceLevel: input.clearanceLevel,
      deptScope: input.deptScope,
      permissions: input.permissions,
    });

    await appendAudit(tx, {
      orgId: adminUser.orgId,
      actorId: adminUser.id,
      action: 'ADMIN_CHANGE',
      entityType: 'POSITION',
      entityId: posId,
      outcome: 'ALLOWED',
      details: {
        action: 'POSITION_UPDATE',
        title: updated.title,
        clearanceLevel: updated.clearanceLevel,
        deptScope: updated.deptScope,
        permissions: updated.permissions,
      },
      ip,
    });

    return updated;
  });
}
