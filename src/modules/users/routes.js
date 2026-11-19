import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { createUserSchema, updateUserSchema } from './schema.js';
import {
  listUsersHandler,
  getUserHandler,
  createUserHandler,
  updateUserHandler,
  deleteUserHandler,
} from './controller.js';

const router = Router();

// All user management routes require valid authentication and MANAGE_ORG permission
router.use(authenticate, requirePermission('MANAGE_ORG'));

router.get('/', asyncHandler(listUsersHandler));
router.get('/:id', asyncHandler(getUserHandler));
router.post('/', validate(createUserSchema), asyncHandler(createUserHandler));
router.patch('/:id', validate(updateUserSchema), asyncHandler(updateUserHandler));
router.delete('/:id', asyncHandler(deleteUserHandler));

export default router;
