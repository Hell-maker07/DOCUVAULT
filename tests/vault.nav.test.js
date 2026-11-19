import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/config/db.js';

describe('Step 9: Temporary Home Page & Vault Navigation', () => {
  let app;
  let adminToken;
  let employeeToken;
  let orgDept;
  let orgPos;

  const testSuffix = Date.now().toString();
  const orgName = `Nav Test Org ${testSuffix}`;
  const adminEmail = `admin_nav_${testSuffix}@nav.test`;
  const employeeEmail = `employee_nav_${testSuffix}@nav.test`;

  beforeAll(async () => {
    app = createApp();

    // 1. Register Organisation
    const resOrg = await request(app).post('/api/v1/orgs').send({
      name: orgName,
      orgType: 'CORPORATE',
      department: 'Operations',
      departmentCode: 'OPS',
      adminName: 'Admin Navigator',
      email: adminEmail,
      password: 'StrongAdminPassword123!',
    });
    expect(resOrg.status).toBe(201);
    adminToken = resOrg.body.data.accessToken;

    // Get Department & Position
    const deptsRes = await request(app)
      .get('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`);
    orgDept = deptsRes.body.data[0];

    // Create a regular employee position with only VIEW permission
    const posRes = await request(app)
      .post('/api/v1/positions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: `Regular Staff ${testSuffix}`,
        clearanceLevel: 1,
        deptScope: 'OWN_DEPT',
        permissions: ['VIEW'],
      });
    expect(posRes.status).toBe(201);
    orgPos = posRes.body.data;

    // Enroll a normal employee
    const empRes = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Emily Employee',
        email: employeeEmail,
        password: 'EmployeePassword123!',
        departmentId: orgDept.id,
        positionId: orgPos.id,
      });
    expect(empRes.status).toBe(201);

    // Login as the normal employee
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: employeeEmail,
      password: 'EmployeePassword123!',
    });
    expect(loginRes.status).toBe(200);
    employeeToken = loginRes.body.data.accessToken;
  });

  afterAll(async () => {
    await closePool();
  });

  describe('Static Page Routing & Temporary Home Page Structure', () => {
    it('GET /home and /vault serve home.html with status 200', async () => {
      const resHome = await request(app).get('/home');
      expect(resHome.status).toBe(200);
      expect(resHome.headers['content-type']).toMatch(/text\/html/);

      const resVault = await request(app).get('/vault');
      expect(resVault.status).toBe(200);
      expect(resVault.headers['content-type']).toMatch(/text\/html/);

      const resHomeHtml = await request(app).get('/home.html');
      expect(resHomeHtml.status).toBe(200);
    });

    it('contains required branding, welcome heading, and preparation notice', async () => {
      const res = await request(app).get('/home.html');
      const html = res.text;

      // Branding & palette
      expect(html).toContain('DOCUVAULT');
      expect(html).toContain('Welcome to DocuVault');
      expect(html.replace(/\s+/g, ' ')).toContain(
        'Your Vault workspace is being prepared. Document management features will be available soon.',
      );
      expect(html).toContain('#B59778'); // Soft Fawn
      expect(html).toContain('#1E2952'); // Space Indigo
      expect(html).toContain('#2E5090'); // Dusk Blue

      // Required navigation elements
      expect(html).toContain('id="nav-admin-dashboard-btn"');
      expect(html).toContain('id="topbar-logout-btn"');
      expect(html).toContain('admin-only');
    });

    it('does NOT implement Step 10 Vault UI (preserves boundaries for Sakshi)', async () => {
      const res = await request(app).get('/home.html');
      const html = res.text;

      expect(html).not.toContain('id="document-upload-dropzone"');
      expect(html).not.toContain('id="vault-document-grid"');
      expect(html).not.toContain('id="audit-log-viewer"');
      expect(html).not.toContain('id="file-upload-input"');
    });
  });

  describe('Flow 1: Organisation Registration Redirection', () => {
    it('verifies register.html redirects initial administrator to the existing dashboard', async () => {
      const res = await request(app).get('/register.html');
      expect(res.status).toBe(200);
      // Confirms registration page directs to /dashboard
      expect(res.text).toContain("window.location.href = '/dashboard'");
    });
  });

  describe('Flow 2 & 3: Normal Login Navigation', () => {
    it('verifies login.html redirects all normal logins to the temporary home page', async () => {
      const res = await request(app).get('/login.html');
      expect(res.status).toBe(200);
      // Confirms login page directs to /home.html
      expect(res.text).toContain("window.location.href = '/home.html'");
    });

    it('verifies index.html redirects authenticated sessions to /home.html', async () => {
      const res = await request(app).get('/index.html');
      expect(res.status).toBe(200);
      expect(res.text).toContain("window.location.replace('/home.html')");
    });
  });

  describe('Flow 4 & 5: Role-based Navigation & Permission Controls', () => {
    it('allows Organisation Administrator to access MANAGE_ORG endpoints', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.permissions).toContain('MANAGE_ORG');

      // Admin can access users list
      const usersRes = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(usersRes.status).toBe(200);
    });

    it('denies normal employee access to Organisation Administration (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.permissions).not.toContain('MANAGE_ORG');

      // Employee cannot access admin-only users list
      const usersRes = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${employeeToken}`);
      expect(usersRes.status).toBe(403);
      expect(usersRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Flow 6: "Take Me to Vault" Navigation in Organisation Dashboard', () => {
    it('Organisation Admin Dashboard contains the "Take Me to Vault" navigation option', async () => {
      const res = await request(app).get('/dashboard');
      expect(res.status).toBe(200);
      const html = res.text;

      expect(html).toContain('Take Me to Vault');
      expect(html).toContain('id="nav-btn-vault"');
      expect(html).toContain('href="/home.html"');
      expect(html).toContain('id="dropdown-vault-link"');
    });
  });

  describe('Flow 7 & 8: Employee Persistence & Organization Management Continuity', () => {
    it('continues persisting new employees and departments to PostgreSQL', async () => {
      // 1. Create a new department
      const newDeptCode = `HR${testSuffix.slice(-3)}`;
      const deptRes = await request(app)
        .post('/api/v1/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: newDeptCode,
          name: 'Human Resources Enclave',
        });
      expect(deptRes.status).toBe(201);
      const newDeptId = deptRes.body.data.id;

      // 2. Create another employee in this department
      const newEmpEmail = `hr_${testSuffix}@nav.test`;
      const empRes = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: 'Helen HR',
          email: newEmpEmail,
          password: 'HrPassword123!',
          departmentId: newDeptId,
          positionId: orgPos.id,
        });
      expect(empRes.status).toBe(201);

      // 3. Retrieve users list from PostgreSQL
      const listRes = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
      const emails = listRes.body.data.map((u) => u.email);
      expect(emails).toContain(newEmpEmail);
    });
  });

  describe('Flow 9: Logout Functionality', () => {
    it('home.html contains clean logout handler that purges session storage', async () => {
      const res = await request(app).get('/home.html');
      expect(res.status).toBe(200);
      expect(res.text).toContain('handleLogout');
      expect(res.text).toContain("localStorage.removeItem('dv_token')");
      expect(res.text).toContain("window.location.href = '/login.html'");
    });
  });
});
