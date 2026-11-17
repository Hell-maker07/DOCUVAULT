import { ok, created } from '../../utils/response.js';
import AppError from '../../utils/AppError.js';
import {
  signDocumentVersion,
  getSignaturesForVersion,
  verifySignatureById,
  getUnsignedLatest,
} from './service.js';

/**
 * Handles digital signing of a document version (POST /documents/:id/versions/:no/sign - request 20).
 */
export async function signDocumentVersionHandler(req, res) {
  const documentId = req.params.id;
  const versionNo = Number(req.params.no);
  const signerId = req.user.id;

  const result = await signDocumentVersion({
    documentId,
    versionNo,
    signerId,
    ip: req.ip,
  });

  return created(res, result, 'Document version signed successfully');
}

/**
 * Handles fetching and verifying all signatures on a document version (GET /documents/:id/versions/:no/signatures - request 21).
 */
export async function getSignaturesHandler(req, res) {
  const documentId = req.params.id;
  const versionNo = Number(req.params.no);

  const result = await getSignaturesForVersion({
    documentId,
    versionNo,
  });

  return ok(res, result, 'Document version signatures retrieved and verified');
}

/**
 * Handles standalone verification of an individual signature by ID (GET /signatures/:id/verify).
 */
export async function verifySignatureByIdHandler(req, res) {
  const signatureId = req.params.id;
  const result = await verifySignatureById(signatureId);

  return ok(res, result, 'Signature verification completed');
}

/**
 * Handles fetching latest versions with zero signatures (GET /signatures/stats/unsigned-latest - DE-05 Q06).
 */
export async function getUnsignedLatestHandler(req, res) {
  const orgId = req.policyUser?.orgId || req.user?.orgId;
  if (!orgId) {
    throw new AppError('Organisation context missing', 400, 'VALIDATION_ERROR');
  }

  const result = await getUnsignedLatest(orgId);
  return ok(res, result, 'Unsigned latest versions (DE-05 Q06)');
}
