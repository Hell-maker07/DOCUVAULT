import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import healthRoutes from './modules/health/routes.js';
import orgsRoutes from './modules/orgs/routes.js';
import authRoutes from './modules/auth/routes.js';
import usersRoutes from './modules/users/routes.js';
import departmentsRoutes from './modules/departments/routes.js';
import positionsRoutes from './modules/positions/routes.js';
import auditRoutes from './modules/audit/routes.js';
import signaturesRoutes from './modules/signatures/routes.js';
import workspacesRoutes from './modules/workspaces/routes.js';
import documentsRoutes from './modules/documents/routes.js';
import documentTypesRoutes from './modules/documents/documentTypesRoutes.js';
import { notFound, errorHandler } from './middlewares/error.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.tailwindcss.com'],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'self'", 'vscode-webview:', '*'],
        },
      },
      xFrameOptions: false,
    }),
  );
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.use(express.static(publicDir));
  app.get('/login', (_req, res) => res.sendFile(path.join(publicDir, 'login.html')));
  app.get('/register', (_req, res) => res.sendFile(path.join(publicDir, 'register.html')));
  app.get('/dashboard', (_req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
  app.get('/admin', (_req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
  app.get('/home', (_req, res) => res.sendFile(path.join(publicDir, 'home.html')));
  app.get('/vault', (_req, res) => res.sendFile(path.join(publicDir, 'home.html')));

  app.use('/api/v1/health', healthRoutes);
  app.use('/api/v1/orgs', orgsRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1/departments', departmentsRoutes);
  app.use('/api/v1/positions', positionsRoutes);
  app.use('/api/v1/audit', auditRoutes);
  app.use('/api/v1/workspaces', workspacesRoutes);
  app.use('/api/v1/documents', documentsRoutes);
  app.use('/api/v1/document-types', documentTypesRoutes);
  app.use('/api/v1', signaturesRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
