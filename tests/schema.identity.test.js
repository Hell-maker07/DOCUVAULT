import { execFileSync } from 'node:child_process';
import pg from 'pg';

// Acceptance tests for DE-02 on the identity tables: the database itself must reject bad data.
let pool;
const q = (text, params) => pool.query(text, params);
const code = async (promise) => {
  try {
    await promise;
    return null;
  } catch (e) {
    return e.code;
  }
};
const UNIQUE = '23505',
  FK = '23503',
  RESTRICT_CODES = ['23001', '23503'],
  CHECK = '23514';

let orgId, deptId, posId;
const user = (over = {}) => [
  over.email ?? `u${Math.random().toString(36).slice(2)}@x.test`,
  'Test User',
  'hash',
  'pub',
  'enc',
];
const insertUser = (email, dept = deptId, pos = posId) =>
  q(
    `INSERT INTO users (department_id, position_id, email, full_name, password_hash, public_key, private_key_enc)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [dept, pos, ...user({ email })],
  );

beforeAll(async () => {
  execFileSync('node', ['scripts/db.js', 'reset'], {
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'pipe',
  });
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST });
  orgId = (
    await q(`INSERT INTO organizations (name, org_type) VALUES ('Org A','CORPORATE') RETURNING id`)
  ).rows[0].id;
  deptId = (
    await q(
      `INSERT INTO departments (org_id, code, name) VALUES ($1,'FIN','Finance') RETURNING id`,
      [orgId],
    )
  ).rows[0].id;
  posId = (
    await q(
      `INSERT INTO positions (org_id, title, clearance_level, dept_scope) VALUES ($1,'CFO',4,'OWN_DEPT') RETURNING id`,
      [orgId],
    )
  ).rows[0].id;
}, 30_000);
afterAll(() => pool.end());

describe('reference seed', () => {
  it('loads 4 classification levels and 7 permissions', async () => {
    expect((await q('SELECT count(*)::int n FROM classification_levels')).rows[0].n).toBe(4);
    expect((await q('SELECT count(*)::int n FROM permissions')).rows[0].n).toBe(7);
  });
  it('has no DELETE permission', async () => {
    expect((await q(`SELECT 1 FROM permissions WHERE code = 'DELETE'`)).rowCount).toBe(0);
  });
});

describe('uniqueness', () => {
  it('rejects a duplicate organisation name', async () => {
    expect(
      await code(q(`INSERT INTO organizations (name, org_type) VALUES ('Org A','OTHER')`)),
    ).toBe(UNIQUE);
  });
  it('rejects a duplicate department code inside one organisation but allows it in another', async () => {
    expect(
      await code(
        q(`INSERT INTO departments (org_id, code, name) VALUES ($1,'FIN','Dup')`, [orgId]),
      ),
    ).toBe(UNIQUE);
    const other = (
      await q(`INSERT INTO organizations (name, org_type) VALUES ('Org B','OTHER') RETURNING id`)
    ).rows[0].id;
    expect(
      await code(
        q(`INSERT INTO departments (org_id, code, name) VALUES ($1,'FIN','Finance B')`, [other]),
      ),
    ).toBeNull();
  });
  it('rejects a duplicate position title inside one organisation', async () => {
    expect(
      await code(
        q(
          `INSERT INTO positions (org_id, title, clearance_level, dept_scope) VALUES ($1,'CFO',1,'ORG')`,
          [orgId],
        ),
      ),
    ).toBe(UNIQUE);
  });
  it('rejects a duplicate user email', async () => {
    await insertUser('dup@x.test');
    expect(await code(insertUser('dup@x.test'))).toBe(UNIQUE);
  });
  it('rejects a duplicate (position, permission) pair', async () => {
    const perm = (await q(`SELECT id FROM permissions WHERE code = 'VIEW'`)).rows[0].id;
    await q('INSERT INTO position_permissions VALUES ($1,$2)', [posId, perm]);
    expect(await code(q('INSERT INTO position_permissions VALUES ($1,$2)', [posId, perm]))).toBe(
      UNIQUE,
    );
  });
});

describe('CHECK constraints', () => {
  it('rejects a position scope other than ORG, OWN_DEPT or ASSIGNED', async () => {
    expect(
      await code(
        q(
          `INSERT INTO positions (org_id, title, clearance_level, dept_scope) VALUES ($1,'Bad',1,'GLOBAL')`,
          [orgId],
        ),
      ),
    ).toBe(CHECK);
  });
  it('rejects classification levels outside 1..4', async () => {
    expect(await code(q(`INSERT INTO classification_levels VALUES (5, 'Secret')`))).toBe(CHECK);
    expect(await code(q(`INSERT INTO classification_levels VALUES (0, 'Zero')`))).toBe(CHECK);
  });
  it('rejects a non-lower-case email', async () => {
    expect(await code(insertUser('Upper@X.test'))).toBe(CHECK);
  });
  it('rejects blank names', async () => {
    expect(await code(q(`INSERT INTO organizations (name, org_type) VALUES ('   ','OTHER')`))).toBe(
      CHECK,
    );
  });
});

describe('foreign keys and delete rules', () => {
  it('rejects a position with an unknown clearance level', async () => {
    expect(
      await code(
        q(
          `INSERT INTO positions (org_id, title, clearance_level, dept_scope) VALUES ($1,'X',9,'ORG')`,
          [orgId],
        ),
      ),
    ).toBe(FK);
  });
  it('rejects a user pointing at a missing department', async () => {
    expect(await code(insertUser('nofk@x.test', '00000000-0000-0000-0000-000000000000'))).toBe(FK);
  });
  it('RESTRICTs deleting an organisation that still has departments', async () => {
    expect(RESTRICT_CODES).toContain(
      await code(q('DELETE FROM organizations WHERE id = $1', [orgId])),
    );
  });
  it('CASCADEs position_permissions when a position is deleted', async () => {
    const p = (
      await q(
        `INSERT INTO positions (org_id, title, clearance_level, dept_scope) VALUES ($1,'Temp',1,'ORG') RETURNING id`,
        [orgId],
      )
    ).rows[0].id;
    const perm = (await q(`SELECT id FROM permissions WHERE code = 'EDIT'`)).rows[0].id;
    await q('INSERT INTO position_permissions VALUES ($1,$2)', [p, perm]);
    await q('DELETE FROM positions WHERE id = $1', [p]);
    expect(
      (await q('SELECT 1 FROM position_permissions WHERE position_id = $1', [p])).rowCount,
    ).toBe(0);
  });
});

describe('users.updated_at trigger', () => {
  it('advances updated_at on UPDATE', async () => {
    await insertUser('touch@x.test');
    const before = (await q(`SELECT updated_at FROM users WHERE email = 'touch@x.test'`)).rows[0]
      .updated_at;
    await new Promise((r) => setTimeout(r, 15));
    await q(`UPDATE users SET full_name = 'Changed' WHERE email = 'touch@x.test'`);
    const after = (await q(`SELECT updated_at FROM users WHERE email = 'touch@x.test'`)).rows[0]
      .updated_at;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});
