import { query } from '../../config/db.js';

export async function listUsersByOrg(orgId) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.employee_no AS "employeeNo", u.full_name AS "fullName",
            u.is_active AS "isActive", u.created_at AS "createdAt", u.updated_at AS "updatedAt",
            u.department_id AS "departmentId", d.name AS "departmentName", d.code AS "departmentCode",
            u.position_id AS "positionId", p.title AS "positionTitle",
            p.clearance_level AS "clearanceLevel", p.dept_scope AS "deptScope",
            COALESCE(
              (SELECT array_agg(perm.code ORDER BY perm.code)
               FROM position_permissions pp
               JOIN permissions perm ON perm.id = pp.permission_id
               WHERE pp.position_id = u.position_id),
              '{}'::varchar[]
            ) AS permissions
     FROM users u
     JOIN departments d ON d.id = u.department_id
     JOIN positions p ON p.id = u.position_id
     WHERE d.org_id = $1
     ORDER BY u.created_at ASC`,
    [orgId],
  );
  return rows;
}

export async function findUserByIdAndOrg(userId, orgId, db = null) {
  const q = db ? (text, params) => db.query(text, params) : query;
  const { rows } = await q(
    `SELECT u.id, u.email, u.employee_no AS "employeeNo", u.full_name AS "fullName",
            u.is_active AS "isActive", u.created_at AS "createdAt", u.updated_at AS "updatedAt",
            u.department_id AS "departmentId", d.name AS "departmentName", d.code AS "departmentCode",
            u.position_id AS "positionId", p.title AS "positionTitle",
            p.clearance_level AS "clearanceLevel", p.dept_scope AS "deptScope",
            COALESCE(
              (SELECT array_agg(perm.code ORDER BY perm.code)
               FROM position_permissions pp
               JOIN permissions perm ON perm.id = pp.permission_id
               WHERE pp.position_id = u.position_id),
              '{}'::varchar[]
            ) AS permissions
     FROM users u
     JOIN departments d ON d.id = u.department_id
     JOIN positions p ON p.id = u.position_id
     WHERE u.id = $1 AND d.org_id = $2`,
    [userId, orgId],
  );
  return rows[0] || null;
}

export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, full_name, is_active FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] || null;
}

export async function createUser(
  tx,
  { departmentId, positionId, email, fullName, employeeNo, passwordHash, publicKey, privateKeyEnc },
) {
  const { rows } = await tx.query(
    `INSERT INTO users (
       department_id, position_id, email, full_name, employee_no,
       password_hash, public_key, private_key_enc, is_active
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     RETURNING id, department_id AS "departmentId", position_id AS "positionId",
               email, full_name AS "fullName", employee_no AS "employeeNo",
               is_active AS "isActive", created_at AS "createdAt"`,
    [
      departmentId,
      positionId,
      email,
      fullName,
      employeeNo || null,
      passwordHash,
      publicKey,
      privateKeyEnc,
    ],
  );
  return rows[0];
}

export async function updateUser(
  tx,
  userId,
  orgId,
  { fullName, departmentId, positionId, isActive, employeeNo },
) {
  const { rows } = await tx.query(
    `UPDATE users u
     SET full_name = COALESCE($3, u.full_name),
         department_id = COALESCE($4, u.department_id),
         position_id = COALESCE($5, u.position_id),
         is_active = COALESCE($6, u.is_active),
         employee_no = COALESCE($7, u.employee_no),
         updated_at = now()
     FROM departments d
     WHERE u.id = $1 AND d.id = u.department_id AND d.org_id = $2
     RETURNING u.id, u.department_id AS "departmentId", u.position_id AS "positionId",
               u.email, u.full_name AS "fullName", u.employee_no AS "employeeNo",
               u.is_active AS "isActive", u.created_at AS "createdAt", u.updated_at AS "updatedAt"`,
    [
      userId,
      orgId,
      fullName !== undefined ? fullName : null,
      departmentId !== undefined ? departmentId : null,
      positionId !== undefined ? positionId : null,
      isActive !== undefined ? isActive : null,
      employeeNo !== undefined ? employeeNo : null,
    ],
  );
  return rows[0] || null;
}
