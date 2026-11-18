import { execFileSync } from 'node:child_process';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/config/db.js';
import { config } from '../src/config/env.js';
import { storage } from '../src/storage/index.js';
import { sha256 } from '../src/utils/hash.js';

let app;
let pool;
const q = (text, params) => pool.query(text, params);

const makeToken = (userId) => jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: '1h' });

beforeAll(async () => {
  execFileSync('node', ['scripts/db.js', 'reset'], {
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'pipe',
  });

  pool = getPool();
  app = createApp();
});

afterAll(async () => {
  await closePool();
});

describe('Step 8: Document Intake, Versioning & Verified Download (Sakshi)', () => {
  let orgAId;
  let orgBId;
  let deptA1Id;
  let deptA2Id;
  let deptBId;
  let docTypeAId;
  let docTypeBId;

  let userAdminAId;
  let userAdminAToken;
  let userCl4AId;
  let userCl4AToken;
  let userCl2AId;
  let userCl2AToken;
  let userNoEditAId;
  let userNoEditAToken;
  let userAdminBId;
  let userAdminBToken;

  let workspaceA1OpenId;
  let workspaceA2ClosedId;
  let workspaceA3ArchivedId;

  beforeAll(async () => {
    // 1. Create Organisation A (Forensic Investigation Bureau)
    const orgARes = await q(
      `INSERT INTO organizations (name, org_type) VALUES ('Forensic Investigation Bureau', 'POLICE') RETURNING id`,
    );
    orgAId = orgARes.rows[0].id;

    // Departments in Org A
    const deptA1Res = await q(
      `INSERT INTO departments (org_id, code, name) VALUES ($1, 'CYBER', 'Cyber Forensics') RETURNING id`,
      [orgAId],
    );
    deptA1Id = deptA1Res.rows[0].id;

    const deptA2Res = await q(
      `INSERT INTO departments (org_id, code, name) VALUES ($1, 'BALLISTICS', 'Ballistics') RETURNING id`,
      [orgAId],
    );
    deptA2Id = deptA2Res.rows[0].id;

    // Document types for Org A
    const dtARes = await q(
      `INSERT INTO document_types (org_id, name) VALUES ($1, 'Investigation Report') RETURNING id`,
      [orgAId],
    );
    docTypeAId = dtARes.rows[0].id;

    // Permissions
    const perms = (await q(`SELECT id, code FROM permissions`)).rows;
    const findPermId = (code) => perms.find((p) => p.code === code)?.id;

    // Positions for Org A:
    // Admin: Clearance 4, ORG scope, all permissions
    const posAdminARes = await q(
      `INSERT INTO positions (org_id, title, clearance_level, dept_scope)
       VALUES ($1, 'Bureau Director', 4, 'ORG') RETURNING id`,
      [orgAId],
    );
    const posAdminAId = posAdminARes.rows[0].id;
    for (const p of perms) {
      await q(`INSERT INTO position_permissions (position_id, permission_id) VALUES ($1, $2)`, [
        posAdminAId,
        p.id,
      ]);
    }

    // Senior Officer: Clearance 4, OWN_DEPT, VIEW, UPLOAD, EDIT, SIGN, AUDIT
    const posSeniorARes = await q(
      `INSERT INTO positions (org_id, title, clearance_level, dept_scope)
       VALUES ($1, 'Senior Investigator', 4, 'OWN_DEPT') RETURNING id`,
      [orgAId],
    );
    const posSeniorAId = posSeniorARes.rows[0].id;
    for (const code of ['VIEW', 'UPLOAD', 'EDIT', 'SIGN', 'AUDIT']) {
      await q(`INSERT INTO position_permissions (position_id, permission_id) VALUES ($1, $2)`, [
        posSeniorAId,
        findPermId(code),
      ]);
    }

    // Junior Analyst: Clearance 2, OWN_DEPT, VIEW, UPLOAD, EDIT
    const posJuniorARes = await q(
      `INSERT INTO positions (org_id, title, clearance_level, dept_scope)
       VALUES ($1, 'Junior Analyst', 2, 'OWN_DEPT') RETURNING id`,
      [orgAId],
    );
    const posJuniorAId = posJuniorARes.rows[0].id;
    for (const code of ['VIEW', 'UPLOAD', 'EDIT']) {
      await q(`INSERT INTO position_permissions (position_id, permission_id) VALUES ($1, $2)`, [
        posJuniorAId,
        findPermId(code),
      ]);
    }

    // Read Only Member: Clearance 4, OWN_DEPT, VIEW only (NO EDIT, NO UPLOAD)
    const posReadOnlyARes = await q(
      `INSERT INTO positions (org_id, title, clearance_level, dept_scope)
       VALUES ($1, 'Archive Viewer', 4, 'OWN_DEPT') RETURNING id`,
      [orgAId],
    );
    const posReadOnlyAId = posReadOnlyARes.rows[0].id;
    await q(`INSERT INTO position_permissions (position_id, permission_id) VALUES ($1, $2)`, [
      posReadOnlyAId,
      findPermId('VIEW'),
    ]);

    // Users in Org A
    const createUser = async (deptId, posId, email, name) => {
      const { rows } = await q(
        `INSERT INTO users (department_id, position_id, email, password_hash, public_key, private_key_enc, full_name)
         VALUES ($1, $2, $3, 'hashed_pass', 'pub_key', 'enc_key', $4) RETURNING id`,
        [deptId, posId, email, name],
      );
      return rows[0].id;
    };

    userAdminAId = await createUser(deptA1Id, posAdminAId, 'director@fib.gov', 'Diana Director');
    userAdminAToken = makeToken(userAdminAId);

    userCl4AId = await createUser(deptA1Id, posSeniorAId, 'senior@fib.gov', 'Sam Senior');
    userCl4AToken = makeToken(userCl4AId);

    userCl2AId = await createUser(deptA1Id, posJuniorAId, 'junior@fib.gov', 'John Junior');
    userCl2AToken = makeToken(userCl2AId);

    userNoEditAId = await createUser(deptA1Id, posReadOnlyAId, 'viewer@fib.gov', 'Victor Viewer');
    userNoEditAToken = makeToken(userNoEditAId);

    // 2. Create Organisation B for tenant boundary isolation testing
    const orgBRes = await q(
      `INSERT INTO organizations (name, org_type) VALUES ('Metro Judiciary Vault', 'COURT') RETURNING id`,
    );
    orgBId = orgBRes.rows[0].id;

    const deptBRes = await q(
      `INSERT INTO departments (org_id, code, name) VALUES ($1, 'CLERK', 'Court Clerks') RETURNING id`,
      [orgBId],
    );
    deptBId = deptBRes.rows[0].id;

    const dtBRes = await q(
      `INSERT INTO document_types (org_id, name) VALUES ($1, 'Court Judgment') RETURNING id`,
      [orgBId],
    );
    docTypeBId = dtBRes.rows[0].id;

    const posAdminBRes = await q(
      `INSERT INTO positions (org_id, title, clearance_level, dept_scope)
       VALUES ($1, 'Chief Registrar', 4, 'ORG') RETURNING id`,
      [orgBId],
    );
    const posAdminBId = posAdminBRes.rows[0].id;
    for (const p of perms) {
      await q(`INSERT INTO position_permissions (position_id, permission_id) VALUES ($1, $2)`, [
        posAdminBId,
        p.id,
      ]);
    }

    userAdminBId = await createUser(
      deptBId,
      posAdminBId,
      'registrar@court.gov',
      'Rachel Registrar',
    );
    userAdminBToken = makeToken(userAdminBId);

    // 3. Create initial workspaces in Org A
    const ws1 = await q(
      `INSERT INTO workspaces (department_id, name, description, status, created_by)
       VALUES ($1, 'Case 101 - Project Alpha', 'Active investigation', 'OPEN', $2) RETURNING id`,
      [deptA1Id, userCl4AId],
    );
    workspaceA1OpenId = ws1.rows[0].id;
    await q(`INSERT INTO workspace_members (workspace_id, user_id) VALUES ($1, $2)`, [
      workspaceA1OpenId,
      userCl4AId,
    ]);

    const ws2 = await q(
      `INSERT INTO workspaces (department_id, name, description, status, created_by)
       VALUES ($1, 'Case 102 - Project Beta', 'Closed case', 'CLOSED', $2) RETURNING id`,
      [deptA1Id, userCl4AId],
    );
    workspaceA2ClosedId = ws2.rows[0].id;

    const ws3 = await q(
      `INSERT INTO workspaces (department_id, name, description, status, created_by)
       VALUES ($1, 'Case 103 - Cold File', 'Archived historical records', 'ARCHIVED', $2) RETURNING id`,
      [deptA1Id, userCl4AId],
    );
    workspaceA3ArchivedId = ws3.rows[0].id;

    await q(
      `INSERT INTO workspaces (department_id, name, description, status, created_by)
       VALUES ($1, 'Ballistics Forensics Unit', 'Ballistics lab analysis', 'OPEN', $2)`,
      [deptA2Id, userAdminAId],
    );
  });

  describe('AP-04 Workspace Lifecycle & Membership (Sakshi)', () => {
    it('POST /api/v1/workspaces: creates a workspace in a department and adds creator as member', async () => {
      const res = await request(app)
        .post('/api/v1/workspaces')
        .set('Authorization', `Bearer ${userCl4AToken}`)
        .send({
          name: 'Case 200 - Operation CyberShield',
          departmentId: deptA1Id,
          description: 'Special taskforce workspace',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Case 200 - Operation CyberShield');
      expect(res.body.data.status).toBe('OPEN');

      // Check creator is in workspace_members
      const members = await q(`SELECT user_id FROM workspace_members WHERE workspace_id = $1`, [
        res.body.data.id,
      ]);
      expect(members.rows.some((m) => m.user_id === userCl4AId)).toBe(true);
    });

    it('GET /api/v1/workspaces: lists only reachable workspaces within caller organisation and scope', async () => {
      const res = await request(app)
        .get('/api/v1/workspaces')
        .set('Authorization', `Bearer ${userCl4AToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      // Verify no Organisation B workspaces leak
      for (const ws of res.body.data) {
        expect(ws.department_id).not.toBe(deptBId);
      }
    });

    it('POST /api/v1/workspaces/:id/members: assigns a new user to a workspace', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceA1OpenId}/members`)
        .set('Authorization', `Bearer ${userCl4AToken}`)
        .send({ userId: userCl2AId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const isMember = await q(
        `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceA1OpenId, userCl2AId],
      );
      expect(isMember.rows.length).toBe(1);
    });

    it('PATCH /api/v1/workspaces/:id/status: updates status to CLOSED', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${workspaceA1OpenId}/status`)
        .set('Authorization', `Bearer ${userCl4AToken}`)
        .send({ status: 'CLOSED' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CLOSED');

      // Reopen for subsequent tests
      await request(app)
        .patch(`/api/v1/workspaces/${workspaceA1OpenId}/status`)
        .set('Authorization', `Bearer ${userCl4AToken}`)
        .send({ status: 'OPEN' });
    });

    it('PATCH /api/v1/workspaces/:id/status: rejects reopening an ARCHIVED workspace with 409 CONFLICT (BR-14)', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${workspaceA3ArchivedId}/status`)
        .set('Authorization', `Bearer ${userAdminAToken}`)
        .send({ status: 'OPEN' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });

  describe('AP-05 Initial Document Upload with SHA-256 Hashing (Sakshi)', () => {
    let uploadedDocId;
    let expectedHash;
    const sampleContent = Buffer.from(
      'EVIDENCE LOG 2026: Suspect digital device forensic image data.',
    );

    it('POST /api/v1/workspaces/:id/documents: uploads a file, stores SHA-256, and logs UPLOAD audit entry', async () => {
      expectedHash = sha256(sampleContent);

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceA1OpenId}/documents`)
        .set('Authorization', `Bearer ${userCl4AToken}`)
        .field('title', 'Forensic Phone Image Extraction')
        .field('typeId', docTypeAId)
        .field('classification', '3')
        .field('description', 'Initial extraction report from device 001')
        .attach('file', sampleContent, 'device_extraction.pdf');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.versionNo).toBe(1);
      expect(res.body.data.sha256).toBe(expectedHash);
      expect(res.body.data.storagePath).toContain('device_extraction.pdf');

      uploadedDocId = res.body.data.documentId;

      // 1. Verify document version row in DB
      const versionRow = (
        await q(
          `SELECT v.version_no, v.sha256, v.file_name, v.storage_path, d.classification
           FROM document_versions v
           JOIN documents d ON d.id = v.document_id
           WHERE v.document_id = $1 AND v.version_no = 1`,
          [uploadedDocId],
        )
      ).rows[0];

      expect(versionRow.version_no).toBe(1);
      expect(versionRow.sha256.trim()).toBe(expectedHash);
      expect(versionRow.file_name).toBe('device_extraction.pdf');
      expect(versionRow.classification).toBe(3);

      // 2. Verify file is physically present in storage
      const stored = await storage.get(versionRow.storage_path);
      expect(stored.buffer.toString()).toBe(sampleContent.toString());

      // 3. Verify audit log entry
      const auditRow = (
        await q(
          `SELECT action, outcome, entity_type, entity_id, details
           FROM audit_logs
           WHERE org_id = $1 AND entity_id = $2 AND action = 'UPLOAD'`,
          [orgAId, uploadedDocId],
        )
      ).rows[0];

      expect(auditRow).toBeDefined();
      expect(auditRow.action).toBe('UPLOAD');
      expect(auditRow.outcome).toBe('ALLOWED');
      expect(auditRow.details.sha256).toBe(expectedHash);
    });

    it('rejects upload when classification exceeds user clearance with 403 (BR-04)', async () => {
      // Junior Analyst holds Clearance 2; attempting to upload document with Classification 3
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceA1OpenId}/documents`)
        .set('Authorization', `Bearer ${userCl2AToken}`)
        .field('title', 'Confidential Intercepts')
        .field('typeId', docTypeAId)
        .field('classification', '3')
        .attach('file', Buffer.from('Top secret content'), 'intercepts.pdf');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects upload into a CLOSED workspace with 409 WORKSPACE_CLOSED (BR-14)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceA2ClosedId}/documents`)
        .set('Authorization', `Bearer ${userCl4AToken}`)
        .field('title', 'Late Evidence Filing')
        .field('typeId', docTypeAId)
        .field('classification', '2')
        .attach('file', Buffer.from('Late file'), 'late.pdf');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('WORKSPACE_CLOSED');
    });

    it('rejects upload of unsupported file MIME type with 415 UNSUPPORTED_TYPE', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceA1OpenId}/documents`)
        .set('Authorization', `Bearer ${userCl4AToken}`)
        .field('title', 'Dangerous Executable')
        .field('typeId', docTypeAId)
        .field('classification', '2')
        .attach('file', Buffer.from('#!/bin/sh\nrm -rf /'), 'danger.exe');

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_TYPE');
    });

    it('rejects upload when file is missing with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceA1OpenId}/documents`)
        .set('Authorization', `Bearer ${userCl4AToken}`)
        .field('title', 'Fileless Document')
        .field('typeId', docTypeAId)
        .field('classification', '2');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects upload with document type belonging to a different organisation with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceA1OpenId}/documents`)
        .set('Authorization', `Bearer ${userCl4AToken}`)
        .field('title', 'Foreign Document Type')
        .field('typeId', docTypeBId)
        .field('classification', '2')
        .attach('file', Buffer.from('Foreign type test'), 'foreign.pdf');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('AP-06 Document Versioning & Concurrency Serialization (Sakshi)', () => {
    let testDocId;

    beforeAll(async () => {
      // Create a dedicated document for version testing
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceA1OpenId}/documents`)
        .set('Authorization', `Bearer ${userCl4AToken}`)
        .field('title', 'Incident Report Draft')
        .field('typeId', docTypeAId)
        .field('classification', '2')
        .attach('file', Buffer.from('Version 1 initial contents'), 'incident_v1.txt');

      testDocId = res.body.data.documentId;
    });

    it('POST /api/v1/documents/:id/versions: uploads version 2 leaving version 1 untouched', async () => {
      const v2Content = Buffer.from('Version 2 revised findings');
      const v2Hash = sha256(v2Content);

      const res = await request(app)
        .post(`/api/v1/documents/${testDocId}/versions`)
        .set('Authorization', `Bearer ${userCl4AToken}`)
        .field('changeNote', 'Incorporated witness statement')
        .attach('file', v2Content, 'incident_v2.txt');

      expect(res.status).toBe(201);
      expect(res.body.data.versionNo).toBe(2);
      expect(res.body.data.sha256).toBe(v2Hash);

      // Verify DB contains both versions
      const { rows } = await q(
        `SELECT version_no, sha256, change_note FROM document_versions WHERE document_id = $1 ORDER BY version_no ASC`,
        [testDocId],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].version_no).toBe(1);
      expect(rows[1].version_no).toBe(2);
      expect(rows[1].change_note).toBe('Incorporated witness statement');
    });

    it('serializes 10 concurrent version uploads without gaps or duplicate version numbers (AP-06)', async () => {
      // Fire 10 concurrent version uploads simultaneously using Promise.all
      const requests = Array.from({ length: 10 }).map((_, idx) =>
        request(app)
          .post(`/api/v1/documents/${testDocId}/versions`)
          .set('Authorization', `Bearer ${userCl4AToken}`)
          .field('changeNote', `Concurrent edit #${idx}`)
          .attach(
            'file',
            Buffer.from(`Version content #${idx} - random ${Math.random()}`),
            `file_${idx}.txt`,
          ),
      );

      const responses = await Promise.all(requests);
      for (const res of responses) {
        expect(res.status).toBe(201);
      }

      // Check version sequence in database: must be continuous from 1 to 12
      const { rows } = await q(
        `SELECT version_no FROM document_versions WHERE document_id = $1 ORDER BY version_no ASC`,
        [testDocId],
      );
      expect(rows).toHaveLength(12); // 1 (initial) + 1 (v2) + 10 (concurrent)
      for (let i = 0; i < rows.length; i++) {
        expect(rows[i].version_no).toBe(i + 1);
      }
    });

    it('rejects version upload if user lacks EDIT permission with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${testDocId}/versions`)
        .set('Authorization', `Bearer ${userNoEditAToken}`)
        .attach('file', Buffer.from('Unauthorized edit'), 'unauth.txt');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('enforces immutability: rejects direct SQL UPDATE or DELETE on document_versions', async () => {
      await expect(
        q(
          `UPDATE document_versions SET file_name = 'tampered.txt' WHERE document_id = $1 AND version_no = 1`,
          [testDocId],
        ),
      ).rejects.toThrow(/document_versions is append-only/i);

      await expect(
        q(`DELETE FROM document_versions WHERE document_id = $1 AND version_no = 1`, [testDocId]),
      ).rejects.toThrow(/document_versions is append-only/i);
    });
  });

  describe('AP-07 Verified Download & Tamper Detection (Sakshi)', () => {
    let verifyDocId;
    let v1StoragePath;
    const v1Text = 'Authentic unmodified report bytes for integrity testing.';
    const v1Hash = sha256(v1Text);

    beforeAll(async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceA1OpenId}/documents`)
        .set('Authorization', `Bearer ${userCl4AToken}`)
        .field('title', 'Tamper Verification Target')
        .field('typeId', docTypeAId)
        .field('classification', '2')
        .attach('file', Buffer.from(v1Text), 'tamper_target.txt');

      verifyDocId = res.body.data.documentId;
      v1StoragePath = res.body.data.storagePath;
    });

    it('GET /api/v1/documents/:id/versions/:no/download: downloads untouched file with verified headers and logs DOWNLOAD', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${verifyDocId}/versions/1/download`)
        .set('Authorization', `Bearer ${userCl4AToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['x-docuvault-integrity']).toBe('VERIFIED');
      expect(res.headers['x-docuvault-sha256']).toBe(v1Hash);
      expect(res.headers['content-disposition']).toContain('tamper_target.txt');
      expect(res.text || res.body.toString()).toBe(v1Text);

      // Verify DOWNLOAD audit event
      const audit = (
        await q(
          `SELECT action, outcome FROM audit_logs
           WHERE org_id = $1 AND entity_id = $2 AND action = 'DOWNLOAD'
           ORDER BY seq DESC LIMIT 1`,
          [orgAId, verifyDocId],
        )
      ).rows[0];
      expect(audit.action).toBe('DOWNLOAD');
      expect(audit.outcome).toBe('ALLOWED');
    });

    it('detects tampered file on download: returns 409 INTEGRITY_FAILURE and logs VERIFY FAILED', async () => {
      // Simulate file corruption/tampering by overwriting the storage file directly
      const tamperedBytes = Buffer.from('TAMPERED BY ATTACKER');
      await storage.put(v1StoragePath, tamperedBytes, 'text/plain');

      const res = await request(app)
        .get(`/api/v1/documents/${verifyDocId}/versions/1/download`)
        .set('Authorization', `Bearer ${userCl4AToken}`);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTEGRITY_FAILURE');

      // Verify audit log captured the tampering attempt
      const audit = (
        await q(
          `SELECT action, outcome, details FROM audit_logs
           WHERE org_id = $1 AND entity_id = $2 AND action = 'VERIFY' AND outcome = 'FAILED'
           ORDER BY seq DESC LIMIT 1`,
          [orgAId, verifyDocId],
        )
      ).rows[0];

      expect(audit).toBeDefined();
      expect(audit.action).toBe('VERIFY');
      expect(audit.outcome).toBe('FAILED');
      expect(audit.details.status).toBe('TAMPERED');
      expect(audit.details.expected).toBe(v1Hash);

      // POST /documents/:id/verify reports the tampered version (AP-07 acceptance test)
      const tamperVerifyRes = await request(app)
        .post(`/api/v1/documents/${verifyDocId}/verify`)
        .set('Authorization', `Bearer ${userCl4AToken}`);

      expect(tamperVerifyRes.status).toBe(200);
      expect(tamperVerifyRes.body.success).toBe(true);
      expect(tamperVerifyRes.body.data.allVerified).toBe(false);
      expect(tamperVerifyRes.body.data.versions[0].status).toBe('TAMPERED');
      expect(tamperVerifyRes.body.data.versions[0].verified).toBe(false);

      // Restore original file
      await storage.put(v1StoragePath, Buffer.from(v1Text), 'text/plain');
    });

    it('POST /api/v1/documents/:id/verify: checks all versions of a document and reports verification status', async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${verifyDocId}/verify`)
        .set('Authorization', `Bearer ${userCl4AToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.allVerified).toBe(true);
      expect(res.body.data.versions[0].status).toBe('VERIFIED');
    });

    it('POST /api/v1/audit/verify-all: re-hashes every file in the organisation and reports clean status (AP-07)', async () => {
      const res = await request(app)
        .post('/api/v1/audit/verify-all')
        .set('Authorization', `Bearer ${userAdminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.allVerified).toBe(true);
      expect(res.body.data.tamperedCount).toBe(0);
      expect(res.body.data.totalChecked).toBeGreaterThanOrEqual(1);
    });
  });

  describe('AP-09 Access-Filtered Document Search (Sakshi)', () => {
    let searchableDocId;

    beforeAll(async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceA1OpenId}/documents`)
        .set('Authorization', `Bearer ${userAdminAToken}`)
        .field('title', 'Cyber Malware Signature Matrix')
        .field('typeId', docTypeAId)
        .field('classification', '3')
        .field('description', 'Comprehensive reverse engineered malware fingerprints')
        .attach('file', Buffer.from('Malware signature database'), 'malware.txt');

      searchableDocId = res.body.data.documentId;
    });

    it('GET /api/v1/documents: searches for a term and returns accessible documents', async () => {
      const res = await request(app)
        .get('/api/v1/documents?q=malware')
        .set('Authorization', `Bearer ${userAdminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.items.some((d) => d.id === searchableDocId)).toBe(true);
    });

    it('lower clearance user running the same search gets fewer results (classification 3 hidden from clearance 2)', async () => {
      // Junior analyst has clearance 2; document is classification 3
      const res = await request(app)
        .get('/api/v1/documents?q=malware')
        .set('Authorization', `Bearer ${userCl2AToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((d) => d.id === searchableDocId)).toBe(false);
    });

    it('GET /api/v1/documents/:id: returns document details, versions, and logs VIEW audit entry', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${searchableDocId}`)
        .set('Authorization', `Bearer ${userAdminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.document.id).toBe(searchableDocId);
      expect(res.body.data.versions.length).toBeGreaterThanOrEqual(1);

      // Verify audit log captured VIEW
      const audit = (
        await q(
          `SELECT action, outcome FROM audit_logs
           WHERE org_id = $1 AND entity_id = $2 AND action = 'VIEW'
           ORDER BY seq DESC LIMIT 1`,
          [orgAId, searchableDocId],
        )
      ).rows[0];
      expect(audit.action).toBe('VIEW');
      expect(audit.outcome).toBe('ALLOWED');
    });

    it('hides documents across organisation boundaries (cross-tenant isolation returns 404)', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${searchableDocId}`)
        .set('Authorization', `Bearer ${userAdminBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('DE-05 Analytics Endpoints for Documents & Workspaces', () => {
    it('GET /api/v1/documents/stats/dept-classification: returns document counts per department and classification (Q01)', async () => {
      const res = await request(app)
        .get('/api/v1/documents/stats/dept-classification')
        .set('Authorization', `Bearer ${userAdminAToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0]).toHaveProperty('department_id');
      expect(res.body.data[0]).toHaveProperty('classification');
      expect(res.body.data[0]).toHaveProperty('document_count');
    });

    it('GET /api/v1/documents/stats/multi-versions: returns documents with multiple versions (Q05)', async () => {
      const res = await request(app)
        .get('/api/v1/documents/stats/multi-versions?min=2')
        .set('Authorization', `Bearer ${userAdminAToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0]).toHaveProperty('version_count');
    });

    it('GET /api/v1/documents/stats/ranked-positions: ranks positions by documents opened (Q12)', async () => {
      const res = await request(app)
        .get('/api/v1/documents/stats/ranked-positions')
        .set('Authorization', `Bearer ${userAdminAToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0]).toHaveProperty('rank');
      expect(res.body.data[0]).toHaveProperty('opened_count');
    });
  });
});
