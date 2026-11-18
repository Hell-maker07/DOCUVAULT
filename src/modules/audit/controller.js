import { ok } from '../../utils/response.js';
import AppError from '../../utils/AppError.js';
import {
  verifyAuditChain,
  listAuditLogs,
  getAuditRowBySeq,
  getDeniedStats,
  getActiveUsersStats,
} from './service.js';

export async function getAuditLogsHandler(req, res) {
  const orgId = req.policyUser?.orgId || req.user?.orgId;
  if (!orgId) {
    throw new AppError('Organisation context missing', 400, 'VALIDATION_ERROR');
  }

  const result = await listAuditLogs({
    ...req.query,
    orgId,
  });

  return ok(res, result, 'Audit logs retrieved');
}

export async function verifyChainHandler(req, res) {
  const orgId = req.policyUser?.orgId || req.user?.orgId;
  if (!orgId) {
    throw new AppError('Organisation context missing', 400, 'VALIDATION_ERROR');
  }

  const result = await verifyAuditChain(orgId);
  return ok(
    res,
    result,
    result.verified ? 'Audit chain verified successfully' : 'Audit chain verification failed',
  );
}

export async function getAuditRowBySeqHandler(req, res) {
  const orgId = req.policyUser?.orgId || req.user?.orgId;
  if (!orgId) {
    throw new AppError('Organisation context missing', 400, 'VALIDATION_ERROR');
  }

  const seq = parseInt(req.params.seq, 10);
  if (isNaN(seq) || seq < 1) {
    throw new AppError('Invalid sequence number', 400, 'VALIDATION_ERROR');
  }

  const row = await getAuditRowBySeq(orgId, seq);
  if (!row) {
    throw new AppError(`Audit entry not found at sequence ${seq}`, 404, 'NOT_FOUND');
  }

  return ok(res, row, 'Audit entry retrieved');
}

export async function getDeniedStatsHandler(req, res) {
  const orgId = req.policyUser?.orgId || req.user?.orgId;
  if (!orgId) {
    throw new AppError('Organisation context missing', 400, 'VALIDATION_ERROR');
  }

  const data = await getDeniedStats(orgId);
  return ok(res, data, 'Denied access attempts per position (Q07)');
}

export async function getActiveUsersStatsHandler(req, res) {
  const orgId = req.policyUser?.orgId || req.user?.orgId;
  if (!orgId) {
    throw new AppError('Organisation context missing', 400, 'VALIDATION_ERROR');
  }

  const days = req.query.days ? parseInt(req.query.days, 10) : 30;
  const data = await getActiveUsersStats(orgId, days);
  return ok(res, data, 'Most active users (Q08)');
}

export async function verifyAllFilesHandler(req, res) {
  const orgId = req.policyUser?.orgId || req.user?.orgId;
  const actorId = req.user?.id;
  if (!orgId) {
    throw new AppError('Organisation context missing', 400, 'VALIDATION_ERROR');
  }

  const { verifyAllOrganisationFiles } = await import('../documents/service.js');
  const data = await verifyAllOrganisationFiles(orgId, actorId, req.ip);
  return ok(res, data, 'Batch file integrity verification complete');
}
