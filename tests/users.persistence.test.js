import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { query, closePool } from '../src/config/db.js';

describe('Neon PostgreSQL Persistence: Employee Management Audit & Tests', () => {
  let app;
  let orgAAdminToken;
  let orgAOrg;
  let orgADept;
  let orgAPos;
  let orgBAdminToken;
  let orgBDept;

  const testSuffix = Date.now().toString();
  const orgAName = `Persistence Test Org A ${testSuffix}`;
  const orgAEmail = `admin_a_${testSuffix}@persistence.test`;
  const orgBName = `Persistence Test Org B ${testSuffix}`;
  const orgBEmail = `admin_b_${testSuffix}@persistence.test`;

  beforeAll(async () => {
    app = createApp();

    // 1. Register Organisation A
    const resA = await request(app).post('/api/v1/orgs').send({
      name: orgAName,
      orgType: 'CORPORATE',
      department: 'Headquarters',
      departmentCode: 'HQ',
      adminName: 'Alice Admin',
      email: orgAEmail,
      password: 'StrongAdminPassword123!',
    });
    expect(resA.status).toBe(201);
    orgAAdminToken = resA.body.data.accessToken;
    orgAOrg = resA.body.data.organization;

    // Get Org A initial department & position
    const deptsA = await request(app)
      .get('/api/v1/departments')
      .set('Authorization', `Bearer ${orgAAdminToken}`);
    orgADept = deptsA.body.data[0];

    const posA = await request(app)
      .get('/api/v1/positions')
      .set('Authorization', `Bearer ${orgAAdminToken}`);
    orgAPos = posA.body.data[0];

    // 2. Register Organisation B (for tenant isolation tests)
    const resB = await request(app).post('/api/v1/orgs').send({
      name: orgBName,
      orgType: 'POLICE_JUDICIARY',
      department: 'Central Branch',
      departmentCode: 'CB',
      adminName: 'Bob Admin',
      email: orgBEmail,
      password: 'StrongAdminPassword123!',
    });
    expect(resB.status).toBe(201);
    orgBAdminToken = resB.body.data.accessToken;

    const deptsB = await request(app)
      .get('/api/v1/departments')
      .set('Authorization', `Bearer ${orgBAdminToken}`);
    orgBDept = deptsB.body.data[0];
  });

  afterAll(async () => {
    await closePool();
  });

  let createdEmployeeId;
  const employeeEmail = `dev_${testSuffix}@persistence.test`;
  const employeePassword = 'DevEmployeePassword456!';

  describe('1. Employee Creation & Database Insertion', () => {
    it('successfully inserts an employee record into PostgreSQL with audit chaining', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .send({
          fullName: 'David Developer',
          email: employeeEmail,
          password: employeePassword,
          departmentId: orgADept.id,
          positionId: orgAPos.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.email).toBe(employeeEmail);
      expect(res.body.data.fullName).toBe('David Developer');
      expect(res.body.data.isActive).toBe(true);
      expect(res.body.data.departmentId).toBe(orgADept.id);
      expect(res.body.data.positionId).toBe(orgAPos.id);

      createdEmployeeId = res.body.data.id;

      // Direct verification in PostgreSQL
      const { rows } = await query('SELECT * FROM users WHERE id = $1', [createdEmployeeId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe(employeeEmail);
      expect(rows[0].full_name).toBe('David Developer');
      expect(rows[0].is_active).toBe(true);

      // Verify audit log entry was appended
      const { rows: auditRows } = await query(
        `SELECT * FROM audit_logs WHERE org_id = $1 AND entity_id = $2 AND action = 'ADMIN_CHANGE'`,
        [orgAOrg.id, createdEmployeeId],
      );
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(auditRows[0].outcome).toBe('ALLOWED');
    });
  });

  describe('2. Employee List Retrieval', () => {
    it('retrieves the saved employee record with department and position relations', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${orgAAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const found = res.body.data.find((u) => u.id === createdEmployeeId);
      expect(found).toBeDefined();
      expect(found.email).toBe(employeeEmail);
      expect(found.fullName).toBe('David Developer');
      expect(found.departmentName).toBe(orgADept.name);
      expect(found.positionTitle).toBe(orgAPos.title);
      expect(Array.isArray(found.permissions)).toBe(true);
    });
  });

  describe('3. Fresh API Request Persistence', () => {
    it('persists and retrieves the record on subsequent isolated requests', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${createdEmployeeId}`)
        .set('Authorization', `Bearer ${orgAAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(createdEmployeeId);
      expect(res.body.data.email).toBe(employeeEmail);
    });
  });

  describe('4. Browser Refresh Workflow Simulation', () => {
    it('simulates page reload sequence (auth/me then reloadUsersFromBackend)', async () => {
      // 1. Admin loads session on page refresh
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${orgAAdminToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.organization.id).toBe(orgAOrg.id);

      // 2. Admin dashboard pulls all org members
      const usersRes = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${orgAAdminToken}`);
      expect(usersRes.status).toBe(200);

      const memberIds = usersRes.body.data.map((u) => u.id);
      expect(memberIds).toContain(createdEmployeeId);
    });
  });

  describe('5. Logout and Relogin Preservation', () => {
    it('preserves employee records across session logout and relogin', async () => {
      // Login afresh
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: orgAEmail,
        password: 'StrongAdminPassword123!',
      });
      expect(loginRes.status).toBe(200);
      const newAdminToken = loginRes.body.data.accessToken;
      expect(newAdminToken).toBeDefined();

      // Retrieve users with the newly issued token
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${newAdminToken}`);
      expect(res.status).toBe(200);
      const found = res.body.data.find((u) => u.id === createdEmployeeId);
      expect(found).toBeDefined();
      expect(found.email).toBe(employeeEmail);
    });
  });

  describe('6. Unauthorized Access Rejection', () => {
    it('rejects employee creation without an authentication token', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .send({
          fullName: 'Unauth User',
          email: `unauth_${testSuffix}@persistence.test`,
          password: 'Password123!',
          departmentId: orgADept.id,
          positionId: orgAPos.id,
        });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects employee creation by a user without MANAGE_ORG permission', async () => {
      // Log in as the newly created developer (who doesn't have MANAGE_ORG)
      // First, create a position with only VIEW permission
      const createPosRes = await request(app)
        .post('/api/v1/positions')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .send({
          title: `Junior Analyst ${testSuffix}`,
          clearanceLevel: 1,
          deptScope: 'OWN_DEPT',
          permissions: ['VIEW'],
        });
      expect(createPosRes.status).toBe(201);
      const juniorPosId = createPosRes.body.data.id;

      // Create a user in this position
      const juniorEmail = `junior_${testSuffix}@persistence.test`;
      const createJuniorRes = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .send({
          fullName: 'Junior Analyst',
          email: juniorEmail,
          password: 'Password123!',
          departmentId: orgADept.id,
          positionId: juniorPosId,
        });
      expect(createJuniorRes.status).toBe(201);

      // Log in as junior analyst
      const juniorLoginRes = await request(app).post('/api/v1/auth/login').send({
        email: juniorEmail,
        password: 'Password123!',
      });
      expect(juniorLoginRes.status).toBe(200);
      const juniorToken = juniorLoginRes.body.data.accessToken;

      // Attempt to create another user using junior analyst's token
      const forbiddenRes = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${juniorToken}`)
        .send({
          fullName: 'Hacker User',
          email: `hacker_${testSuffix}@persistence.test`,
          password: 'Password123!',
          departmentId: orgADept.id,
          positionId: juniorPosId,
        });

      expect(forbiddenRes.status).toBe(403);
      expect(forbiddenRes.body.success).toBe(false);
    });
  });

  describe('7. Cross-Organisation Tenancy Isolation', () => {
    it('prevents Organisation B admin from seeing Organisation A members', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${orgBAdminToken}`);

      expect(res.status).toBe(200);
      const userIds = res.body.data.map((u) => u.id);
      expect(userIds).not.toContain(createdEmployeeId);
    });

    it('rejects creating a user referencing another organisation department or position', async () => {
      // Org A admin attempts to use Org B department
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .send({
          fullName: 'Cross Org User',
          email: `cross_${testSuffix}@persistence.test`,
          password: 'Password123!',
          departmentId: orgBDept.id, // Foreign department!
          positionId: orgAPos.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects Org B admin updating or deactivating Org A member', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/${createdEmployeeId}`)
        .set('Authorization', `Bearer ${orgBAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('8. Invalid Department and Position References', () => {
    it('rejects non-existent department UUID', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .send({
          fullName: 'Invalid Dept User',
          email: `invalid_dept_${testSuffix}@persistence.test`,
          password: 'Password123!',
          departmentId: '00000000-0000-0000-0000-000000000000',
          positionId: orgAPos.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects non-existent position UUID', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .send({
          fullName: 'Invalid Pos User',
          email: `invalid_pos_${testSuffix}@persistence.test`,
          password: 'Password123!',
          departmentId: orgADept.id,
          positionId: '00000000-0000-0000-0000-000000000000',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('9. Duplicate Email Handling', () => {
    it('returns 409 Conflict when enrolling a user with an already registered email', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .send({
          fullName: 'Duplicate David',
          email: employeeEmail, // Already registered in test 1!
          password: 'AnotherPassword123!',
          departmentId: orgADept.id,
          positionId: orgAPos.id,
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });

  describe('10. Security & Password Protection', () => {
    it('never stores plaintext password and protects private encryption keys', async () => {
      const { rows } = await query(
        'SELECT password_hash, public_key, private_key_enc FROM users WHERE id = $1',
        [createdEmployeeId],
      );

      const userRow = rows[0];
      // 1. Password must be hashed with bcrypt
      expect(userRow.password_hash).not.toBe(employeePassword);
      expect(userRow.password_hash.startsWith('$2')).toBe(true);
      const matches = await bcrypt.compare(employeePassword, userRow.password_hash);
      expect(matches).toBe(true);

      // 2. Ed25519 public key in PEM format
      expect(userRow.public_key).toContain('BEGIN PUBLIC KEY');

      // 3. Encrypted private key in iv.tag.enc format
      expect(userRow.private_key_enc.split('.')).toHaveLength(3);

      // 4. API responses must NEVER return password_hash or private_key_enc
      const getRes = await request(app)
        .get(`/api/v1/users/${createdEmployeeId}`)
        .set('Authorization', `Bearer ${orgAAdminToken}`);

      expect(getRes.body.data.password_hash).toBeUndefined();
      expect(getRes.body.data.passwordHash).toBeUndefined();
      expect(getRes.body.data.private_key_enc).toBeUndefined();
      expect(getRes.body.data.privateKeyEnc).toBeUndefined();
      expect(getRes.body.data.privateKey).toBeUndefined();
    });
  });

  describe('11. Employee Updates & Deactivation', () => {
    it('allows editing employee details and reflects changes in PostgreSQL', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${createdEmployeeId}`)
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .send({
          fullName: 'David Senior Developer',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.fullName).toBe('David Senior Developer');

      const { rows } = await query('SELECT full_name FROM users WHERE id = $1', [
        createdEmployeeId,
      ]);
      expect(rows[0].full_name).toBe('David Senior Developer');
    });

    it('soft deactivates employee and prevents login', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/${createdEmployeeId}`)
        .set('Authorization', `Bearer ${orgAAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);

      // Verify in DB
      const { rows } = await query('SELECT is_active FROM users WHERE id = $1', [
        createdEmployeeId,
      ]);
      expect(rows[0].is_active).toBe(false);

      // Verify deactivated user cannot log in
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: employeeEmail,
        password: employeePassword,
      });
      expect(loginRes.status).toBe(401);
      expect(loginRes.body.success).toBe(false);
    });
  });
});
