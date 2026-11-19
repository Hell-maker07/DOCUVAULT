import { withTransaction } from '../../config/db.js';
import { appendAudit } from '../audit/auditWriter.js';
import AppError from '../../utils/AppError.js';
import {
  listDepartmentsByOrg,
  findDepartmentByIdAndOrg,
  findDepartmentByCode,
  createDepartment as repoCreateDepartment,
  updateDepartment as repoUpdateDepartment,
} from './repo.js';

export async function getDepartments(orgId) {
  return listDepartmentsByOrg(orgId);
}

export async function createDepartment(adminUser, input, ip = null) {
  const existing = await findDepartmentByCode(adminUser.orgId, input.code);
  if (existing) {
    throw new AppError(
      `Department with code '${input.code}' already exists in your organisation`,
      409,
      'CONFLICT',
    );
  }

  return withTransaction(async (tx) => {
    const dept = await repoCreateDepartment(tx, {
      orgId: adminUser.orgId,
      code: input.code,
      name: input.name,
    });

    await appendAudit(tx, {
      orgId: adminUser.orgId,
      actorId: adminUser.id,
      action: 'ADMIN_CHANGE',
      entityType: 'DEPARTMENT',
      entityId: dept.id,
      outcome: 'ALLOWED',
      details: {
        action: 'DEPARTMENT_CREATE',
        code: dept.code,
        name: dept.name,
      },
      ip,
    });

    return dept;
  });
}

export async function updateDepartment(adminUser, deptId, input, ip = null) {
  const current = await findDepartmentByIdAndOrg(deptId, adminUser.orgId);
  if (!current) {
    throw new AppError('Department not found in your organisation', 404, 'NOT_FOUND');
  }

  if (input.code && input.code !== current.code) {
    const codeConflict = await findDepartmentByCode(adminUser.orgId, input.code);
    if (codeConflict) {
      throw new AppError(
        `Department code '${input.code}' already in use in your organisation`,
        409,
        'CONFLICT',
      );
    }
  }

  return withTransaction(async (tx) => {
    const updated = await repoUpdateDepartment(tx, deptId, adminUser.orgId, {
      code: input.code,
      name: input.name,
    });

    await appendAudit(tx, {
      orgId: adminUser.orgId,
      actorId: adminUser.id,
      action: 'ADMIN_CHANGE',
      entityType: 'DEPARTMENT',
      entityId: deptId,
      outcome: 'ALLOWED',
      details: {
        action: 'DEPARTMENT_UPDATE',
        code: updated.code,
        name: updated.name,
      },
      ip,
    });

    return updated;
  });
}
