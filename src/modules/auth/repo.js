import { query } from '../../config/db.js';

/**
 * Loads a user with department and organisation references by email.
 * @param {string} email
 */
export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name, u.password_hash, u.is_active,
            u.department_id, u.position_id, d.org_id
     FROM users u
     JOIN departments d ON d.id = u.department_id
     WHERE u.email = $1`,
    [email],
  );
  return rows[0] || null;
}

/**
 * Loads detailed user profile with associated department, position and organisation data.
 * @param {string} userId
 */
export async function findUserProfileById(userId) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.employee_no, u.full_name, u.is_active, u.created_at, u.updated_at,
            d.id AS department_id, d.code AS department_code, d.name AS department_name,
            o.id AS org_id, o.name AS org_name, o.org_type,
            p.id AS position_id, p.title AS position_title, p.clearance_level, p.dept_scope
     FROM users u
     JOIN departments d ON d.id = u.department_id
     JOIN organizations o ON o.id = d.org_id
     JOIN positions p ON p.id = u.position_id
     WHERE u.id = $1`,
    [userId],
  );
  return rows[0] || null;
}

/**
 * Returns the list of permission codes granted to a position.
 * @param {string} positionId
 * @returns {Promise<string[]>}
 */
export async function findPermissionsByPositionId(positionId) {
  const { rows } = await query(
    `SELECT perm.code
     FROM position_permissions pp
     JOIN permissions perm ON perm.id = pp.permission_id
     WHERE pp.position_id = $1
     ORDER BY perm.code`,
    [positionId],
  );
  return rows.map((r) => r.code);
}
