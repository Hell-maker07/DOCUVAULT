import { execFileSync } from 'node:child_process';
import pg from 'pg';

// Acceptance tests (DE-02, DE-08, AP-06/AP-08 groundwork) for the vault tables and the
// immutability triggers: the database itself must reject invalid and forbidden changes.
let pool;
const q = (text, params) => pool.query(text, params);
const err = async (promise) => {
  try {
    await promise;
    return {};
  } catch (e) {
    return e;
  }
};
const UNIQUE = '23505',
  CHECK = '23514',
  FK = '23503',
  RAISE = 'P0001',
  GENERATED = '428C9';
const GOOD_HASH = 'a'.repeat(64);

let orgId, deptId, userId, wsId, typeId, docId;

beforeAll(async () => {
  execFileSync('node', ['scripts/db.js', 'reset'], {
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'pipe',
  });
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST });
  const one = async (sql, p) => (await q(sql, p)).rows[0].id;
  orgId = await one(
    `INSERT INTO organizations (name, org_type) VALUES ('Vault Org','CORPORATE') RETURNING id`,
  );
  deptId = await one(
    `INSERT INTO departments (org_id, code, name) VALUES ($1,'HR','Human Resources') RETURNING id`,
    [orgId],
  );
  const posId = await one(
    `INSERT INTO positions (org_id, title, clearance_level, dept_scope) VALUES ($1,'Manager',3,'OWN_DEPT') RETURNING id`,
    [orgId],
  );
  userId = await one(
    `INSERT INTO users (department_id, position_id, email, full_name, password_hash, public_key, private_key_enc)
     VALUES ($1,$2,'m@vault.test','Manager','h','p','e') RETURNING id`,
    [deptId, posId],
  );
  wsId = await one(
    `INSERT INTO workspaces (department_id, name, created_by) VALUES ($1,'Case 1',$2) RETURNING id`,
    [deptId, userId],
  );
  typeId = await one(
    `INSERT INTO document_types (org_id, name) VALUES ($1,'Contract') RETURNING id`,
    [orgId],
  );
  docId = await one(
    `INSERT INTO documents (workspace_id, type_id, classification, title, description, created_by)
     VALUES ($1,$2,3,'Forensic report','Ballistics findings for the case',$3) RETURNING id`,
    [wsId, typeId, userId],
  );
}, 30_000);
afterAll(() => pool.end());

const insertVersion = (no, over = {}) =>
  q(
    `INSERT INTO document_versions (document_id, version_no, file_name, mime_type, size_bytes, sha256, storage_path, uploaded_by)
     VALUES ($1,$2,'f.pdf','application/pdf',$3,$4,'p/f.pdf',$5)`,
    [docId, no, over.size ?? 10, over.sha ?? GOOD_HASH, userId],
  );

let seq = 0;
const insertAudit = (over = {}) =>
  q(
    `INSERT INTO audit_logs (org_id, actor_id, seq, action, outcome, created_at, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,now(),$6,$7)`,
    [
      over.org ?? orgId,
      'actor' in over ? over.actor : userId,
      over.seq ?? ++seq,
      over.action ?? 'LOGIN',
      over.outcome ?? 'ALLOWED',
      over.prev ?? '0'.repeat(64),
      over.hash ?? String(over.seq ?? seq).padStart(64, 'b'),
    ],
  );

describe('schema shape', () => {
  it('has the 14 identity and vault tables (signatures arrives in Step 7)', async () => {
    const { rows } = await q(
      `SELECT count(*)::int n FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> 'schema_migrations'`,
    );
    expect([14, 15]).toContain(rows[0].n);
  });
});

