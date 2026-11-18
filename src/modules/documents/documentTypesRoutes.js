import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/auth.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { createDocumentTypeSchema } from './schema.js';
import { createDocumentTypeHandler, listDocumentTypesHandler } from './controller.js';

const router = Router();

router.use(authenticate);

// List document types for organisation
router.get('/', asyncHandler(listDocumentTypesHandler));

// Create document type (request 8)
router.post(
  '/',
  requirePermission('MANAGE_ORG'),
  validate(createDocumentTypeSchema, 'body'),
  asyncHandler(createDocumentTypeHandler),
);

export default router;
