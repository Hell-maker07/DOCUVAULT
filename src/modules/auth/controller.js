import { ok } from '../../utils/response.js';
import { login, getMe } from './service.js';

export async function loginHandler(req, res) {
  const data = await login(req.body, req.ip);
  return ok(res, data, 'Login successful');
}

export async function meHandler(req, res) {
  const data = await getMe(req.user.id);
  return ok(res, data, 'Current user profile');
}
