import { query } from '../../config/db.js';

export async function listDepartmentsByOrg(orgId) {
  const { rows } = await query(
    `SELECT d.id, d.code, d.name, d.org_id,
            COUNT(u.id)::int AS "membersCount"
     FROM departments d
     LEFT JOIN users u ON u.department_id = d.id AND u.is_active = true
     WHERE d.org_id = $1
     GROUP BY d.id
     ORDER BY d.name ASC`,
    [orgId],
  );
  return rows;
}

export async function findDepartmentByIdAndOrg(id, orgId) {
  const { rows } = await query(
    `SELECT id, code, name, org_id
     FROM departments
     WHERE id = $1 AND org_id = $2`,
    [id, orgId],
  );
  return rows[0] || null;
}

export async function findDepartmentByCode(orgId, code) {
  const { rows } = await query(
    `SELECT id, code, name
     FROM departments
     WHERE org_id = $1 AND code = $2`,
    [orgId, code],
  );
  return rows[0] || null;
}

export async function createDepartment(tx, { orgId, code, name }) {
  const { rows } = await tx.query(
    `INSERT INTO departments (org_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id, code, name, org_id`,
    [orgId, code, name],
  );
  return rows[0];
}

export async function updateDepartment(tx, id, orgId, { code, name }) {
  const { rows } = await tx.query(
    `UPDATE departments
     SET code = COALESCE($3, code),
         name = COALESCE($4, name)
     WHERE id = $1 AND org_id = $2
     RETURNING id, code, name, org_id`,
    [id, orgId, code, name],
  );
  return rows[0] || null;
}
