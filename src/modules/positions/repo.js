import { query } from '../../config/db.js';

export async function listPositionsByOrg(orgId) {
  const { rows } = await query(
    `SELECT p.id, p.org_id, p.title, p.clearance_level AS "clearanceLevel",
            p.dept_scope AS "deptScope",
            COALESCE(
              (SELECT array_agg(perm.code ORDER BY perm.code)
               FROM position_permissions pp
               JOIN permissions perm ON perm.id = pp.permission_id
               WHERE pp.position_id = p.id),
              '{}'::varchar[]
            ) AS permissions
     FROM positions p
     WHERE p.org_id = $1
     ORDER BY p.clearance_level DESC, p.title ASC`,
    [orgId],
  );
  return rows;
}

export async function findPositionByIdAndOrg(id, orgId) {
  const { rows } = await query(
    `SELECT p.id, p.org_id, p.title, p.clearance_level AS "clearanceLevel",
            p.dept_scope AS "deptScope",
            COALESCE(
              (SELECT array_agg(perm.code ORDER BY perm.code)
               FROM position_permissions pp
               JOIN permissions perm ON perm.id = pp.permission_id
               WHERE pp.position_id = p.id),
              '{}'::varchar[]
            ) AS permissions
     FROM positions p
     WHERE p.id = $1 AND p.org_id = $2`,
    [id, orgId],
  );
  return rows[0] || null;
}

export async function findPositionByTitle(orgId, title) {
  const { rows } = await query(
    `SELECT id, title FROM positions WHERE org_id = $1 AND lower(title) = lower($2)`,
    [orgId, title],
  );
  return rows[0] || null;
}

export async function createPosition(tx, { orgId, title, clearanceLevel, deptScope, permissions }) {
  const { rows } = await tx.query(
    `INSERT INTO positions (org_id, title, clearance_level, dept_scope)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, clearance_level AS "clearanceLevel", dept_scope AS "deptScope"`,
    [orgId, title, clearanceLevel, deptScope],
  );
  const position = rows[0];

  if (permissions && permissions.length > 0) {
    await tx.query(
      `INSERT INTO position_permissions (position_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = ANY($2::varchar[])`,
      [position.id, permissions],
    );
  }

  return { ...position, permissions: permissions || [] };
}

export async function updatePosition(
  tx,
  id,
  orgId,
  { title, clearanceLevel, deptScope, permissions },
) {
  const { rows } = await tx.query(
    `UPDATE positions
     SET title = COALESCE($3, title),
         clearance_level = COALESCE($4, clearance_level),
         dept_scope = COALESCE($5, dept_scope)
     WHERE id = $1 AND org_id = $2
     RETURNING id, title, clearance_level AS "clearanceLevel", dept_scope AS "deptScope"`,
    [id, orgId, title, clearanceLevel, deptScope],
  );
  const position = rows[0];
  if (!position) return null;

  if (permissions !== undefined) {
    await tx.query(`DELETE FROM position_permissions WHERE position_id = $1`, [id]);
    if (permissions.length > 0) {
      await tx.query(
        `INSERT INTO position_permissions (position_id, permission_id)
         SELECT $1, id FROM permissions WHERE code = ANY($2::varchar[])`,
        [id, permissions],
      );
    }
  }

  const { rows: permRows } = await tx.query(
    `SELECT perm.code
     FROM position_permissions pp
     JOIN permissions perm ON perm.id = pp.permission_id
     WHERE pp.position_id = $1
     ORDER BY perm.code`,
    [id],
  );

  return {
    ...position,
    permissions: permRows.map((r) => r.code),
  };
}
