import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { createPositionSchema, updatePositionSchema } from './schema.js';
import {
  listPositionsHandler,
  createPositionHandler,
  updatePositionHandler,
} from './controller.js';

const router = Router();

router.use(authenticate, requirePermission('MANAGE_ORG'));

router.get('/', asyncHandler(listPositionsHandler));
router.post('/', validate(createPositionSchema), asyncHandler(createPositionHandler));
router.patch('/:id', validate(updatePositionSchema), asyncHandler(updatePositionHandler));

export default router;
