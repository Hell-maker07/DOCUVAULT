import bcrypt from 'bcryptjs';
import { withTransaction } from '../../config/db.js';
import { newKeyPair, wrap } from '../../utils/keys.js';
import { appendAudit } from '../audit/auditWriter.js';
import AppError from '../../utils/AppError.js';
import { findDepartmentByIdAndOrg } from '../departments/repo.js';
import { findPositionByIdAndOrg } from '../positions/repo.js';
import {
  listUsersByOrg,
  findUserByIdAndOrg,
  findUserByEmail,
  createUser as repoCreateUser,
  updateUser as repoUpdateUser,
} from './repo.js';

export async function getOrgUsers(orgId) {
  return listUsersByOrg(orgId);
}

export async function getOrgUserById(userId, orgId) {
  const user = await findUserByIdAndOrg(userId, orgId);
  if (!user) {
    throw new AppError('User not found in your organisation', 404, 'NOT_FOUND');
  }
  return user;
}

export async function createOrgUser(adminUser, input, ip = null) {
  // 1. Check for duplicate email across the platform
  const existingEmail = await findUserByEmail(input.email);
  if (existingEmail) {
    throw new AppError('Email address is already registered in DocuVault', 409, 'CONFLICT');
  }

  // 2. Enforce tenancy boundaries: verify department belongs to caller's organisation
  const dept = await findDepartmentByIdAndOrg(input.departmentId, adminUser.orgId);
  if (!dept) {
    throw new AppError(
      'Specified department does not exist in your organisation',
      400,
      'VALIDATION_ERROR',
    );
  }

  // 3. Enforce tenancy boundaries: verify position belongs to caller's organisation
  const pos = await findPositionByIdAndOrg(input.positionId, adminUser.orgId);
  if (!pos) {
    throw new AppError(
      'Specified position does not exist in your organisation',
      400,
      'VALIDATION_ERROR',
    );
  }

  // 4. Hash password with bcrypt
  const passwordHash = await bcrypt.hash(input.password, 10);

  // 5. Generate Ed25519 digital signature keypair and encrypt private key with AES-256-GCM
  const { publicKey, privateKey } = newKeyPair();
  const privateKeyEnc = wrap(privateKey);

  // 6. Atomically persist user and immutable audit log entry
  return withTransaction(async (tx) => {
    const createdUser = await repoCreateUser(tx, {
      departmentId: input.departmentId,
      positionId: input.positionId,
      email: input.email,
      fullName: input.fullName,
      employeeNo: input.employeeNo,
      passwordHash,
      publicKey,
      privateKeyEnc,
    });

    await appendAudit(tx, {
      orgId: adminUser.orgId,
      actorId: adminUser.id,
      action: 'ADMIN_CHANGE',
      entityType: 'USER',
      entityId: createdUser.id,
      outcome: 'ALLOWED',
      details: {
        action: 'USER_CREATE',
        email: createdUser.email,
        fullName: createdUser.fullName,
        departmentId: createdUser.departmentId,
        positionId: createdUser.positionId,
        departmentName: dept.name,
        positionTitle: pos.title,
      },
      ip,
    });

    return {
      id: createdUser.id,
      email: createdUser.email,
      fullName: createdUser.fullName,
      employeeNo: createdUser.employeeNo,
      departmentId: createdUser.departmentId,
      departmentName: dept.name,
      departmentCode: dept.code,
      positionId: createdUser.positionId,
      positionTitle: pos.title,
      clearanceLevel: pos.clearanceLevel,
      permissions: pos.permissions || [],
      isActive: createdUser.isActive,
      createdAt: createdUser.createdAt,
    };
  });
}

export async function updateOrgUser(adminUser, userId, input, ip = null) {
  const current = await findUserByIdAndOrg(userId, adminUser.orgId);
  if (!current) {
    throw new AppError('User not found in your organisation', 404, 'NOT_FOUND');
  }

  if (input.departmentId && input.departmentId !== current.departmentId) {
    const dept = await findDepartmentByIdAndOrg(input.departmentId, adminUser.orgId);
    if (!dept) {
      throw new AppError(
        'Specified department does not exist in your organisation',
        400,
        'VALIDATION_ERROR',
      );
    }
  }

  if (input.positionId && input.positionId !== current.positionId) {
    const pos = await findPositionByIdAndOrg(input.positionId, adminUser.orgId);
    if (!pos) {
      throw new AppError(
        'Specified position does not exist in your organisation',
        400,
        'VALIDATION_ERROR',
      );
    }
  }

  return withTransaction(async (tx) => {
    await repoUpdateUser(tx, userId, adminUser.orgId, {
      fullName: input.fullName,
      departmentId: input.departmentId,
      positionId: input.positionId,
      isActive: input.isActive,
      employeeNo: input.employeeNo,
    });

    await appendAudit(tx, {
      orgId: adminUser.orgId,
      actorId: adminUser.id,
      action: 'ADMIN_CHANGE',
      entityType: 'USER',
      entityId: userId,
      outcome: 'ALLOWED',
      details: {
        action: 'USER_UPDATE',
        targetUserId: userId,
        updatedFields: {
          fullName: input.fullName,
          departmentId: input.departmentId,
          positionId: input.positionId,
          isActive: input.isActive,
        },
      },
      ip,
    });

    return findUserByIdAndOrg(userId, adminUser.orgId, tx);
  });
}

export async function deactivateOrgUser(adminUser, userId, ip = null) {
  if (userId === adminUser.id) {
    throw new AppError('Cannot deactivate your own administrator account', 400, 'BAD_REQUEST');
  }

  const current = await findUserByIdAndOrg(userId, adminUser.orgId);
  if (!current) {
    throw new AppError('User not found in your organisation', 404, 'NOT_FOUND');
  }

  return withTransaction(async (tx) => {
    await repoUpdateUser(tx, userId, adminUser.orgId, { isActive: false });

    await appendAudit(tx, {
      orgId: adminUser.orgId,
      actorId: adminUser.id,
      action: 'ADMIN_CHANGE',
      entityType: 'USER',
      entityId: userId,
      outcome: 'ALLOWED',
      details: {
        action: 'USER_DEACTIVATE',
        targetUserId: userId,
        email: current.email,
        fullName: current.fullName,
      },
      ip,
    });

    return { id: userId, isActive: false, email: current.email };
  });
}
