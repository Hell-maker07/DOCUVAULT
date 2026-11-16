import { execFileSync } from 'node:child_process';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { unwrap } from '../src/utils/keys.js';
import { closePool } from '../src/config/db.js';

const app = createApp();
let pool;
const q = (text, params) => pool.query(text, params);

beforeAll(async () => {
  execFileSync('node', ['scripts/db.js', 'reset'], {
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'pipe',
  });
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST });
});

afterAll(async () => {
  if (pool) await pool.end();
  await closePool();
});

describe('AP-01 Authentication & Organisation Bootstrap', () => {
  const randomSuffix = () => Math.random().toString(36).slice(2, 8);
  const sampleOrg = () => {
    const s = randomSuffix();
    return {
      name: `City Police Dept ${s}`,
      orgType: 'POLICE_JUDICIARY',
      department: 'Crime Branch',
      adminName: 'Commissioner Gordon',
      email: `gordon.${s}@gotham.test`,
      password: 'SuperSecretPassword123!',
    };
  };

  describe('POST /api/v1/orgs (Organisation Registration)', () => {
    it('bootstraps an organisation: returns 201, valid JWT, and grants administrator all 7 permissions', async () => {
      const payload = sampleOrg();
      const res = await request(app)
        .post('/api/v1/orgs')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(typeof res.body.data.accessToken).toBe('string');
      expect(res.body.data.organization.name).toBe(payload.name);
      expect(res.body.data.user.email).toBe(payload.email.toLowerCase());

      const orgId = res.body.data.organization.id;
      const userId = res.body.data.user.id;

      // Verify administrator position exists with clearance 4 and scope ORG
      const { rows: posRows } = await q(
        `SELECT p.id, p.title, p.clearance_level, p.dept_scope
         FROM positions p
         WHERE p.org_id = $1`,
        [orgId],
      );
      expect(posRows.length).toBe(1);
      expect(posRows[0].clearance_level).toBe(4);
      expect(posRows[0].dept_scope).toBe('ORG');
      expect(posRows[0].title).toBe('Administrator');

      // Verify all 7 permissions are held by the administrator position
      const { rows: permRows } = await q(
        `SELECT perm.code
         FROM position_permissions pp
         JOIN permissions perm ON perm.id = pp.permission_id
         WHERE pp.position_id = $1
         ORDER BY perm.code`,
        [posRows[0].id],
      );
      const permCodes = permRows.map((r) => r.code);
      expect(permCodes).toHaveLength(7);
      expect(permCodes).toEqual([
        'AUDIT',
        'EDIT',
        'MANAGE_ORG',
        'SHARE',
        'SIGN',
        'UPLOAD',
        'VIEW',
      ]);

      // Verify user has Ed25519 key pair stored and private key is encrypted
      const { rows: userRows } = await q(
        `SELECT public_key, private_key_enc, password_hash
         FROM users WHERE id = $1`,
        [userId],
      );
      expect(userRows[0].public_key).toContain('BEGIN PUBLIC KEY');
      expect(userRows[0].private_key_enc).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
      // Ensure private key can be decrypted using KEY_ENC_SECRET
      const decryptedPriv = unwrap(userRows[0].private_key_enc);
      expect(decryptedPriv).toContain('BEGIN PRIVATE KEY');

      // Verify audit log has seq 1 entry for this org
      const { rows: auditRows } = await q(
        `SELECT seq, action, outcome, prev_hash, hash
         FROM audit_logs WHERE org_id = $1 ORDER BY seq`,
        [orgId],
      );
      expect(auditRows.length).toBe(1);
      expect(auditRows[0].seq).toBe(1);
      expect(auditRows[0].action).toBe('ADMIN_CHANGE');
      expect(auditRows[0].outcome).toBe('ALLOWED');
      expect(auditRows[0].prev_hash).toBe('0'.repeat(64));
    });

    it('rejects registration with an organisation name that already exists (409 CONFLICT)', async () => {
      const payload = sampleOrg();
      const first = await request(app).post('/api/v1/orgs').send(payload);
      expect(first.status).toBe(201);

      // Attempt to register same organisation name with different email
      const dup = { ...payload, email: `diff.${randomSuffix()}@x.test` };
      const res = await request(app).post('/api/v1/orgs').send(dup);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('rejects registration with an email that already exists (409 CONFLICT)', async () => {
      const payload = sampleOrg();
      const first = await request(app).post('/api/v1/orgs').send(payload);
      expect(first.status).toBe(201);

      // Attempt to register with same email in a new organisation name
      const dup = { ...payload, name: `Other Org ${randomSuffix()}` };
      const res = await request(app).post('/api/v1/orgs').send(dup);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('validates input strictly: rejects password shorter than 8 characters', async () => {
      const payload = { ...sampleOrg(), password: 'short' };
      const res = await request(app).post('/api/v1/orgs').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('validates input strictly: rejects invalid email format', async () => {
      const payload = { ...sampleOrg(), email: 'not-an-email' };
      const res = await request(app).post('/api/v1/orgs').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('validates input strictly: rejects unexpected extra fields', async () => {
      const payload = { ...sampleOrg(), role: 'SUPERUSER', isAdmin: true };
      const res = await request(app).post('/api/v1/orgs').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    let testUser;

    beforeAll(async () => {
      testUser = sampleOrg();
      const reg = await request(app).post('/api/v1/orgs').send(testUser);
      expect(reg.status).toBe(201);
    });

    it('logs in successfully with valid credentials and returns accessToken and user details', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data.user.email).toBe(testUser.email.toLowerCase());
    });

    it('returns 401 with the exact same error message for unknown email and wrong password', async () => {
      // 1. Wrong password
      const wrongPassRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: 'IncorrectPassword999!',
        });

      // 2. Unknown email
      const unknownEmailRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: `nobody.${randomSuffix()}@nowhere.test`,
          password: 'AnyPassword123!',
        });

      expect(wrongPassRes.status).toBe(401);
      expect(wrongPassRes.body.error.code).toBe('UNAUTHENTICATED');
      expect(unknownEmailRes.status).toBe(401);
      expect(unknownEmailRes.body.error.code).toBe('UNAUTHENTICATED');

      // Crucial security requirement: messages must be identical so attackers cannot enumerate emails
      expect(wrongPassRes.body.error.message).toBe(unknownEmailRes.body.error.message);
      expect(wrongPassRes.body.error.message).toBe('Invalid email or password');
    });

    it('rejects login when user is deactivated (is_active = false) with 401', async () => {
      const deactUser = sampleOrg();
      await request(app).post('/api/v1/orgs').send(deactUser);

      // Deactivate user in database
      await q(`UPDATE users SET is_active = false WHERE email = $1`, [deactUser.email.toLowerCase()]);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: deactUser.email,
          password: deactUser.password,
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.error.message).toBe('Invalid email or password');
    });
  });

  describe('GET /api/v1/auth/me (Protected Route & Identity Inspection)', () => {
    let authUser, authToken;

    beforeAll(async () => {
      authUser = sampleOrg();
      const reg = await request(app).post('/api/v1/orgs').send(authUser);
      authToken = reg.body.data.accessToken;
    });

    it('returns 401 UNAUTHENTICATED when token is missing', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.error.message).toMatch(/token required/i);
    });

    it('returns 401 UNAUTHENTICATED when token is invalid or corrupted', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.payload');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 200 with full user identity, clearance 4 and all 7 permissions for valid token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { user, organization, department, position, clearance, permissions } = res.body.data;

      expect(user.email).toBe(authUser.email.toLowerCase());
      expect(user.fullName).toBe(authUser.adminName);
      expect(user.isActive).toBe(true);

      expect(organization.name).toBe(authUser.name);
      expect(organization.orgType).toBe(authUser.orgType);

      expect(department.name).toBe(authUser.department);

      expect(position.title).toBe('Administrator');
      expect(position.clearanceLevel).toBe(4);
      expect(position.deptScope).toBe('ORG');

      expect(clearance).toBe(4);
      expect(permissions).toHaveLength(7);
      expect(permissions).toContain('VIEW');
      expect(permissions).toContain('UPLOAD');
      expect(permissions).toContain('EDIT');
      expect(permissions).toContain('SIGN');
      expect(permissions).toContain('SHARE');
      expect(permissions).toContain('AUDIT');
      expect(permissions).toContain('MANAGE_ORG');
    });

    it('rejects access if the user was deactivated after token was issued', async () => {
      const tempUser = sampleOrg();
      const reg = await request(app).post('/api/v1/orgs').send(tempUser);
      const token = reg.body.data.accessToken;

      // Deactivate user in database
      await q(`UPDATE users SET is_active = false WHERE email = $1`, [tempUser.email.toLowerCase()]);

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.error.message).toMatch(/inactive/i);
    });
  });
});
