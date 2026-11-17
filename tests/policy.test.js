import { execFileSync } from 'node:child_process';
import request from 'supertest';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { closePool } from '../src/config/db.js';
import { config } from '../src/config/env.js';
import {
  decide,
  decideWorkspace,
  loadUser,
  loadDocument,
  buildAccessFilter,
} from '../src/policy/decide.js';
import {
  authorizeDocument,
  authorizeWorkspace,
  requirePermission,
} from '../src/middlewares/authorize.js';
import { authenticate } from '../src/middlewares/auth.js';
import { notFound, errorHandler } from '../src/middlewares/error.js';
import { ok } from '../src/utils/response.js';

let pool;
const q = (text, params) => pool.query(text, params);

const randomSuffix = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  execFileSync('node', ['scripts/db.js', 'reset'], {
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'pipe',
  });
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST });
}, 30_000);

afterAll(async () => {
  if (pool) await pool.end();
  await closePool();
});

describe('AP-03 Access Policy Engine & RBAC Middleware', () => {
  let orgAId, orgBId;
  let deptA1Id, deptA2Id, deptB1Id;
  let posCl2OwnDept, posCl3OwnDept, posCl3Org, posCl3Assigned, posCl3NoEdit, posAdmin;
  let userCl2OwnDept,
    userCl3OwnDept,
    userCl3Org,
    userCl3Assigned,
    userCl3NoEdit,
    userAdmin,
    userOrgB;
  let wsA1Open, wsA1Closed, wsA2Open;
  let docA1Cl3, docA1Cl2, docA2Cl3;

  const makeToken = (userId) => jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: '1h' });

  beforeAll(async () => {
    // 1. Create two organisations
    orgAId = (
      await q(
        `INSERT INTO organizations (name, org_type) VALUES ('Org Alpha ${randomSuffix()}', 'CORPORATE') RETURNING id`,
      )
    ).rows[0].id;
    orgBId = (
      await q(
        `INSERT INTO organizations (name, org_type) VALUES ('Org Beta ${randomSuffix()}', 'CORPORATE') RETURNING id`,
      )
    ).rows[0].id;

    // 2. Create departments in Org A and Org B
    deptA1Id = (
      await q(
        `INSERT INTO departments (org_id, code, name) VALUES ($1, 'FIN', 'Finance') RETURNING id`,
        [orgAId],
      )
    ).rows[0].id;
    deptA2Id = (
      await q(
        `INSERT INTO departments (org_id, code, name) VALUES ($1, 'HR', 'Human Resources') RETURNING id`,
        [orgAId],
      )
    ).rows[0].id;
    deptB1Id = (
      await q(
        `INSERT INTO departments (org_id, code, name) VALUES ($1, 'OPS', 'Operations') RETURNING id`,
        [orgBId],
      )
    ).rows[0].id;

    // 3. Create positions with various clearances and scopes
    const createPos = async (orgId, title, clearance, scope, permCodes) => {
      const posId = (
        await q(
          `INSERT INTO positions (org_id, title, clearance_level, dept_scope) VALUES ($1, $2, $3, $4) RETURNING id`,
          [orgId, `${title} ${randomSuffix()}`, clearance, scope],
        )
      ).rows[0].id;
      if (permCodes.length > 0) {
        await q(
          `INSERT INTO position_permissions (position_id, permission_id)
           SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`,
          [posId, permCodes],
        );
      }
      return posId;
    };

    const allPerms = ['VIEW', 'UPLOAD', 'EDIT', 'SIGN', 'SHARE', 'AUDIT', 'MANAGE_ORG'];
    const standardPerms = ['VIEW', 'UPLOAD', 'EDIT', 'SIGN', 'SHARE'];
    const viewOnlyPerms = ['VIEW'];

    posCl2OwnDept = await createPos(orgAId, 'Cl2 Own Dept', 2, 'OWN_DEPT', standardPerms);
    posCl3OwnDept = await createPos(orgAId, 'Cl3 Own Dept', 3, 'OWN_DEPT', standardPerms);
    posCl3Org = await createPos(orgAId, 'Cl3 Org Scope', 3, 'ORG', standardPerms);
    posCl3Assigned = await createPos(orgAId, 'Cl3 Assigned Scope', 3, 'ASSIGNED', standardPerms);
    posCl3NoEdit = await createPos(orgAId, 'Cl3 No Edit', 3, 'OWN_DEPT', viewOnlyPerms);
    posAdmin = await createPos(orgAId, 'Org Admin', 4, 'ORG', allPerms);
    const posOrgB = await createPos(orgBId, 'Org B Officer', 4, 'ORG', allPerms);

    // 4. Create users for these positions
    const createUser = async (deptId, posId, emailPrefix) => {
      return (
        await q(
          `INSERT INTO users (department_id, position_id, email, full_name, password_hash, public_key, private_key_enc, is_active)
           VALUES ($1, $2, $3, 'Test User', 'hash', 'pub', 'enc', true) RETURNING id`,
          [deptId, posId, `${emailPrefix}.${randomSuffix()}@policy.test`],
        )
      ).rows[0].id;
    };

    userCl2OwnDept = await createUser(deptA1Id, posCl2OwnDept, 'cl2.own');
    userCl3OwnDept = await createUser(deptA1Id, posCl3OwnDept, 'cl3.own');
    userCl3Org = await createUser(deptA1Id, posCl3Org, 'cl3.org');
    userCl3Assigned = await createUser(deptA1Id, posCl3Assigned, 'cl3.assigned');
    userCl3NoEdit = await createUser(deptA1Id, posCl3NoEdit, 'cl3.noedit');
    userAdmin = await createUser(deptA1Id, posAdmin, 'admin');
    userOrgB = await createUser(deptB1Id, posOrgB, 'orgb.user');

    // 5. Create workspaces in Org A
    wsA1Open = (
      await q(
        `INSERT INTO workspaces (department_id, name, status, created_by) VALUES ($1, 'Workspace A1 Open', 'OPEN', $2) RETURNING id`,
        [deptA1Id, userAdmin],
      )
    ).rows[0].id;

    wsA1Closed = (
      await q(
        `INSERT INTO workspaces (department_id, name, status, created_by) VALUES ($1, 'Workspace A1 Closed', 'CLOSED', $2) RETURNING id`,
        [deptA1Id, userAdmin],
      )
    ).rows[0].id;

    wsA2Open = (
      await q(
        `INSERT INTO workspaces (department_id, name, status, created_by) VALUES ($1, 'Workspace A2 Open', 'OPEN', $2) RETURNING id`,
        [deptA2Id, userAdmin],
      )
    ).rows[0].id;

    // 6. Create document type
    const typeId = (
      await q(`INSERT INTO document_types (org_id, name) VALUES ($1, 'Report') RETURNING id`, [
        orgAId,
      ])
    ).rows[0].id;

    // 7. Create test documents
    // docA1Cl3: in Workspace A1 (Dept A1), classification 3
    docA1Cl3 = (
      await q(
        `INSERT INTO documents (workspace_id, type_id, classification, title, created_by)
         VALUES ($1, $2, 3, 'Confidential Financials', $3) RETURNING id`,
        [wsA1Open, typeId, userAdmin],
      )
    ).rows[0].id;

    // docA1Cl2: in Workspace A1 (Dept A1), classification 2
    docA1Cl2 = (
      await q(
        `INSERT INTO documents (workspace_id, type_id, classification, title, created_by)
         VALUES ($1, $2, 2, 'Internal Memo', $3) RETURNING id`,
        [wsA1Open, typeId, userAdmin],
      )
    ).rows[0].id;

    // docA2Cl3: in Workspace A2 (Dept A2 - HR), classification 3
    docA2Cl3 = (
      await q(
        `INSERT INTO documents (workspace_id, type_id, classification, title, created_by)
         VALUES ($1, $2, 3, 'Confidential Personnel File', $3) RETURNING id`,
        [wsA2Open, typeId, userAdmin],
      )
    ).rows[0].id;
  }, 30_000);

  describe('Core Policy Engine: decide()', () => {
    it('loads document context with workspace and membership details', async () => {
      const doc = await loadDocument(pool, docA1Cl3, userCl3OwnDept);
      expect(doc.id).toBe(docA1Cl3);
      expect(doc.classification).toBe(3);
      expect(doc.workspaceStatus).toBe('OPEN');
    });
    it('Clearance 2 user opening a classification 3 document returns 404 with audit=true (AP-03)', async () => {
      const decision = await decide(pool, userCl2OwnDept, docA1Cl3, 'VIEW');
      expect(decision.ok).toBe(false);
      expect(decision.status).toBe(404);
      expect(decision.code).toBe('NOT_FOUND');
      expect(decision.audit).toBe(true);
      expect(decision.details?.reason).toBe('INSUFFICIENT_CLEARANCE');
    });

    it('Clearance 2 user opening a classification 2 document in own department succeeds (200 OK)', async () => {
      const decision = await decide(pool, userCl2OwnDept, docA1Cl2, 'VIEW');
      expect(decision.ok).toBe(true);
      expect(decision.document.id).toBe(docA1Cl2);
      expect(decision.user.id).toBe(userCl2OwnDept);
    });

    it('OWN_DEPT user opening a document of another department returns 404 (AP-03)', async () => {
      // userCl3OwnDept is in Dept A1 (Finance); docA2Cl3 is in Dept A2 (HR)
      const decision = await decide(pool, userCl3OwnDept, docA2Cl3, 'VIEW');
      expect(decision.ok).toBe(false);
      expect(decision.status).toBe(404);
      expect(decision.code).toBe('NOT_FOUND');
      expect(decision.audit).toBe(true);
      expect(decision.details?.reason).toBe('OUT_OF_SCOPE');
    });

    it('ORG-scope user opening a document of another department in same organisation succeeds (AP-03)', async () => {
      // userCl3Org is in Dept A1, but has dept_scope = ORG and clearance 3
      const decision = await decide(pool, userCl3Org, docA2Cl3, 'VIEW');
      expect(decision.ok).toBe(true);
      expect(decision.document.id).toBe(docA2Cl3);
    });

    it('User of another organisation requesting the document returns 404 without leaking info (AP-03)', async () => {
      // userOrgB belongs to Org B; docA1Cl3 belongs to Org A
      const decision = await decide(pool, userOrgB, docA1Cl3, 'VIEW');
      expect(decision.ok).toBe(false);
      expect(decision.status).toBe(404);
      expect(decision.code).toBe('NOT_FOUND');
      // No audit in Org A because user is from a completely foreign organisation
      expect(decision.audit).toBe(false);
    });

    it('Position without EDIT permission attempting to EDIT returns 403 FORBIDDEN (AP-03)', async () => {
      // userCl3NoEdit has clearance 3 and is in Dept A1, but lacks EDIT permission
      const decision = await decide(pool, userCl3NoEdit, docA1Cl3, 'EDIT');
      expect(decision.ok).toBe(false);
      expect(decision.status).toBe(403);
      expect(decision.code).toBe('FORBIDDEN');
      expect(decision.audit).toBe(true);
      expect(decision.details?.reason).toBe('MISSING_PERMISSION');
      expect(decision.details?.requiredPermission).toBe('EDIT');
    });

    it('Unexpired access grant permits VIEW access to a user outside department scope (AP-11 / BR-05)', async () => {
      // userCl3OwnDept is in Dept A1; docA2Cl3 is in Dept A2 (HR)
      // Without grant, it is denied:
      expect((await decide(pool, userCl3OwnDept, docA2Cl3, 'VIEW')).ok).toBe(false);

      // Grant temporary access until tomorrow
      const tomorrow = new Date(Date.now() + 86400000);
      const grantId = (
        await q(
          `INSERT INTO access_grants (document_id, user_id, granted_by, expires_at)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [docA2Cl3, userCl3OwnDept, userAdmin, tomorrow],
        )
      ).rows[0].id;

      // With active grant, VIEW is allowed:
      const decision = await decide(pool, userCl3OwnDept, docA2Cl3, 'VIEW');
      expect(decision.ok).toBe(true);

      // But a grant gives VIEW access only: EDIT is still rejected
      const editDecision = await decide(pool, userCl3OwnDept, docA2Cl3, 'EDIT');
      expect(editDecision.ok).toBe(false);
      expect(editDecision.status).toBe(404);

      // Clean up grant for subsequent tests
      await q(`DELETE FROM access_grants WHERE id = $1`, [grantId]);
    });

    it('A grant NEVER overrides clearance: clearance < classification remains denied (BR-04, BR-13)', async () => {
      // userCl2OwnDept has clearance 2; docA1Cl3 has classification 3
      const tomorrow = new Date(Date.now() + 86400000);
      const grantId = (
        await q(
          `INSERT INTO access_grants (document_id, user_id, granted_by, expires_at)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [docA1Cl3, userCl2OwnDept, userAdmin, tomorrow],
        )
      ).rows[0].id;

      const decision = await decide(pool, userCl2OwnDept, docA1Cl3, 'VIEW');
      expect(decision.ok).toBe(false);
      expect(decision.status).toBe(404);
      expect(decision.details?.reason).toBe('INSUFFICIENT_CLEARANCE');

      await q(`DELETE FROM access_grants WHERE id = $1`, [grantId]);
    });

    it('Workspace membership allows ASSIGNED-scope user to access documents in joined workspace', async () => {
      // userCl3Assigned has dept_scope = 'ASSIGNED'. Before adding to members:
      expect((await decide(pool, userCl3Assigned, docA1Cl3, 'VIEW')).ok).toBe(false);

      // Add user to workspace members
      await q(`INSERT INTO workspace_members (workspace_id, user_id) VALUES ($1, $2)`, [
        wsA1Open,
        userCl3Assigned,
      ]);

      // Now user can view documents in this workspace
      const decision = await decide(pool, userCl3Assigned, docA1Cl3, 'VIEW');
      expect(decision.ok).toBe(true);

      // But still cannot access documents in a different workspace (wsA2Open)
      expect((await decide(pool, userCl3Assigned, docA2Cl3, 'VIEW')).ok).toBe(false);
    });

    it('Rejects write actions (EDIT) in a CLOSED workspace with 409 WORKSPACE_CLOSED (BR-14)', async () => {
      const typeId = (await q(`SELECT id FROM document_types WHERE org_id = $1 LIMIT 1`, [orgAId]))
        .rows[0].id;
      const docInClosed = (
        await q(
          `INSERT INTO documents (workspace_id, type_id, classification, title, created_by)
           VALUES ($1, $2, 2, 'Closed Doc', $3) RETURNING id`,
          [wsA1Closed, typeId, userAdmin],
        )
      ).rows[0].id;

      // VIEW is allowed in closed workspace
      const viewDec = await decide(pool, userCl3OwnDept, docInClosed, 'VIEW');
      expect(viewDec.ok).toBe(true);

      // EDIT is rejected
      const editDec = await decide(pool, userCl3OwnDept, docInClosed, 'EDIT');
      expect(editDec.ok).toBe(false);
      expect(editDec.status).toBe(409);
      expect(editDec.code).toBe('WORKSPACE_CLOSED');
    });
  });

  describe('Workspace Access: decideWorkspace()', () => {
    it('rejects UPLOAD into a CLOSED workspace with 409 WORKSPACE_CLOSED (AP-04, BR-14)', async () => {
      const decision = await decideWorkspace(pool, userCl3OwnDept, wsA1Closed, 'UPLOAD');
      expect(decision.ok).toBe(false);
      expect(decision.status).toBe(409);
      expect(decision.code).toBe('WORKSPACE_CLOSED');
    });

    it('rejects upload when target classification exceeds user clearance (BR-04, AP-05)', async () => {
      // userCl2OwnDept has clearance 2, attempts to upload at classification 3
      const decision = await decideWorkspace(pool, userCl2OwnDept, wsA1Open, 'UPLOAD', {
        classification: 3,
      });
      expect(decision.ok).toBe(false);
      expect(decision.status).toBe(403);
      expect(decision.details?.reason).toBe('CLASSIFICATION_EXCEEDS_CLEARANCE');
    });
  });

  describe('Express Middleware Integration: authorizeDocument & requirePermission', () => {
    let testApp;

    beforeAll(() => {
      testApp = express();
      testApp.use(express.json());

      // Mock route using authorizeDocument('VIEW')
      testApp.get('/test/docs/:id', authenticate, authorizeDocument('VIEW'), (req, res) => {
        ok(res, { document: req.document, user: req.policyUser }, 'Document accessed');
      });

      // Mock route using authorizeDocument('EDIT')
      testApp.post(
        '/test/docs/:id/versions',
        authenticate,
        authorizeDocument('EDIT'),
        (req, res) => {
          ok(res, { document: req.document }, 'Version created');
        },
      );

      // Mock workspace upload route using authorizeWorkspace('UPLOAD')
      testApp.post(
        '/test/workspaces/:id/documents',
        authenticate,
        authorizeWorkspace('UPLOAD'),
        (req, res) => {
          ok(res, { workspace: req.workspace }, 'Upload authorized');
        },
      );

      // Mock admin route using requirePermission('MANAGE_ORG')
      testApp.post(
        '/test/admin/departments',
        authenticate,
        requirePermission('MANAGE_ORG'),
        (req, res) => {
          ok(res, { created: true }, 'Department created');
        },
      );

      testApp.use(notFound);
      testApp.use(errorHandler);
    });

    it('GET /test/docs/:id: returns 404 and writes ACCESS_DENIED to audit_logs when clearance is insufficient (AP-03)', async () => {
      const token = makeToken(userCl2OwnDept);

      const beforeAuditCount = (
        await q(
          `SELECT count(*)::int AS n FROM audit_logs WHERE org_id = $1 AND action = 'ACCESS_DENIED'`,
          [orgAId],
        )
      ).rows[0].n;

      const res = await request(testApp)
        .get(`/test/docs/${docA1Cl3}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');

      // Verify audit row was persisted in the database
      const { rows } = await q(
        `SELECT action, outcome, entity_type, entity_id, details
         FROM audit_logs
         WHERE org_id = $1 AND action = 'ACCESS_DENIED'
         ORDER BY id DESC LIMIT 1`,
        [orgAId],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe('ACCESS_DENIED');
      expect(rows[0].outcome).toBe('DENIED');
      expect(rows[0].entity_type).toBe('DOCUMENT');
      expect(rows[0].entity_id).toBe(docA1Cl3);
      expect(rows[0].details.reason).toBe('INSUFFICIENT_CLEARANCE');

      const afterAuditCount = (
        await q(
          `SELECT count(*)::int AS n FROM audit_logs WHERE org_id = $1 AND action = 'ACCESS_DENIED'`,
          [orgAId],
        )
      ).rows[0].n;
      expect(afterAuditCount).toBe(beforeAuditCount + 1);
    });

    it('GET /test/docs/:id: returns 200 with document data when allowed', async () => {
      const token = makeToken(userCl3OwnDept);
      const res = await request(testApp)
        .get(`/test/docs/${docA1Cl3}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.document.id).toBe(docA1Cl3);
    });

    it('POST /test/docs/:id/versions: returns 403 and writes ACCESS_DENIED when position lacks EDIT permission', async () => {
      const token = makeToken(userCl3NoEdit);
      const res = await request(testApp)
        .post(`/test/docs/${docA1Cl3}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const { rows } = await q(
        `SELECT details FROM audit_logs
         WHERE org_id = $1 AND action = 'ACCESS_DENIED' AND actor_id = $2
         ORDER BY id DESC LIMIT 1`,
        [orgAId, userCl3NoEdit],
      );
      expect(rows[0].details.reason).toBe('MISSING_PERMISSION');
      expect(rows[0].details.requiredPermission).toBe('EDIT');
    });

    it('authorizeWorkspace: allows UPLOAD into OPEN workspace for authorized user', async () => {
      const token = makeToken(userCl3OwnDept);
      const res = await request(testApp)
        .post(`/test/workspaces/${wsA1Open}/documents`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.workspace.id).toBe(wsA1Open);
    });

    it('requirePermission: allows admin with MANAGE_ORG (200) and rejects non-admin with 403', async () => {
      const adminToken = makeToken(userAdmin);
      const memberToken = makeToken(userCl3OwnDept);

      // Admin with MANAGE_ORG succeeds:
      const adminRes = await request(testApp)
        .post('/test/admin/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(adminRes.status).toBe(200);

      // Member without MANAGE_ORG gets 403:
      const memberRes = await request(testApp)
        .post('/test/admin/departments')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({});
      expect(memberRes.status).toBe(403);
      expect(memberRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('SQL Search Filter Generator (AP-09 Foundation)', () => {
    it('generates parameterised SQL containing org, clearance, scope, membership and grant conditions', async () => {
      const u = await loadUser(pool, userCl3OwnDept);
      const filter = buildAccessFilter(u, 1);

      expect(filter.sql).toContain('dp.org_id = $1');
      expect(filter.sql).toContain('d.classification <= $2');
      expect(filter.sql).toContain('workspace_members');
      expect(filter.sql).toContain('access_grants');
      expect(filter.params).toEqual([u.orgId, u.clearance, u.deptScope, u.departmentId, u.id]);
    });
  });
});
