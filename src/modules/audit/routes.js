import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/auth.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { auditQuerySchema } from './schema.js';
import {
  getAuditLogsHandler,
  verifyChainHandler,
  getAuditRowBySeqHandler,
  getDeniedStatsHandler,
  getActiveUsersStatsHandler,
  verifyAllFilesHandler,
} from './controller.js';

const router = Router();

// Enforce authentication and AUDIT permission on all audit endpoints (AP-03, AP-08)
router.use(authenticate, requirePermission('AUDIT'));

router.get('/verify-chain', asyncHandler(verifyChainHandler));
router.post('/verify-all', asyncHandler(verifyAllFilesHandler));
router.get('/stats/denied-by-position', asyncHandler(getDeniedStatsHandler));
router.get('/stats/active-users', asyncHandler(getActiveUsersStatsHandler));
router.get('/:seq(\\d+)', asyncHandler(getAuditRowBySeqHandler));
router.get('/', validate(auditQuerySchema, 'query'), asyncHandler(getAuditLogsHandler));

export default router;