describe('workspaces and document types', () => {
  it('rejects a workspace status outside OPEN, CLOSED, ARCHIVED', async () => {
    const e = await err(
      q(
        `INSERT INTO workspaces (department_id, name, status, created_by) VALUES ($1,'X','DELETED',$2)`,
        [deptId, userId],
      ),
    );
    expect(e.code).toBe(CHECK);
  });
  it('defaults a new workspace to OPEN', async () => {
    expect((await q('SELECT status FROM workspaces WHERE id = $1', [wsId])).rows[0].status).toBe(
      'OPEN',
    );
  });
  it('rejects a duplicate workspace name inside one department', async () => {
    const e = await err(
      q(`INSERT INTO workspaces (department_id, name, created_by) VALUES ($1,'Case 1',$2)`, [
        deptId,
        userId,
      ]),
    );
    expect(e.code).toBe(UNIQUE);
  });
  it('rejects a duplicate document type name inside one organisation', async () => {
    expect(
      (await err(q(`INSERT INTO document_types (org_id, name) VALUES ($1,'Contract')`, [orgId])))
        .code,
    ).toBe(UNIQUE);
  });
  it('rejects a duplicate workspace member', async () => {
    await q('INSERT INTO workspace_members (workspace_id, user_id) VALUES ($1,$2)', [wsId, userId]);
    expect(
      (
        await err(
          q('INSERT INTO workspace_members (workspace_id, user_id) VALUES ($1,$2)', [wsId, userId]),
        )
      ).code,
    ).toBe(UNIQUE);
  });
});

describe('documents', () => {
  it('rejects an unknown classification level', async () => {
    const e = await err(
      q(
        `INSERT INTO documents (workspace_id, type_id, classification, title, created_by) VALUES ($1,$2,9,'T',$3)`,
        [wsId, typeId, userId],
      ),
    );
    expect(e.code).toBe(FK);
  });
  it('rejects a blank title', async () => {
    const e = await err(
      q(
        `INSERT INTO documents (workspace_id, type_id, classification, title, created_by) VALUES ($1,$2,1,'  ',$3)`,
        [wsId, typeId, userId],
      ),
    );
    expect(e.code).toBe(CHECK);
  });
  it('does not allow an empty document type name', async () => {
    const e = await err(q(`INSERT INTO document_types (org_id, name) VALUES ($1,'  ')`, [orgId]));
    expect(e.code).toBe(CHECK);
  });
  it('prevents deleting a document even before its first version exists (BR-07)', async () => {
    const { rows } = await q(
      `INSERT INTO documents (workspace_id, type_id, classification, title, created_by)
       VALUES ($1,$2,1,'Unversioned document',$3) RETURNING id`,
      [wsId, typeId, userId],
    );
    const e = await err(q('DELETE FROM documents WHERE id = $1', [rows[0].id]));
    expect(e.code).toBe(RAISE);
    expect(e.message).toMatch(/cannot be removed/);
  });
  it('prevents TRUNCATE of documents, including CASCADE', async () => {
    expect((await err(q('TRUNCATE documents CASCADE'))).code).toBe(RAISE);
  });
  it('generates search_vec itself and refuses direct writes to it', async () => {
    const hit = await q(
      `SELECT 1 FROM documents WHERE search_vec @@ plainto_tsquery('english','ballistics')`,
    );
    expect(hit.rowCount).toBe(1);
    const e = await err(
      q(`UPDATE documents SET search_vec = to_tsvector('x') WHERE id = $1`, [docId]),
    );
    expect(e.code).toBe(GENERATED);
  });
  it('uses the GIN index for full-text search (DE-08)', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL enable_seqscan = off'); // tiny table: force the planner to show index choice
      const { rows } = await c.query(
        `EXPLAIN (FORMAT TEXT) SELECT id FROM documents WHERE search_vec @@ plainto_tsquery('english','forensic')`,
      );
      await c.query('ROLLBACK');
      expect(rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('idx_documents_search_vec');
    } finally {
      c.release();
    }
  });
});

describe('document_versions constraints', () => {
  it('accepts version 1 and rejects a duplicate (document_id, version_no)', async () => {
    await insertVersion(1);
    expect((await err(insertVersion(1))).code).toBe(UNIQUE);
  });
  it('rejects version_no below 1 and size_bytes of 0', async () => {
    expect((await err(insertVersion(0))).code).toBe(CHECK);
    expect((await err(insertVersion(2, { size: 0 }))).code).toBe(CHECK);
  });
  it.each([
    ['too short', 'abc123'],
    ['upper-case hex', 'A'.repeat(64)],
    ['non-hex characters', 'g'.repeat(64)],
  ])('rejects a sha256 that is %s', async (_n, sha) => {
    expect((await err(insertVersion(3, { sha }))).code).toBe(CHECK);
  });
  it('does not allow deleting a document that already has versions', async () => {
    const e = await err(q('DELETE FROM documents WHERE id = $1', [docId]));
    expect(e.code).toBe(RAISE);
  });
});

