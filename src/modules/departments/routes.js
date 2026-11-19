import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { createDepartmentSchema, updateDepartmentSchema } from './schema.js';
import {
  listDepartmentsHandler,
  createDepartmentHandler,
  updateDepartmentHandler,
} from './controller.js';

const router = Router();

router.use(authenticate, requirePermission('MANAGE_ORG'));

router.get('/', asyncHandler(listDepartmentsHandler));
router.post('/', validate(createDepartmentSchema), asyncHandler(createDepartmentHandler));
router.patch('/:id', validate(updateDepartmentSchema), asyncHandler(updateDepartmentHandler));

export default router;
