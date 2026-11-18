import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/auth.js';
import { requirePermission, authorizeWorkspace } from '../../middlewares/authorize.js';
import { fileUpload } from '../../middlewares/upload.js';
import { validate } from '../../middlewares/validate.js';
import {
  createWorkspaceSchema,
  updateWorkspaceStatusSchema,
  addWorkspaceMemberSchema,
  workspaceIdParamSchema,
} from './schema.js';
import { uploadDocumentBodySchema } from '../documents/schema.js';
import {
  createWorkspaceHandler,
  listWorkspacesHandler,
  getWorkspaceHandler,
  updateWorkspaceStatusHandler,
  addWorkspaceMemberHandler,
} from './controller.js';
import { uploadDocumentHandler } from '../documents/controller.js';

const router = Router();

// Create workspace in a department (request 10, AP-04)
router.post(
  '/',
  authenticate,
  requirePermission('UPLOAD'),
  validate(createWorkspaceSchema, 'body'),
  asyncHandler(createWorkspaceHandler),
);

// List reachable workspaces for authenticated caller (request 11, AP-04)
router.get('/', authenticate, asyncHandler(listWorkspacesHandler));

// Get single workspace details (AP-04)
router.get(
  '/:id',
  authenticate,
  validate(workspaceIdParamSchema, 'params'),
  asyncHandler(getWorkspaceHandler),
);

// Update workspace lifecycle status (request 12, AP-04, BR-14)
router.patch(
  '/:id/status',
  authenticate,
  validate(workspaceIdParamSchema, 'params'),
  validate(updateWorkspaceStatusSchema, 'body'),
  asyncHandler(updateWorkspaceStatusHandler),
);

// Assign a user as workspace member (request 13, AP-04)
router.post(
  '/:id/members',
  authenticate,
  validate(workspaceIdParamSchema, 'params'),
  validate(addWorkspaceMemberSchema, 'body'),
  asyncHandler(addWorkspaceMemberHandler),
);

// Upload a file as version 1 of a new document in this workspace (request 14, AP-05)
// Notice: fileUpload must run before authorizeWorkspace so req.body.classification is parsed
router.post(
  '/:id/documents',
  authenticate,
  fileUpload({ fieldName: 'file', required: true }),
  validate(uploadDocumentBodySchema, 'body'),
  authorizeWorkspace('UPLOAD'),
  asyncHandler(uploadDocumentHandler),
);

export default router;
