import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import healthRoutes from './modules/health/routes.js';
import { notFound, errorHandler } from './middlewares/error.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/v1/health', healthRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
