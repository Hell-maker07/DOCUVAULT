import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import healthRoutes from './modules/health/routes.js';
import orgsRoutes from './modules/orgs/routes.js';
import authRoutes from './modules/auth/routes.js';
import auditRoutes from './modules/audit/routes.js';
import signaturesRoutes from './modules/signatures/routes.js';
import workspacesRoutes from './modules/workspaces/routes.js';
import documentsRoutes from './modules/documents/routes.js';
import documentTypesRoutes from './modules/documents/documentTypesRoutes.js';
import { notFound, errorHandler } from './middlewares/error.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/v1/health', healthRoutes);
  app.use('/api/v1/orgs', orgsRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/audit', auditRoutes);
  app.use('/api/v1/workspaces', workspacesRoutes);
  app.use('/api/v1/documents', documentsRoutes);
  app.use('/api/v1/document-types', documentTypesRoutes);
  app.use('/api/v1', signaturesRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
