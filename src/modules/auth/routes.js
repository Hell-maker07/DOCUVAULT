import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middlewares/validate.js';
import { authRateLimiter } from '../../middlewares/rateLimit.js';
import { authenticate } from '../../middlewares/auth.js';
import { loginSchema } from './schema.js';
import { loginHandler, meHandler } from './controller.js';

const router = Router();

router.post(
  '/login',
  authRateLimiter,
  validate(loginSchema),
  asyncHandler(loginHandler),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(meHandler),
);

export default router;
