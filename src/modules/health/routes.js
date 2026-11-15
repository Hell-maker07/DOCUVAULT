import { Router } from 'express';
import { ok } from '../../utils/response.js';

const router = Router();

// Liveness only: deliberately never touches the database.
router.get('/', (_req, res) =>
  ok(res, { status: 'up', uptime: process.uptime() }, 'DocuVault API is healthy'),
);

export default router;
