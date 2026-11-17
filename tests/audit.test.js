import { execFileSync } from 'node:child_process';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { getPool, closePool, withTransaction } from '../src/config/db.js';
import { config } from '../src/config/env.js';
import { appendAudit, writeAudit, computeAuditHash } from '../src/modules/audit/auditWriter.js';
import { verifyAuditChain } from '../src/modules/audit/service.js';

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

describe('Step 6: Audit Log Hash-Chain Architecture & Verification (Sakshi)', () => {
  let orgAId;
  let orgBId;
  let adminAId;
  let adminAToken;
  let auditorAId;
  let auditorAToken;
  let memberNoAuditId;
  let memberNoAuditToken;
  let adminBId;
  let adminBToken;

  beforeAll(async () => {
    // 1. Create Organisation A with admin
    const orgARes = await q(
      `INSERT INTO organizations (name, org_type) VALUES ('Alpha Forensic Lab', 'POLICE') RETURNING id`,
    );
    orgAId = orgARes.rows[0].id;

    const deptARes = await q(
      `INSERT INTO departments (org_id, code, name) VALUES ($1, 'SEC', 'Cyber Security') RETURNING id`,
      [orgAId],
    );
    const deptAId = deptARes.rows[0].id;

    // Admin position with all permissions including AUDIT and MANAGE_ORG
    const posAdminARes = await q(
      `INSERT INTO positions (org_id, title, clearance_level, dept_scope)
       VALUES ($1, 'Chief Security Officer', 4, 'ORG') RETURNING id`,
      [orgAId],
    );
    const posAdminAId = posAdminARes.rows[0].id;

    // Grant all permissions to admin position
    const perms = (await q(`SELECT id, code FROM permissions`)).rows;
    for (const p of perms) {
      await q(`INSERT INTO position_permissions (position_id, permission_id) VALUES ($1, $2)`, [
        posAdminAId,
        p.id,
      ]);
    }

    // Auditor position with AUDIT and VIEW permissions only
    const posAuditorARes = await q(
      `INSERT INTO positions (org_id, title, clearance_level, dept_scope)
       VALUES ($1, 'Internal Auditor', 3, 'ORG') RETURNING id`,
      [orgAId],
    );
    const posAuditorAId = posAuditorARes.rows[0].id;
    const auditPermId = perms.find((p) => p.code === 'AUDIT').id;
    const viewPermId = perms.find((p) => p.code === 'VIEW').id;
    await q(`INSERT INTO position_permissions (position_id, permission_id) VALUES ($1, $2)`, [
      posAuditorAId,
      auditPermId,
    ]);
    await q(`INSERT INTO position_permissions (position_id, permission_id) VALUES ($1, $2)`, [
      posAuditorAId,
      viewPermId,
    ]);

    // Member position with VIEW and UPLOAD only (NO AUDIT permission)
    const posMemberARes = await q(
      `INSERT INTO positions (org_id, title, clearance_level, dept_scope)
       VALUES ($1, 'Analyst', 2, 'OWN_DEPT') RETURNING id`,
      [orgAId],
    );
    const posMemberAId = posMemberARes.rows[0].id;
    const uploadPermId = perms.find((p) => p.code === 'UPLOAD').id;
    await q(`INSERT INTO position_permissions (position_id, permission_id) VALUES ($1, $2)`, [
      posMemberAId,
      viewPermId,
    ]);
    await q(`INSERT INTO position_permissions (position_id, permission_id) VALUES ($1, $2)`, [
      posMemberAId,
      uploadPermId,
    ]);

    // Users
    const uAdminA = await q(
      `INSERT INTO users (department_id, position_id, email, password_hash, public_key, private_key_enc, full_name)
       VALUES ($1, $2, 'cso@alpha.gov', 'hashed_pass', 'pub_key_pem', 'enc_key_blob', 'Alice CSO') RETURNING id`,
      [deptAId, posAdminAId],
    );
    adminAId = uAdminA.rows[0].id;
    adminAToken = makeToken(adminAId);

    const uAuditorA = await q(
      `INSERT INTO users (department_id, position_id, email, password_hash, public_key, private_key_enc, full_name)
       VALUES ($1, $2, 'auditor@alpha.gov', 'hashed_pass', 'pub_key_pem', 'enc_key_blob', 'Arthur Auditor') RETURNING id`,
      [deptAId, posAuditorAId],
    );
    auditorAId = uAuditorA.rows[0].id;
    auditorAToken = makeToken(auditorAId);

    const uMemberA = await q(
      `INSERT INTO users (department_id, position_id, email, password_hash, public_key, private_key_enc, full_name)
       VALUES ($1, $2, 'analyst@alpha.gov', 'hashed_pass', 'pub_key_pem', 'enc_key_blob', 'Mark Member') RETURNING id`,
      [deptAId, posMemberAId],
    );
    memberNoAuditId = uMemberA.rows[0].id;
    memberNoAuditToken = makeToken(memberNoAuditId);

    // 2. Create Organisation B for multi-tenancy verification
    const orgBRes = await q(
      `INSERT INTO organizations (name, org_type) VALUES ('Beta Legal Vault', 'COURT') RETURNING id`,
    );
    orgBId = orgBRes.rows[0].id;

    const deptBRes = await q(
      `INSERT INTO departments (org_id, code, name) VALUES ($1, 'LEGAL', 'Legal Affairs') RETURNING id`,
      [orgBId],
    );
    const deptBId = deptBRes.rows[0].id;

    const posAdminBRes = await q(
      `INSERT INTO positions (org_id, title, clearance_level, dept_scope)
       VALUES ($1, 'Registrar', 4, 'ORG') RETURNING id`,
      [orgBId],
    );
    const posAdminBId = posAdminBRes.rows[0].id;
    for (const p of perms) {
      await q(`INSERT INTO position_permissions (position_id, permission_id) VALUES ($1, $2)`, [
        posAdminBId,
        p.id,
      ]);
    }

    const uAdminB = await q(
      `INSERT INTO users (department_id, position_id, email, password_hash, public_key, private_key_enc, full_name)
       VALUES ($1, $2, 'registrar@beta.gov', 'hashed_pass', 'pub_key_pem', 'enc_key_blob', 'Bob Registrar') RETURNING id`,
      [deptBId, posAdminBId],
    );
    adminBId = uAdminB.rows[0].id;
    adminBToken = makeToken(adminBId);
  });

  describe('AP-08 Hash-Chain Cryptographic Construction & Sequencing', () => {
    it('initialises an organisation chain with seq = 1 and prev_hash = 64 zeros (genesis link)', async () => {
      const entry1 = await withTransaction(async (tx) => {
        return appendAudit(tx, {
          orgId: orgAId,
          actorId: adminAId,
          action: 'LOGIN',
          outcome: 'ALLOWED',
          details: { method: 'PASSWORD', mfa: false },
        });
      });

      expect(entry1.seq).toBe(1);
      expect(entry1.prevHash).toBe('0'.repeat(64));
      expect(entry1.hash).toMatch(/^[0-9a-f]{64}$/);

      // Verify that stored row in DB matches the exact calculated values
      const { rows } = await q(`SELECT * FROM audit_logs WHERE org_id = $1 AND seq = 1`, [orgAId]);
      expect(rows.length).toBe(1);
      expect(rows[0].seq).toBe(1);
      expect(rows[0].prev_hash).toBe('0'.repeat(64));
      expect(rows[0].hash).toBe(entry1.hash);
      expect(rows[0].action).toBe('LOGIN');
      expect(rows[0].outcome).toBe('ALLOWED');
    });

    it('chains subsequent entries sequentially: row(N).prev_hash === row(N-1).hash', async () => {
      const { rows: initialRows } = await q(
        `SELECT seq, hash FROM audit_logs WHERE org_id = $1 ORDER BY seq DESC LIMIT 1`,
        [orgAId],
      );
      const prevEntry = initialRows[0];

      const entry2 = await writeAudit({
        orgId: orgAId,
        actorId: auditorAId,
        action: 'VIEW',
        outcome: 'ALLOWED',
        entityType: 'DOCUMENT',
        entityId: '00000000-0000-0000-0000-000000000001',
        details: { mode: 'PREVIEW' },
      });

      expect(entry2.seq).toBe(prevEntry.seq + 1);
      expect(entry2.prevHash).toBe(prevEntry.hash.trim());

      const entry3 = await writeAudit({
        orgId: orgAId,
        actorId: memberNoAuditId,
        action: 'ACCESS_DENIED',
        outcome: 'DENIED',
        entityType: 'WORKSPACE',
        entityId: '00000000-0000-0000-0000-000000000002',
        details: { reason: 'OUT_OF_SCOPE' },
      });

      expect(entry3.seq).toBe(entry2.seq + 1);
      expect(entry3.prevHash).toBe(entry2.hash);
    });

    it('guarantees canonical JSON determinism regardless of property key insertion order', () => {
      const time = '2026-11-17T12:00:00.000Z';
      const prev = 'a'.repeat(64);

      // Object A with keys [z, a, m]
      const hashA = computeAuditHash({
        prevHash: prev,
        seq: 5,
        orgId: orgAId,
        actorId: adminAId,
        action: 'UPLOAD',
        outcome: 'ALLOWED',
        details: { z: 1, a: 2, m: { y: 'last', x: 'first' } },
        createdAt: time,
      });

      // Object B with identical content but completely reversed key order [a, m, z]
      const hashB = computeAuditHash({
        prevHash: prev,
        seq: 5,
        orgId: orgAId,
        actorId: adminAId,
        action: 'UPLOAD',
        outcome: 'ALLOWED',
        details: { a: 2, m: { x: 'first', y: 'last' }, z: 1 },
        createdAt: time,
      });

      expect(hashA).toBe(hashB);
    });

    it('maintains distinct, isolated audit chains for different organisations', async () => {
      // Organisation B's first audit row
      const entryOrgB = await writeAudit({
        orgId: orgBId,
        actorId: adminBId,
        action: 'ADMIN_CHANGE',
        outcome: 'ALLOWED',
        details: { action: 'BOOTSTRAP_ORG' },
      });

      expect(entryOrgB.seq).toBe(1);
      expect(entryOrgB.prevHash).toBe('0'.repeat(64));

      // Check that Org A's chain was unaffected
      const countA = (
        await q(`SELECT count(*)::int AS total FROM audit_logs WHERE org_id = $1`, [orgAId])
      ).rows[0].total;
      const countB = (
        await q(`SELECT count(*)::int AS total FROM audit_logs WHERE org_id = $1`, [orgBId])
      ).rows[0].total;

      expect(countA).toBeGreaterThanOrEqual(3);
      expect(countB).toBe(1);
    });

    it('serializes concurrent writers without gaps or duplicate sequence numbers (SELECT FOR UPDATE)', async () => {
      // Fire 10 concurrent audit writes for Organisation A simultaneously
      const writes = Array.from({ length: 10 }).map((_, idx) =>
        writeAudit({
          orgId: orgAId,
          actorId: adminAId,
          action: 'VIEW',
          outcome: 'ALLOWED',
          details: { concurrentIndex: idx },
        }),
      );

      const results = await Promise.all(writes);
      expect(results).toHaveLength(10);

      // Verify all sequence numbers are distinct and consecutive
      const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBe(seqs[i - 1] + 1);
      }

      // Check DB continuity
      const { rows } = await q(
        `SELECT seq, prev_hash, hash FROM audit_logs WHERE org_id = $1 ORDER BY seq ASC`,
        [orgAId],
      );
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].seq).toBe(rows[i - 1].seq + 1);
        expect(rows[i].prev_hash.trim()).toBe(rows[i - 1].hash.trim());
      }
    });
  });

  describe('AP-08 Audit Chain Verification Service (verifyAuditChain)', () => {
    it('verifies a pristine chain and returns status, count, and lastSeq', async () => {
      const result = await verifyAuditChain(orgAId, pool);
      expect(result.verified).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(13);
      expect(result.lastSeq).toBe(result.count);
      expect(result.headHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.brokenSeq).toBeUndefined();
    });

    it('returns verified = true with count = 0 for an organisation with no audit records', async () => {
      const emptyOrg = (
        await q(
          `INSERT INTO organizations (name, org_type) VALUES ('Empty Org', 'OTHER') RETURNING id`,
        )
      ).rows[0].id;

      const result = await verifyAuditChain(emptyOrg, pool);
      expect(result.verified).toBe(true);
      expect(result.count).toBe(0);
      expect(result.lastSeq).toBe(0);
    });

    it('pinpoints payload data tampering at the exact sequence number (HASH_MISMATCH)', async () => {
      // Temporarily disable immutability trigger to simulate unauthorized direct DB tampering
      await q('ALTER TABLE audit_logs DISABLE TRIGGER audit_immutable');

      try {
        // Tamper with details of entry seq = 3 in Organisation A
        await q(
          `UPDATE audit_logs
           SET details = '{"reason":"TAMPERED_BY_ATTACKER"}'::jsonb
           WHERE org_id = $1 AND seq = 3`,
          [orgAId],
        );

        const check = await verifyAuditChain(orgAId, pool);
        expect(check.verified).toBe(false);
        expect(check.brokenSeq).toBe(3);
        expect(check.reason).toBe('HASH_MISMATCH');
        expect(check.message).toContain('Data tampering detected at seq 3');
        expect(check.expectedHash).not.toEqual(check.actualHash);
      } finally {
        // Restore original details and re-enable trigger
        await q(
          `UPDATE audit_logs
           SET details = '{"reason":"OUT_OF_SCOPE"}'::jsonb
           WHERE org_id = $1 AND seq = 3`,
          [orgAId],
        );
        await q('ALTER TABLE audit_logs ENABLE TRIGGER audit_immutable');
      }

      // Chain should verify again after restoration
      const restored = await verifyAuditChain(orgAId, pool);
      expect(restored.verified).toBe(true);
    });

    it('pinpoints broken chain pointer when prev_hash is severed (BROKEN_LINK)', async () => {
      await q('ALTER TABLE audit_logs DISABLE TRIGGER audit_immutable');

      const originalPrevHash = (
        await q(`SELECT prev_hash FROM audit_logs WHERE org_id = $1 AND seq = 4`, [orgAId])
      ).rows[0].prev_hash;

      try {
        // Sever pointer of seq = 4 to point to fake hash
        await q(`UPDATE audit_logs SET prev_hash = $1 WHERE org_id = $2 AND seq = 4`, [
          'f'.repeat(64),
          orgAId,
        ]);

        const check = await verifyAuditChain(orgAId, pool);
        expect(check.verified).toBe(false);
        expect(check.brokenSeq).toBe(4);
        expect(check.reason).toBe('BROKEN_LINK');
        expect(check.message).toContain('Previous hash pointer mismatch at seq 4');
      } finally {
        await q(`UPDATE audit_logs SET prev_hash = $1 WHERE org_id = $2 AND seq = 4`, [
          originalPrevHash,
          orgAId,
        ]);
        await q('ALTER TABLE audit_logs ENABLE TRIGGER audit_immutable');
      }

      const restored = await verifyAuditChain(orgAId, pool);
      expect(restored.verified).toBe(true);
    });
  });

  describe('Database Immutability Triggers on audit_logs (003_immutability.sql)', () => {
    it('strictly forbids UPDATE operations on audit_logs', async () => {
      await expect(
        q(`UPDATE audit_logs SET action = 'ADMIN_CHANGE' WHERE org_id = $1 AND seq = 1`, [orgAId]),
      ).rejects.toThrow(/audit_logs is append-only: UPDATE is not allowed/i);
    });

    it('strictly forbids DELETE operations on audit_logs', async () => {
      await expect(
        q(`DELETE FROM audit_logs WHERE org_id = $1 AND seq = 1`, [orgAId]),
      ).rejects.toThrow(/audit_logs is append-only: DELETE is not allowed/i);
    });

    it('strictly forbids TRUNCATE operations on audit_logs', async () => {
      await expect(q(`TRUNCATE TABLE audit_logs`)).rejects.toThrow(
        /audit_logs is append-only: TRUNCATE is not allowed/i,
      );
    });
  });

  describe('REST API Endpoints: GET /api/v1/audit & GET /api/v1/audit/verify-chain', () => {
    describe('Authentication & Authorization Enforcements', () => {
      it('rejects unauthenticated requests with 401 UNAUTHENTICATED', async () => {
        const res = await request(app).get('/api/v1/audit/verify-chain');
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('rejects users without AUDIT permission with 403 FORBIDDEN and audits ACCESS_DENIED', async () => {
        const countBefore = (
          await q(
            `SELECT count(*)::int AS n FROM audit_logs WHERE org_id = $1 AND action = 'ACCESS_DENIED'`,
            [orgAId],
          )
        ).rows[0].n;

        const res = await request(app)
          .get('/api/v1/audit/verify-chain')
          .set('Authorization', `Bearer ${memberNoAuditToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('FORBIDDEN');

        // Check ACCESS_DENIED was logged
        const countAfter = (
          await q(
            `SELECT count(*)::int AS n FROM audit_logs WHERE org_id = $1 AND action = 'ACCESS_DENIED'`,
            [orgAId],
          )
        ).rows[0].n;
        expect(countAfter).toBe(countBefore + 1);

        const lastAudit = (
          await q(
            `SELECT action, actor_id, details FROM audit_logs
             WHERE org_id = $1 AND action = 'ACCESS_DENIED'
             ORDER BY seq DESC LIMIT 1`,
            [orgAId],
          )
        ).rows[0];
        expect(lastAudit.actor_id).toBe(memberNoAuditId);
        expect(lastAudit.details.requiredPermission).toBe('AUDIT');
      });

      it('allows authorized users holding AUDIT permission (Auditor and CSO)', async () => {
        const auditorRes = await request(app)
          .get('/api/v1/audit/verify-chain')
          .set('Authorization', `Bearer ${auditorAToken}`);

        expect(auditorRes.status).toBe(200);
        expect(auditorRes.body.success).toBe(true);
        expect(auditorRes.body.data.verified).toBe(true);

        const adminRes = await request(app)
          .get('/api/v1/audit/verify-chain')
          .set('Authorization', `Bearer ${adminAToken}`);

        expect(adminRes.status).toBe(200);
        expect(adminRes.body.success).toBe(true);
        expect(adminRes.body.data.verified).toBe(true);
      });
    });

    describe('GET /api/v1/audit/verify-chain', () => {
      it('verifies the audit chain and isolates organisations by tenant boundary', async () => {
        // Verify Org A with Auditor A
        const resA = await request(app)
          .get('/api/v1/audit/verify-chain')
          .set('Authorization', `Bearer ${auditorAToken}`);

        expect(resA.status).toBe(200);
        expect(resA.body.data.verified).toBe(true);
        expect(resA.body.data.count).toBeGreaterThanOrEqual(14);

        // Verify Org B with Admin B
        const resB = await request(app)
          .get('/api/v1/audit/verify-chain')
          .set('Authorization', `Bearer ${adminBToken}`);

        expect(resB.status).toBe(200);
        expect(resB.body.data.verified).toBe(true);
        expect(resB.body.data.count).toBe(1);
      });
    });

    describe('GET /api/v1/audit (Querying & Filtering)', () => {
      it('returns paginated audit entries in descending sequence order (newest first)', async () => {
        const res = await request(app)
          .get('/api/v1/audit?page=1&pageSize=5')
          .set('Authorization', `Bearer ${auditorAToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.items).toHaveLength(5);
        expect(res.body.data.page).toBe(1);
        expect(res.body.data.pageSize).toBe(5);
        expect(res.body.data.total).toBeGreaterThanOrEqual(14);

        // Sequences must be strictly descending
        const items = res.body.data.items;
        for (let i = 1; i < items.length; i++) {
          expect(items[i].seq).toBeLessThan(items[i - 1].seq);
        }

        // Each item includes actor email/name if available
        expect(items[0]).toHaveProperty('actorId');
        expect(items[0]).toHaveProperty('hash');
        expect(items[0]).toHaveProperty('prevHash');
        expect(items[0]).toHaveProperty('createdAt');
      });

      it('filters audit entries by action code', async () => {
        const res = await request(app)
          .get('/api/v1/audit?action=ACCESS_DENIED')
          .set('Authorization', `Bearer ${auditorAToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
        for (const item of res.body.data.items) {
          expect(item.action).toBe('ACCESS_DENIED');
        }
      });

      it('filters audit entries by actorId and outcome', async () => {
        const res = await request(app)
          .get(`/api/v1/audit?actorId=${memberNoAuditId}&outcome=DENIED`)
          .set('Authorization', `Bearer ${auditorAToken}`);

        expect(res.status).toBe(200);
        for (const item of res.body.data.items) {
          expect(item.actorId).toBe(memberNoAuditId);
          expect(item.outcome).toBe('DENIED');
        }
      });

      it('rejects invalid query parameters with 400 VALIDATION_ERROR', async () => {
        const res = await request(app)
          .get('/api/v1/audit?action=INVALID_NONEXISTENT_ACTION')
          .set('Authorization', `Bearer ${auditorAToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/v1/audit/:seq', () => {
      it('returns a specific audit row by sequence number', async () => {
        const res = await request(app)
          .get('/api/v1/audit/1')
          .set('Authorization', `Bearer ${auditorAToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.seq).toBe(1);
        expect(res.body.data.prevHash).toBe('0'.repeat(64));
      });

      it('returns 404 NOT_FOUND for non-existent sequence number', async () => {
        const res = await request(app)
          .get('/api/v1/audit/999999')
          .set('Authorization', `Bearer ${auditorAToken}`);

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });
    });

    describe('DE-05 Analytics Endpoints', () => {
      it('GET /api/v1/audit/stats/denied-by-position: returns aggregated denied attempts (Q07)', async () => {
        const res = await request(app)
          .get('/api/v1/audit/stats/denied-by-position')
          .set('Authorization', `Bearer ${auditorAToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);

        const deniedStat = res.body.data[0];
        expect(deniedStat).toHaveProperty('positionId');
        expect(deniedStat).toHaveProperty('positionTitle');
        expect(deniedStat).toHaveProperty('deniedCount');
      });

      it('GET /api/v1/audit/stats/active-users: returns most active users ranking (Q08)', async () => {
        const res = await request(app)
          .get('/api/v1/audit/stats/active-users?days=30')
          .set('Authorization', `Bearer ${auditorAToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);

        const userStat = res.body.data[0];
        expect(userStat).toHaveProperty('userId');
        expect(userStat).toHaveProperty('email');
        expect(userStat).toHaveProperty('actionCount');
      });
    });
  });
});
