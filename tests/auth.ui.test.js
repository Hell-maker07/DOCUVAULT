import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('Step 9: Auth UI & Static Pages Integration', () => {
  describe('Static Page Routing & Serving', () => {
    it('GET / serves index.html with redirect logic', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('DOCUVAULT - Digital Locker');
      expect(res.text).toContain('window.location.replace');
    });

    it('GET /login serves login.html with status 200', async () => {
      const res = await request(app).get('/login');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('DOCUVAULT - Secure Login');
    });

    it('GET /login.html serves login.html with status 200', async () => {
      const res = await request(app).get('/login.html');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('DOCUVAULT - Secure Login');
    });

    it('GET /register serves register.html with status 200', async () => {
      const res = await request(app).get('/register');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('DOCUVAULT - Create Your Organisation');
    });

    it('GET /register.html serves register.html with status 200', async () => {
      const res = await request(app).get('/register.html');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('DOCUVAULT - Create Your Organisation');
    });

    it('GET /toast.js serves toast library with status 200', async () => {
      const res = await request(app).get('/toast.js');
      expect(res.status).toBe(200);
      expect(res.text).toContain('window.DocuVaultToast');
    });

    it('GET /dashboard serves dashboard.html with status 200', async () => {
      const res = await request(app).get('/dashboard');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('DOCUVAULT - Organisation Admin Dashboard');
    });

    it('GET /admin serves dashboard.html with status 200', async () => {
      const res = await request(app).get('/admin');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('DOCUVAULT - Organisation Admin Dashboard');
    });
  });

  describe('Security & Helmet CSP Headers', () => {
    it('sets Content-Security-Policy permitting Tailwind CDN and Google Fonts', async () => {
      const res = await request(app).get('/login');
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(csp).toContain('cdn.tailwindcss.com');
      expect(csp).toContain('fonts.googleapis.com');
      expect(csp).toContain('fonts.gstatic.com');
    });
  });

  describe('Login Page Specific Requirements (Requirement 1 & 2)', () => {
    it('has removed the duplicate upper Create Organisation / Register button from the header', async () => {
      const res = await request(app).get('/login');
      const html = res.text;

      // Extract <header> content
      const headerMatch = html.match(/<header[\s\S]*?<\/header>/i);
      expect(headerMatch).not.toBeNull();
      const headerHtml = headerMatch[0];

      // Header must NOT contain a Register or Create Organisation button/link
      expect(headerHtml).not.toMatch(/href=["'][^"']*register[^"']*["']/i);
      expect(headerHtml).not.toMatch(/>\s*Register\s*<\/a>/i);
      expect(headerHtml).not.toMatch(/Create Your Organisation/i);
    });

    it('retains only the single registration link below the login form', async () => {
      const res = await request(app).get('/login');
      const html = res.text;

      // Matches link pointing to register.html
      const registerLinks = html.match(/href=["']register\.html["']/g);
      expect(registerLinks).not.toBeNull();
      expect(registerLinks.length).toBe(1);

      expect(html).toContain('New to DocuVault?');
      expect(html).toContain('Register Your Organisation');
    });

    it('contains inline validation elements and connects to POST /api/v1/auth/login', async () => {
      const res = await request(app).get('/login');
      const html = res.text;

      expect(html).toContain('id="email-error"');
      expect(html).toContain('id="password-error"');
      expect(html).toContain('id="btn-spinner"');
      expect(html).toContain('/api/v1/auth/login');
      expect(html).toContain('DocuVaultToast');
      expect(html).toContain('handleFormSubmit');
    });
  });

  describe('Organisation Registration Page Specific Requirements', () => {
    it('contains all required registration fields and password matching validation', async () => {
      const res = await request(app).get('/register');
      const html = res.text;

      expect(html).toContain('id="orgName"');
      expect(html).toContain('id="orgType"');
      expect(html).toContain('id="initialDept"');
      expect(html).toContain('id="adminName"');
      expect(html).toContain('id="workEmail"');
      expect(html).toContain('id="password"');
      expect(html).toContain('id="confirmPassword"');

      // Validation feedback elements
      expect(html).toContain('id="matchFeedback"');
      expect(html).toContain('id="passwordRule"');
      expect(html).toContain('id="submitSpinner"');
      expect(html).toContain('/api/v1/orgs');
      expect(html).toContain('DocuVaultToast');
    });

    it('strictly maintains a single Sign In link below the submit button', async () => {
      const res = await request(app).get('/register');
      const html = res.text;

      // Extract header
      const headerMatch = html.match(/<header[\s\S]*?<\/header>/i);
      expect(headerMatch).not.toBeNull();
      const headerHtml = headerMatch[0];

      // Header must NOT contain sign in links
      expect(headerHtml).not.toMatch(/href=["'][^"']*login[^"']*["']/i);
      expect(headerHtml).not.toMatch(/>\s*Sign In\s*<\/a>/i);

      // Link below submit button must exist and point to login.html
      const signInLinks = html.match(/href=["']login\.html["']/g);
      expect(signInLinks).not.toBeNull();
      expect(signInLinks.length).toBe(1);
      expect(html).toContain('Already have an account?');
    });
  });

  describe('Organisation Admin Dashboard Specific Requirements', () => {
    it('contains exact visual palette, typography and responsive layout structure', async () => {
      const res = await request(app).get('/dashboard');
      const html = res.text;

      // Brand & palette tokens
      expect(html).toContain('#B59778'); // Soft Fawn
      expect(html).toContain('#1E2952'); // Space Indigo
      expect(html).toContain('#2E5090'); // Dusk Blue
      expect(html).toContain('Plus Jakarta Sans');
      expect(html).toContain('Inter');

      // Collapsible sidebar & mobile drawer elements
      expect(html).toContain('id="sidebar"');
      expect(html).toContain('id="mobile-backdrop"');
      expect(html).toContain('id="open-mobile-sidebar-btn"');

      // Sidebar navigation tabs
      expect(html).toContain('id="nav-btn-overview"');
      expect(html).toContain('id="nav-btn-departments"');
      expect(html).toContain('id="nav-btn-positions"');
      expect(html).toContain('id="nav-btn-users"');
      expect(html).toContain('id="nav-btn-settings"');

      // Admin Profile & Logout
      expect(html).toContain('handleLogout');
      expect(html).toContain('Sign Out');
    });

    it('implements Dashboard Overview with 3 summary cards and 3 quick actions', async () => {
      const res = await request(app).get('/dashboard');
      const html = res.text;

      expect(html).toContain('Welcome to your Organisation Dashboard');
      expect(html).toContain('Total Departments');
      expect(html).toContain('Total Positions');
      expect(html).toContain('Total Members');

      // Quick Actions
      expect(html).toContain('Quick Actions');
      expect(html).toContain('openCreateDeptModal');
      expect(html).toContain('openCreatePosModal');
      expect(html).toContain('openAddMemberModal');
    });

    it('implements Departments management with search and modal', async () => {
      const res = await request(app).get('/dashboard');
      const html = res.text;

      expect(html).toContain('id="tab-departments"');
      expect(html).toContain('id="dept-search-input"');
      expect(html).toContain('id="departments-table-body"');
      expect(html).toContain('id="modal-dept"');
      expect(html).toContain('id="dept-name-input"');
      expect(html).toContain('id="dept-code-input"');
    });

    it('implements Positions & Permissions with clearance levels and grouped permissions', async () => {
      const res = await request(app).get('/dashboard');
      const html = res.text;

      expect(html).toContain('id="tab-positions"');
      expect(html).toContain('id="pos-search-input"');
      expect(html).toContain('id="positions-grid"');
      expect(html).toContain('id="modal-pos"');
      expect(html).toContain('id="pos-clearance-select"');
      expect(html).toContain('id="pos-scope-select"');

      // Check grouped permissions
      expect(html).toContain('id="perm-VIEW"');
      expect(html).toContain('id="perm-UPLOAD"');
      expect(html).toContain('id="perm-EDIT"');
      expect(html).toContain('id="perm-SIGN"');
      expect(html).toContain('id="perm-SHARE"');
      expect(html).toContain('id="perm-AUDIT"');
      expect(html).toContain('id="perm-MANAGE_ORG"');
    });

    it('implements Organisation Members section with search, filter, and Add Member modal', async () => {
      const res = await request(app).get('/dashboard');
      const html = res.text;

      expect(html).toContain('id="tab-users"');
      expect(html).toContain('Organisation Members');
      expect(html).toContain('id="user-search-input"');
      expect(html).toContain('id="user-dept-filter"');
      expect(html).toContain('id="members-table-body"');
      expect(html).toContain('id="modal-member"');
      expect(html).toContain('id="member-name-input"');
      expect(html).toContain('id="member-email-input"');
      expect(html).toContain('id="member-dept-select"');
      expect(html).toContain('id="member-pos-select"');
      expect(html).toContain('id="member-password-input"');
    });

    it('implements Member Permissions Editing and Deletion controls in Organisation Members section', async () => {
      const res = await request(app).get('/dashboard');
      const html = res.text;

      // Edit Member & Permissions Modal
      expect(html).toContain('id="modal-edit-member"');
      expect(html).toContain('id="form-edit-member"');
      expect(html).toContain('id="edit-member-name-input"');
      expect(html).toContain('id="edit-member-email-input"');
      expect(html).toContain('id="edit-member-dept-select"');
      expect(html).toContain('id="edit-member-pos-select"');

      // Granular Permission Checkboxes for Members
      expect(html).toContain('id="edit-perm-VIEW"');
      expect(html).toContain('id="edit-perm-UPLOAD"');
      expect(html).toContain('id="edit-perm-EDIT"');
      expect(html).toContain('id="edit-perm-SIGN"');
      expect(html).toContain('id="edit-perm-SHARE"');
      expect(html).toContain('id="edit-perm-AUDIT"');
      expect(html).toContain('id="edit-perm-MANAGE_ORG"');

      // Delete Member Confirmation Modal
      expect(html).toContain('id="modal-delete-member"');
      expect(html).toContain('id="confirm-delete-member-btn"');

      // JavaScript Handler Functions
      expect(html).toContain('openEditMemberModal');
      expect(html).toContain('handleSaveEditMember');
      expect(html).toContain('openDeleteMemberModal');
      expect(html).toContain('confirmDeleteMember');
    });

    it('respects design boundaries: does not include document vault or audit log viewer screens', async () => {
      const res = await request(app).get('/dashboard');
      const html = res.text;

      // Must not contain document vault UI
      expect(html).not.toContain('id="document-upload-dropzone"');
      expect(html).not.toContain('id="vault-document-grid"');
      expect(html).not.toContain('id="audit-log-viewer"');
    });
  });
});