describe('access_grants', () => {
  const grant = (created, expires) =>
    q(
      `INSERT INTO access_grants (document_id, user_id, granted_by, created_at, expires_at) VALUES ($1,$2,$2,$3,$4)`,
      [docId, userId, created, expires],
    );
  it('rejects an expiry before (or equal to) creation', async () => {
    expect((await err(grant('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z'))).code).toBe(CHECK);
    expect((await err(grant('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'))).code).toBe(CHECK);
  });
  it('accepts a later expiry', async () => {
    expect((await err(grant('2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z'))).code).toBeUndefined();
  });
});

describe('audit_logs constraints', () => {
  it('accepts a normal row and an actor-less row (failed login by unknown user)', async () => {
    expect((await err(insertAudit())).code).toBeUndefined();
    expect(
      (await err(insertAudit({ actor: null, action: 'LOGIN_FAILED', outcome: 'FAILED' }))).code,
    ).toBeUndefined();
  });
  it('rejects a duplicate (org_id, seq)', async () => {
    await insertAudit({ seq: 500, hash: 'c'.repeat(64) });
    expect((await err(insertAudit({ seq: 500, hash: 'd'.repeat(64) }))).code).toBe(UNIQUE);
  });
  it('rejects a duplicate hash', async () => {
    await insertAudit({ seq: 501, hash: 'e'.repeat(64) });
    expect((await err(insertAudit({ seq: 502, hash: 'e'.repeat(64) }))).code).toBe(UNIQUE);
  });
  it('rejects an action outside the fixed list and an unknown outcome', async () => {
    expect((await err(insertAudit({ action: 'HACKED' }))).code).toBe(CHECK);
    expect((await err(insertAudit({ outcome: 'MAYBE' }))).code).toBe(CHECK);
  });
  it('rejects a malformed hash or prev_hash and seq below 1', async () => {
    expect((await err(insertAudit({ hash: 'zz' }))).code).toBe(CHECK);
    expect((await err(insertAudit({ prev: 'short' }))).code).toBe(CHECK);
    expect((await err(insertAudit({ seq: 0 }))).code).toBe(CHECK);
  });
});

describe('immutability triggers (BR-07, BR-11)', () => {
  it('rejects UPDATE on document_versions', async () => {
    const e = await err(
      q(`UPDATE document_versions SET sha256 = $1 WHERE document_id = $2`, ['f'.repeat(64), docId]),
    );
    expect(e.code).toBe(RAISE);
    expect(e.message).toMatch(/append-only/);
  });
  it('rejects DELETE on document_versions', async () => {
    expect(
      (await err(q('DELETE FROM document_versions WHERE document_id = $1', [docId]))).code,
    ).toBe(RAISE);
  });
  it('rejects TRUNCATE on document_versions', async () => {
    const e = await err(q('TRUNCATE document_versions'));
    expect([RAISE, '0A000']).toContain(e.code);
  });
  it('rejects UPDATE, DELETE and TRUNCATE on audit_logs', async () => {
    expect((await err(q(`UPDATE audit_logs SET outcome = 'DENIED'`))).code).toBe(RAISE);
    expect((await err(q('DELETE FROM audit_logs'))).code).toBe(RAISE);
    expect((await err(q('TRUNCATE audit_logs'))).code).toBe(RAISE);
  });
  it('still allows INSERT, and the protected rows are unchanged', async () => {
    expect((await err(insertVersion(2))).code).toBeUndefined();
    const { rows } = await q(
      'SELECT version_no, sha256 FROM document_versions WHERE document_id = $1 ORDER BY version_no',
      [docId],
    );
    expect(rows).toEqual([
      { version_no: 1, sha256: GOOD_HASH },
      { version_no: 2, sha256: GOOD_HASH },
    ]);
  });
});
