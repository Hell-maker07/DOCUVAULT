import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env.js';
import AppError from '../../utils/AppError.js';
import { writeAudit } from '../audit/auditWriter.js';
import { findUserByEmail, findUserProfileById, findPermissionsByPositionId } from './repo.js';

/**
 * Authenticates user credentials and issues a JWT token.
 * Appends audit entries for both successful logins and failed attempts.
 * Returns identical error message on invalid email or wrong password to prevent user enumeration.
 *
 * @param {{ email: string, password: string }} credentials
 * @param {string|null} [ip]
 * @returns {Promise<{ accessToken: string, user: object }>}
 */
export async function login({ email, password }, ip = null) {
  const user = await findUserByEmail(email);

  // User does not exist
  if (!user) {
    throw new AppError('Invalid email or password', 401, 'UNAUTHENTICATED');
  }

  // User exists but has been deactivated
  if (!user.is_active) {
    await writeAudit({
      orgId: user.org_id,
      actorId: user.id,
      action: 'LOGIN_FAILED',
      outcome: 'FAILED',
      details: { reason: 'ACCOUNT_DEACTIVATED' },
      ip,
    }).catch((err) => console.error('Audit write error on login failure:', err));

    throw new AppError('Invalid email or password', 401, 'UNAUTHENTICATED');
  }

  // Check password hash
  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    await writeAudit({
      orgId: user.org_id,
      actorId: user.id,
      action: 'LOGIN_FAILED',
      outcome: 'FAILED',
      details: { reason: 'INVALID_CREDENTIALS' },
      ip,
    }).catch((err) => console.error('Audit write error on login failure:', err));

    throw new AppError('Invalid email or password', 401, 'UNAUTHENTICATED');
  }

  // Audit successful authentication
  await writeAudit({
    orgId: user.org_id,
    actorId: user.id,
    action: 'LOGIN',
    outcome: 'ALLOWED',
    ip,
  }).catch((err) => console.error('Audit write error on login success:', err));

  // Generate 1-hour JWT token
  const accessToken = jwt.sign(
    { sub: user.id },
    config.JWT_SECRET,
    { expiresIn: '1h' },
  );

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      departmentId: user.department_id,
      positionId: user.position_id,
    },
  };
}

/**
 * Retrieves the full profile, clearance level and effective permissions for the authenticated user.
 * @param {string} userId
 */
export async function getMe(userId) {
  const profile = await findUserProfileById(userId);

  if (!profile || !profile.is_active) {
    throw new AppError('User not found or inactive', 401, 'UNAUTHENTICATED');
  }

  const permissions = await findPermissionsByPositionId(profile.position_id);

  return {
    user: {
      id: profile.id,
      email: profile.email,
      employeeNo: profile.employee_no,
      fullName: profile.full_name,
      isActive: profile.is_active,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    },
    organization: {
      id: profile.org_id,
      name: profile.org_name,
      orgType: profile.org_type,
    },
    department: {
      id: profile.department_id,
      code: profile.department_code,
      name: profile.department_name,
    },
    position: {
      id: profile.position_id,
      title: profile.position_title,
      clearanceLevel: profile.clearance_level,
      deptScope: profile.dept_scope,
    },
    clearance: profile.clearance_level,
    permissions,
  };
}
