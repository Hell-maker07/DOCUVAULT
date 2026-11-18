import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorizeDocument } from '../../middlewares/authorize.js';
import { fileUpload } from '../../middlewares/upload.js';
import { validate } from '../../middlewares/validate.js';
import {
  uploadVersionBodySchema,
  searchDocumentsQuerySchema,
  documentIdParamSchema,
  documentVersionParamSchema,
} from './schema.js';
import {
  uploadVersionHandler,
  downloadVersionHandler,
  verifyDocumentHandler,
  getDocumentDetailsHandler,
  searchDocumentsHandler,
  getDeptClassificationStatsHandler,
  getMultiVersionDocsHandler,
  getRankedPositionsHandler,
} from './controller.js';

const router = Router();

// Search and list accessible documents with full-text search and clearance filter (request 16, AP-09)
router.get(
  '/',
  authenticate,
  validate(searchDocumentsQuerySchema, 'query'),
  asyncHandler(searchDocumentsHandler),
);

// DE-05 Analytics routes
router.get(
  '/stats/dept-classification',
  authenticate,
  asyncHandler(getDeptClassificationStatsHandler),
);
router.get('/stats/multi-versions', authenticate, asyncHandler(getMultiVersionDocsHandler));
router.get('/stats/ranked-positions', authenticate, asyncHandler(getRankedPositionsHandler));

// Get document metadata, version history, and signatures (request 17)
router.get(
  '/:id',
  authenticate,
  validate(documentIdParamSchema, 'params'),
  authorizeDocument('VIEW'),
  asyncHandler(getDocumentDetailsHandler),
);

// Upload a new version of an existing document (request 15, AP-06)
router.post(
  '/:id/versions',
  authenticate,
  fileUpload({ fieldName: 'file', required: true }),
  validate(documentIdParamSchema, 'params'),
  validate(uploadVersionBodySchema, 'body'),
  authorizeDocument('EDIT'),
  asyncHandler(uploadVersionHandler),
);

// Verified download of a specific document version (request 18, AP-07)
router.get(
  '/:id/versions/:no/download',
  authenticate,
  validate(documentVersionParamSchema, 'params'),
  authorizeDocument('VIEW'),
  asyncHandler(downloadVersionHandler),
);

// Re-hash all versions of a document against storage to verify integrity (request 19, AP-07)
router.post(
  '/:id/verify',
  authenticate,
  validate(documentIdParamSchema, 'params'),
  authorizeDocument('VIEW'),
  asyncHandler(verifyDocumentHandler),
);

export default router;
