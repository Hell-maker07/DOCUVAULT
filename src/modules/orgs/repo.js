/**
 * Repository operations for organisation management.
 */

/**
 * Bootstraps an organisation inside a caller-managed transaction:
 * creates the organisation, default department, administrator position with all 7 permissions,
 * and the initial administrator user.
 *
 * @param {import('pg').PoolClient} tx
 * @param {object} params
 */
export async function createOrgBootstrap(tx, params) {
  const {
    name,
    orgType,
    departmentCode,
    departmentName,
    adminName,
    email,
    passwordHash,
    publicKey,
    privateKeyEnc,
  } = params;

  // 1. Insert organisation
  const orgRes = await tx.query(
    `INSERT INTO organizations (name, org_type)
     VALUES ($1, $2)
     RETURNING id, name, org_type, created_at`,
    [name, orgType],
  );
  const organization = orgRes.rows[0];

  // 2. Insert initial department
  const deptRes = await tx.query(
    `INSERT INTO departments (org_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id, code, name`,
    [organization.id, departmentCode, departmentName],
  );
  const department = deptRes.rows[0];

  // 3. Insert administrator position at clearance 4 and scope ORG
  const posRes = await tx.query(
    `INSERT INTO positions (org_id, title, clearance_level, dept_scope)
     VALUES ($1, 'Administrator', 4, 'ORG')
     RETURNING id, title, clearance_level, dept_scope`,
    [organization.id],
  );
  const position = posRes.rows[0];

  // 4. Assign all 7 platform permissions to this position
  await tx.query(
    `INSERT INTO position_permissions (position_id, permission_id)
     SELECT $1, id FROM permissions`,
    [position.id],
  );

  // 5. Insert initial administrator user
  const userRes = await tx.query(
    `INSERT INTO users (
       department_id, position_id, email, full_name,
       password_hash, public_key, private_key_enc, is_active
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, true)
     RETURNING id, email, full_name, is_active, created_at`,
    [department.id, position.id, email, adminName, passwordHash, publicKey, privateKeyEnc],
  );
  const user = userRes.rows[0];

  return { organization, department, position, user };
}
