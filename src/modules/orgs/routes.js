import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middlewares/validate.js';
import { authRateLimiter } from '../../middlewares/rateLimit.js';
import { registerOrgSchema } from './schema.js';
import { registerOrgHandler } from './controller.js';

const router = Router();

router.post(
  '/',
  authRateLimiter,
  validate(registerOrgSchema),
  asyncHandler(registerOrgHandler),
);

export default router;
