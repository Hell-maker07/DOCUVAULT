import { ok, created } from '../../utils/response.js';
import * as service from './service.js';

export async function listUsersHandler(req, res) {
  const users = await service.getOrgUsers(req.user.orgId);
  return ok(res, users, 'Users retrieved');
}

export async function getUserHandler(req, res) {
  const user = await service.getOrgUserById(req.params.id, req.user.orgId);
  return ok(res, user, 'User retrieved');
}

export async function createUserHandler(req, res) {
  const user = await service.createOrgUser(req.user, req.body, req.ip);
  return created(res, user, 'User enrolled successfully');
}

export async function updateUserHandler(req, res) {
  const user = await service.updateOrgUser(req.user, req.params.id, req.body, req.ip);
  return ok(res, user, 'User updated successfully');
}

export async function deleteUserHandler(req, res) {
  const result = await service.deactivateOrgUser(req.user, req.params.id, req.ip);
  return ok(res, result, 'User deactivated successfully');
}
