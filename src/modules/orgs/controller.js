import { registerOrganization } from './service.js';
import { created } from '../../utils/response.js';

export async function registerOrgHandler(req, res) {
  const data = await registerOrganization(req.body, req.ip);
  return created(res, data, 'Organisation registered successfully');
}
