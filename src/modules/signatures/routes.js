import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorizeDocument } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { documentVersionParamsSchema, signatureIdParamsSchema } from './schema.js';
import {
  signDocumentVersionHandler,
  getSignaturesHandler,
  verifySignatureByIdHandler,
  getUnsignedLatestHandler,
} from './controller.js';

const router = Router();

// Endpoint 20 (Master Doc): Records digital signature of a specific document version (AP-10, BR-12)
// Enforces: authenticate, authorizeDocument('SIGN'), valid params
router.post(
  '/documents/:id/versions/:no/sign',
  authenticate,
  validate(documentVersionParamsSchema, 'params'),
  authorizeDocument('SIGN'),
  asyncHandler(signDocumentVersionHandler),
);

// Endpoint 21 (Master Doc): Verifies and retrieves all digital signatures for a document version
// Enforces: authenticate, authorizeDocument('VIEW'), valid params
router.get(
  '/documents/:id/versions/:no/signatures',
  authenticate,
  validate(documentVersionParamsSchema, 'params'),
  authorizeDocument('VIEW'),
  asyncHandler(getSignaturesHandler),
);

// DE-05 Q06: Latest versions that nobody has signed yet
router.get(
  '/signatures/stats/unsigned-latest',
  authenticate,
  asyncHandler(getUnsignedLatestHandler),
);

// Standalone verification of an individual digital signature by primary key
router.get(
  '/signatures/:id/verify',
  authenticate,
  validate(signatureIdParamsSchema, 'params'),
  asyncHandler(verifySignatureByIdHandler),
);

export default router;
