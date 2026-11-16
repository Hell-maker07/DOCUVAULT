import { jest } from '@jest/globals';
import { errorHandler } from '../src/middlewares/error.js';

const run = (err) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  errorHandler(err, {}, res, () => {});
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
};

describe('Postgres error translation', () => {
  it.each([
    ['23505', 409, 'CONFLICT'],
    ['23503', 400, 'VALIDATION_ERROR'],
    ['23001', 409, 'CONFLICT'], // ON DELETE RESTRICT on PostgreSQL 18+
    ['23514', 400, 'VALIDATION_ERROR'],
    ['P0001', 409, 'CONFLICT'], // append-only trigger exception
  ])('maps SQLSTATE %s to HTTP %i %s', (sqlState, status, code) => {
    const out = run(Object.assign(new Error('db'), { code: sqlState }));
    expect(out.status).toBe(status);
    expect(out.body).toMatchObject({ success: false, error: { code } });
  });

  it('hides unexpected errors behind a generic 500', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = run(new Error('secret stack detail'));
    spy.mockRestore();
    expect(out.status).toBe(500);
    expect(JSON.stringify(out.body)).not.toContain('secret');
  });
});
