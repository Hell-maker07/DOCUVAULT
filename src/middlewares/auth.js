import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { query } from '../config/db.js';
import AppError from '../utils/AppError.js';

/**
 * Authenticates requests using a Bearer JWT access token.
 * Populates req.user with fresh identity details from the database.
 */
export async function authenticate(req, _res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Authentication token required', 401, 'UNAUTHENTICATED');
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new AppError('Authentication token required', 401, 'UNAUTHENTICATED');
    }

    let payload;
    try {
      payload = jwt.verify(token, config.JWT_SECRET);
    } catch {
      throw new AppError('Invalid or expired authentication token', 401, 'UNAUTHENTICATED');
    }

    const userId = payload.sub;
    if (!userId) {
      throw new AppError('Invalid authentication token payload', 401, 'UNAUTHENTICATED');
    }

    const { rows } = await query(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.department_id, u.position_id,
              d.org_id, p.clearance_level, p.dept_scope
       FROM users u
       JOIN departments d ON d.id = u.department_id
       JOIN positions p ON p.id = u.position_id
       WHERE u.id = $1`,
      [userId],
    );

    if (rows.length === 0 || !rows[0].is_active) {
      throw new AppError('User not found or inactive', 401, 'UNAUTHENTICATED');
    }

    const u = rows[0];
    req.user = {
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      departmentId: u.department_id,
      positionId: u.position_id,
      orgId: u.org_id,
      clearanceLevel: u.clearance_level,
      deptScope: u.dept_scope,
    };

    next();
  } catch (err) {
    next(err);
  }
}
