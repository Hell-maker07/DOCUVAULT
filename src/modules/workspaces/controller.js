import { ok, created } from '../../utils/response.js';
import {
  createWorkspace,
  listReachableWorkspaces,
  getWorkspaceDetails,
  changeWorkspaceStatus,
  addWorkspaceMember,
} from './service.js';

export async function createWorkspaceHandler(req, res) {
  const data = await createWorkspace({
    ...req.body,
    user: req.user,
    ip: req.ip,
  });
  return created(res, data, 'Workspace created successfully');
}

export async function listWorkspacesHandler(req, res) {
  const data = await listReachableWorkspaces(req.user);
  return ok(res, data, 'Workspaces retrieved');
}

export async function getWorkspaceHandler(req, res) {
  const data = await getWorkspaceDetails(req.params.id, req.user);
  return ok(res, data, 'Workspace details');
}

export async function updateWorkspaceStatusHandler(req, res) {
  const data = await changeWorkspaceStatus({
    workspaceId: req.params.id,
    status: req.body.status,
    user: req.user,
    ip: req.ip,
  });
  return ok(res, data, 'Workspace status updated');
}

export async function addWorkspaceMemberHandler(req, res) {
  const data = await addWorkspaceMember({
    workspaceId: req.params.id,
    targetUserId: req.body.userId,
    user: req.user,
    ip: req.ip,
  });
  return created(res, data, 'Member assigned to workspace');
}
