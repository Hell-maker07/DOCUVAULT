import { ok, created } from '../../utils/response.js';
import * as service from './service.js';

export async function listPositionsHandler(req, res) {
  const positions = await service.getPositions(req.user.orgId);
  return ok(res, positions, 'Positions retrieved');
}

export async function createPositionHandler(req, res) {
  const pos = await service.createPosition(req.user, req.body, req.ip);
  return created(res, pos, 'Position created successfully');
}

export async function updatePositionHandler(req, res) {
  const pos = await service.updatePosition(req.user, req.params.id, req.body, req.ip);
  return ok(res, pos, 'Position updated successfully');
}
