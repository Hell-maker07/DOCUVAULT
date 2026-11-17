import { execFileSync } from 'node:child_process';
import request from 'supertest';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { closePool } from '../src/config/db.js';
import { config } from '../src/config/env.js';
import { newKeyPair, wrap, verifyHash } from '../src/utils/keys.js';
import { sha256, buildStoragePath } from '../src/utils/hash.js';
import { put } from '../src/storage/index.js';

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

describe('Step 7: Ed25519 Digital Signatures & Verification (Saubhagya)', () => {
  let app;
  let orgAId, orgBId;
  let deptA1Id, deptB1Id;
  let posOfficerSign, posViewerNoSign, posOfficerB;
  let userSigner1, userSigner2, userViewerNoSign, userOrgB;
  let tokenSigner1, tokenSigner2, tokenViewerNoSign, tokenOrgB;
  let signer1Key, signer2Key;
  let wsA1Id;
  let docTypeId;
  let docA1Id, versionA1Id, versionA1No;
  let docA1Sha256, docA1StoragePath;
  let docUntouchedId, versionUntouchedId, versionUntouchedNo, untouchedSha256;

  const makeToken = (userId) => jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: '1h' });

  beforeAll(async () => {
    app = createApp();

    // 1. Create organisations
    orgAId = (
      await q(
        `INSERT INTO organizations (name, org_type) VALUES ('Org Sign A ${randomSuffix()}', 'CORPORATE') RETURNING id`,
      )
    ).rows[0].id;
    orgBId = (
      await q(
        `INSERT INTO organizations (name, org_type) VALUES ('Org Sign B ${randomSuffix()}', 'CORPORATE') RETURNING id`,
      )
    ).rows[0].id;

    // 2. Create departments
    deptA1Id = (
      await q(
        `INSERT INTO departments (org_id, code, name) VALUES ($1, 'SEC', 'Security Dept') RETURNING id`,
        [orgAId],
      )
    ).rows[0].id;
    deptB1Id = (
      await q(
        `INSERT INTO departments (org_id, code, name) VALUES ($1, 'OPS', 'Operations B') RETURNING id`,
        [orgBId],
      )
    ).rows[0].id;

    // 3. Create positions
    // Position with SIGN & VIEW permissions
    posOfficerSign = (
      await q(
        `INSERT INTO positions (org_id, title, clearance_level, dept_scope) VALUES ($1, 'Sign Officer', 3, 'ORG') RETURNING id`,
        [orgAId],
      )
    ).rows[0].id;
    // Position with VIEW only (no SIGN)
    posViewerNoSign = (
      await q(
        `INSERT INTO positions (org_id, title, clearance_level, dept_scope) VALUES ($1, 'Viewer Only', 3, 'ORG') RETURNING id`,
        [orgAId],
      )
    ).rows[0].id;
    // Position in Org B
    posOfficerB = (
      await q(
        `INSERT INTO positions (org_id, title, clearance_level, dept_scope) VALUES ($1, 'Officer B', 3, 'ORG') RETURNING id`,
        [orgBId],
      )
    ).rows[0].id;

    // Attach permissions
    await q(
      `INSERT INTO position_permissions (position_id, permission_id)
       SELECT $1, id FROM permissions WHERE code IN ('VIEW', 'SIGN', 'UPLOAD')`,
      [posOfficerSign],
    );
    await q(
      `INSERT INTO position_permissions (position_id, permission_id)
       SELECT $1, id FROM permissions WHERE code IN ('VIEW')`,
      [posViewerNoSign],
    );
    await q(
      `INSERT INTO position_permissions (position_id, permission_id)
       SELECT $1, id FROM permissions WHERE code IN ('VIEW', 'SIGN')`,
      [posOfficerB],
    );

    // 4. Create users with real Ed25519 keypairs
    signer1Key = newKeyPair();
    signer2Key = newKeyPair();
    const viewerKey = newKeyPair();
    const orgBKey = newKeyPair();

    userSigner1 = (
      await q(
        `INSERT INTO users (department_id, position_id, email, full_name, password_hash, public_key, private_key_enc, is_active)
         VALUES ($1, $2, $3, 'Officer Alice', 'hash', $4, $5, true) RETURNING id`,
        [
          deptA1Id,
          posOfficerSign,
          `alice.${randomSuffix()}@sign.test`,
          signer1Key.publicKey,
          wrap(signer1Key.privateKey),
        ],
      )
    ).rows[0].id;

    userSigner2 = (
      await q(
        `INSERT INTO users (department_id, position_id, email, full_name, password_hash, public_key, private_key_enc, is_active)
         VALUES ($1, $2, $3, 'Officer Bob', 'hash', $4, $5, true) RETURNING id`,
        [
          deptA1Id,
          posOfficerSign,
          `bob.${randomSuffix()}@sign.test`,
          signer2Key.publicKey,
          wrap(signer2Key.privateKey),
        ],
      )
    ).rows[0].id;

    userViewerNoSign = (
      await q(
        `INSERT INTO users (department_id, position_id, email, full_name, password_hash, public_key, private_key_enc, is_active)
         VALUES ($1, $2, $3, 'Viewer Charlie', 'hash', $4, $5, true) RETURNING id`,
        [
          deptA1Id,
          posViewerNoSign,
          `charlie.${randomSuffix()}@sign.test`,
          viewerKey.publicKey,
          wrap(viewerKey.privateKey),
        ],
      )
    ).rows[0].id;

    userOrgB = (
      await q(
        `INSERT INTO users (department_id, position_id, email, full_name, password_hash, public_key, private_key_enc, is_active)
         VALUES ($1, $2, $3, 'Officer Dave', 'hash', $4, $5, true) RETURNING id`,
        [
          deptB1Id,
          posOfficerB,
          `dave.${randomSuffix()}@sign.test`,
          orgBKey.publicKey,
          wrap(orgBKey.privateKey),
        ],
      )
    ).rows[0].id;

    tokenSigner1 = makeToken(userSigner1);
    tokenSigner2 = makeToken(userSigner2);
    tokenViewerNoSign = makeToken(userViewerNoSign);
    tokenOrgB = makeToken(userOrgB);

    // 5. Create workspace and document type
    wsA1Id = (
      await q(
        `INSERT INTO workspaces (department_id, name, status, created_by) VALUES ($1, 'Workspace Sign A', 'OPEN', $2) RETURNING id`,
        [deptA1Id, userSigner1],
      )
    ).rows[0].id;

    docTypeId = (
      await q(`INSERT INTO document_types (org_id, name) VALUES ($1, 'Contract') RETURNING id`, [
        orgAId,
      ])
    ).rows[0].id;

    // 6. Create document A1 and its version 1 with physical test file in storage
    docA1Id = (
      await q(
        `INSERT INTO documents (workspace_id, type_id, classification, title, created_by)
         VALUES ($1, $2, 2, 'Confidential Master Agreement', $3) RETURNING id`,
        [wsA1Id, docTypeId, userSigner1],
      )
    ).rows[0].id;

    versionA1No = 1;
    const initialContent = Buffer.from('Official Content for Confidential Master Agreement v1');
    docA1Sha256 = sha256(initialContent);
    docA1StoragePath = buildStoragePath({
      orgId: orgAId,
      docId: docA1Id,
      versionNo: versionA1No,
      fileName: 'agreement_v1.pdf',
    });

    // Write file into storage adapter
    await put(docA1StoragePath, initialContent, 'application/pdf');

    versionA1Id = (
      await q(
        `INSERT INTO document_versions (document_id, version_no, file_name, mime_type, size_bytes, sha256, storage_path, uploaded_by)
         VALUES ($1, $2, 'agreement_v1.pdf', 'application/pdf', $3, $4, $5, $6) RETURNING id`,
        [docA1Id, versionA1No, initialContent.length, docA1Sha256, docA1StoragePath, userSigner1],
      )
    ).rows[0].id;

    // 7. Create a second untouched document for Q06 unsigned test
    docUntouchedId = (
      await q(
        `INSERT INTO documents (workspace_id, type_id, classification, title, created_by)
         VALUES ($1, $2, 2, 'Untouched Document For Unsigned Query', $3) RETURNING id`,
        [wsA1Id, docTypeId, userSigner1],
      )
    ).rows[0].id;

    versionUntouchedNo = 1;
    const untouchedContent = Buffer.from('Untouched document version bytes');
    untouchedSha256 = sha256(untouchedContent);
    const untouchedStoragePath = buildStoragePath({
      orgId: orgAId,
      docId: docUntouchedId,
      versionNo: versionUntouchedNo,
      fileName: 'untouched.pdf',
    });
    await put(untouchedStoragePath, untouchedContent, 'application/pdf');

    versionUntouchedId = (
      await q(
        `INSERT INTO document_versions (document_id, version_no, file_name, mime_type, size_bytes, sha256, storage_path, uploaded_by)
         VALUES ($1, $2, 'untouched.pdf', 'application/pdf', $3, $4, $5, $6) RETURNING id`,
        [
          docUntouchedId,
          versionUntouchedNo,
          untouchedContent.length,
          untouchedSha256,
          untouchedStoragePath,
          userSigner1,
        ],
      )
    ).rows[0].id;
  });

  describe('Database Schema & Immutability Triggers (004_signatures.sql)', () => {
    it('creates the signatures table with primary and foreign key constraints', async () => {
      const { rows } = await q(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'signatures'
         ORDER BY ordinal_position`,
      );
      const cols = rows.map((r) => r.column_name);
      expect(cols).toContain('id');
      expect(cols).toContain('version_id');
      expect(cols).toContain('signer_id');
      expect(cols).toContain('signature');
      expect(cols).toContain('signed_at');
    });

    it('enforces UNIQUE (version_id, signer_id) constraint on direct database insert', async () => {
      // First insert works
      await q(
        `INSERT INTO signatures (version_id, signer_id, signature)
         VALUES ($1, $2, 'dummy-signature-1')`,
        [versionUntouchedId, userSigner2],
      );

      // Second insert with same version and signer fails
      await expect(
        q(
          `INSERT INTO signatures (version_id, signer_id, signature)
           VALUES ($1, $2, 'dummy-signature-2')`,
          [versionUntouchedId, userSigner2],
        ),
      ).rejects.toThrow();

      // Clean up for other tests (disable trigger temporarily for test cleanup)
      await q('ALTER TABLE signatures DISABLE TRIGGER signatures_immutable');
      await q('DELETE FROM signatures WHERE version_id = $1 AND signer_id = $2', [
        versionUntouchedId,
        userSigner2,
      ]);
      await q('ALTER TABLE signatures ENABLE TRIGGER signatures_immutable');
    });

    it('rejects UPDATE operations via signatures_immutable trigger', async () => {
      // Temporarily insert a row
      await q('ALTER TABLE signatures DISABLE TRIGGER signatures_immutable');
      const sigId = (
        await q(
          `INSERT INTO signatures (version_id, signer_id, signature)
           VALUES ($1, $2, 'immutability-check-sig') RETURNING id`,
          [versionUntouchedId, userSigner2],
        )
      ).rows[0].id;
      await q('ALTER TABLE signatures ENABLE TRIGGER signatures_immutable');

      // Attempting UPDATE must be rejected by the trigger
      await expect(
        q(`UPDATE signatures SET signature = 'altered-signature' WHERE id = $1`, [sigId]),
      ).rejects.toThrow(/append-only/i);

      // Clean up
      await q('ALTER TABLE signatures DISABLE TRIGGER signatures_immutable');
      await q('DELETE FROM signatures WHERE id = $1', [sigId]);
      await q('ALTER TABLE signatures ENABLE TRIGGER signatures_immutable');
    });

    it('rejects DELETE operations via signatures_immutable trigger', async () => {
      await q('ALTER TABLE signatures DISABLE TRIGGER signatures_immutable');
      const sigId = (
        await q(
          `INSERT INTO signatures (version_id, signer_id, signature)
           VALUES ($1, $2, 'immutability-delete-sig') RETURNING id`,
          [versionUntouchedId, userSigner2],
        )
      ).rows[0].id;
      await q('ALTER TABLE signatures ENABLE TRIGGER signatures_immutable');

      // Attempting DELETE must be rejected by the trigger
      await expect(q(`DELETE FROM signatures WHERE id = $1`, [sigId])).rejects.toThrow(
        /append-only/i,
      );

      // Clean up
      await q('ALTER TABLE signatures DISABLE TRIGGER signatures_immutable');
      await q('DELETE FROM signatures WHERE id = $1', [sigId]);
      await q('ALTER TABLE signatures ENABLE TRIGGER signatures_immutable');
    });
  });

  describe('AP-10 Digital Signatures Signing Flow (POST /documents/:id/versions/:no/sign)', () => {
    it('signs a document version and returns 201 with verified cryptographic signature', async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${docA1Id}/versions/${versionA1No}/sign`)
        .set('Authorization', `Bearer ${tokenSigner1}`)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.versionId).toBe(versionA1Id);
      expect(res.body.data.versionNo).toBe(versionA1No);
      expect(res.body.data.signerId).toBe(userSigner1);
      expect(typeof res.body.data.signatureId).toBe('string');
      expect(typeof res.body.data.signature).toBe('string');

      // Cryptographically verify with signer1's public key
      const isValid = verifyHash(signer1Key.publicKey, docA1Sha256, res.body.data.signature);
      expect(isValid).toBe(true);

      // Verify audit entry was logged in the same transaction
      const audit = (
        await q(
          `SELECT action, outcome, entity_type, entity_id, details
           FROM audit_logs
           WHERE entity_id = $1 AND action = 'SIGN'
           ORDER BY id DESC LIMIT 1`,
          [versionA1Id],
        )
      ).rows[0];

      expect(audit).toBeDefined();
      expect(audit.action).toBe('SIGN');
      expect(audit.outcome).toBe('ALLOWED');
      expect(audit.details.signatureId).toBe(res.body.data.signatureId);
    });

    it('rejects duplicate signature on the same version with 409 CONFLICT (BR-12)', async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${docA1Id}/versions/${versionA1No}/sign`)
        .set('Authorization', `Bearer ${tokenSigner1}`)
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.message).toMatch(/already been signed/i);
    });

    it('allows a second distinct user with SIGN permission to also sign the version', async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${docA1Id}/versions/${versionA1No}/sign`)
        .set('Authorization', `Bearer ${tokenSigner2}`)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.signerId).toBe(userSigner2);

      // Cryptographically verify with signer2's public key
      const isValid = verifyHash(signer2Key.publicKey, docA1Sha256, res.body.data.signature);
      expect(isValid).toBe(true);
    });

    it('rejects signing attempt by user without SIGN permission with 403 FORBIDDEN and audits ACCESS_DENIED', async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${docA1Id}/versions/${versionA1No}/sign`)
        .set('Authorization', `Bearer ${tokenViewerNoSign}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');

      // Confirm ACCESS_DENIED audit entry
      const audit = (
        await q(
          `SELECT action, outcome, actor_id, details
           FROM audit_logs
           WHERE action = 'ACCESS_DENIED' AND actor_id = $1
           ORDER BY id DESC LIMIT 1`,
          [userViewerNoSign],
        )
      ).rows[0];

      expect(audit).toBeDefined();
      expect(audit.outcome).toBe('DENIED');
      expect(audit.details.requiredPermission).toBe('SIGN');
    });

    it('returns 404 NOT_FOUND when caller is from a different organisation (deny by default)', async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${docA1Id}/versions/${versionA1No}/sign`)
        .set('Authorization', `Bearer ${tokenOrgB}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 NOT_FOUND for a non-existent document version', async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${docA1Id}/versions/999/sign`)
        .set('Authorization', `Bearer ${tokenSigner1}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('rejects invalid version number parameter with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${docA1Id}/versions/not-a-number/sign`)
        .set('Authorization', `Bearer ${tokenSigner1}`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Pre-Signing File Integrity Check (BR-09, AP-07/AP-10)', () => {
    let tamperedDocId, tamperedVersionNo, tamperedStoragePath;

    beforeAll(async () => {
      tamperedDocId = (
        await q(
          `INSERT INTO documents (workspace_id, type_id, classification, title, created_by)
           VALUES ($1, $2, 2, 'Tampered Target Agreement', $3) RETURNING id`,
          [wsA1Id, docTypeId, userSigner1],
        )
      ).rows[0].id;

      tamperedVersionNo = 1;
      const originalBytes = Buffer.from('Original authentic file bytes before tampering');
      const originalSha256 = sha256(originalBytes);
      tamperedStoragePath = buildStoragePath({
        orgId: orgAId,
        docId: tamperedDocId,
        versionNo: tamperedVersionNo,
        fileName: 'tampered.pdf',
      });

      // Write original file into storage
      await put(tamperedStoragePath, originalBytes, 'application/pdf');

      await q(
        `INSERT INTO document_versions (document_id, version_no, file_name, mime_type, size_bytes, sha256, storage_path, uploaded_by)
         VALUES ($1, $2, 'tampered.pdf', 'application/pdf', $3, $4, $5, $6)`,
        [
          tamperedDocId,
          tamperedVersionNo,
          originalBytes.length,
          originalSha256,
          tamperedStoragePath,
          userSigner1,
        ],
      );

      // Now simulate tampering: overwrite storage file with corrupt bytes
      const corruptedBytes = Buffer.from('CORRUPTED BYTES INJECTED BY ATTACKER');
      await put(tamperedStoragePath, corruptedBytes, 'application/pdf');
    });

    it('detects file hash mismatch prior to signing and returns 409 INTEGRITY_FAILURE', async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${tamperedDocId}/versions/${tamperedVersionNo}/sign`)
        .set('Authorization', `Bearer ${tokenSigner1}`)
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTEGRITY_FAILURE');
      expect(res.body.error.message).toMatch(/tampered/i);

      // Verify that NO signature row was inserted
      const count = (
        await q(
          `SELECT count(*)::int AS count
           FROM signatures s
           JOIN document_versions v ON v.id = s.version_id
           WHERE v.document_id = $1`,
          [tamperedDocId],
        )
      ).rows[0].count;
      expect(count).toBe(0);

      // Verify that VERIFY FAILED was logged in audit_logs
      const audit = (
        await q(
          `SELECT action, outcome, details
           FROM audit_logs
           WHERE action = 'VERIFY' AND outcome = 'FAILED'
           ORDER BY id DESC LIMIT 1`,
        )
      ).rows[0];

      expect(audit).toBeDefined();
      expect(audit.details.status).toBe('TAMPERED');
    });
  });

  describe('Retrieval & Dynamic Verification (GET /documents/:id/versions/:no/signatures)', () => {
    it('retrieves all signatures on a document version with dynamic cryptographic verification', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${docA1Id}/versions/${versionA1No}/signatures`)
        .set('Authorization', `Bearer ${tokenSigner1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.documentId).toBe(docA1Id);
      expect(res.body.data.versionNo).toBe(versionA1No);
      expect(res.body.data.count).toBe(2);
      expect(res.body.data.allVerified).toBe(true);

      const sigs = res.body.data.signatures;
      expect(sigs).toHaveLength(2);
      expect(sigs[0].verified).toBe(true);
      expect(sigs[0].signer.fullName).toBe('Officer Alice');
      expect(sigs[1].verified).toBe(true);
      expect(sigs[1].signer.fullName).toBe('Officer Bob');
    });

    it('allows a user with VIEW permission to retrieve and inspect signatures', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${docA1Id}/versions/${versionA1No}/signatures`)
        .set('Authorization', `Bearer ${tokenViewerNoSign}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(2);
    });

    it('returns 404 NOT_FOUND for non-existent document or version', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${docA1Id}/versions/999/signatures`)
        .set('Authorization', `Bearer ${tokenSigner1}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('DE-05 Q06: Latest Versions Without Signatures (Anti-Join)', () => {
    it('accurately lists document versions that have zero signatures', async () => {
      const res = await request(app)
        .get('/api/v1/signatures/stats/unsigned-latest')
        .set('Authorization', `Bearer ${tokenSigner1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      const unsignedDocs = res.body.data;
      expect(Array.isArray(unsignedDocs)).toBe(true);

      // docUntouched has 0 signatures, so it MUST appear in the list
      const foundUntouched = unsignedDocs.find((d) => d.document_id === docUntouchedId);
      expect(foundUntouched).toBeDefined();
      expect(foundUntouched.version_no).toBe(1);

      // docA1 has 2 signatures, so it MUST NOT appear in the list
      const foundDocA1 = unsignedDocs.find((d) => d.document_id === docA1Id);
      expect(foundDocA1).toBeUndefined();
    });
  });

  describe('Standalone Signature Verification API (GET /signatures/:id/verify)', () => {
    it('verifies an individual signature by ID', async () => {
      // Fetch Alice's signature ID
      const sigRow = (
        await q(`SELECT id FROM signatures WHERE version_id = $1 AND signer_id = $2`, [
          versionA1Id,
          userSigner1,
        ])
      ).rows[0];

      const res = await request(app)
        .get(`/api/v1/signatures/${sigRow.id}/verify`)
        .set('Authorization', `Bearer ${tokenSigner1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.signatureId).toBe(sigRow.id);
      expect(res.body.data.verified).toBe(true);
      expect(res.body.data.signer.email).toMatch(/alice/);
    });

    it('returns 404 NOT_FOUND for non-existent signature UUID', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .get(`/api/v1/signatures/${fakeUuid}/verify`)
        .set('Authorization', `Bearer ${tokenSigner1}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
