import { ok, created } from '../../utils/response.js';
import * as service from './service.js';

export async function listDepartmentsHandler(req, res) {
  const depts = await service.getDepartments(req.user.orgId);
  return ok(res, depts, 'Departments retrieved');
}

export async function createDepartmentHandler(req, res) {
  const dept = await service.createDepartment(req.user, req.body, req.ip);
  return created(res, dept, 'Department created successfully');
}

export async function updateDepartmentHandler(req, res) {
  const dept = await service.updateDepartment(req.user, req.params.id, req.body, req.ip);
  return ok(res, dept, 'Department updated successfully');
}
