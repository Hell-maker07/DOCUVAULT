import { ok, created } from '../../utils/response.js';
import { getPool } from '../../config/db.js';
import { loadUser } from '../../policy/decide.js';
import {
  uploadDocument,
  uploadNewVersion,
  downloadDocumentVersion,
  verifyDocumentIntegrity,
  getDocumentDetails,
  searchDocuments,
  createDocumentType,
  listDocumentTypes,
  getDeptClassificationStats,
  getMultiVersionDocs,
  getRankedPositions,
} from './service.js';

export async function uploadDocumentHandler(req, res) {
  const workspaceId = req.params.id || req.params.workspaceId;
  const user = req.policyUser || req.user;

  const data = await uploadDocument({
    workspaceId,
    title: req.body.title,
    typeId: req.body.typeId,
    classification: req.body.classification,
    description: req.body.description,
    file: req.file,
    user,
    ip: req.ip,
  });

  return created(res, data, 'Document uploaded successfully');
}

export async function uploadVersionHandler(req, res) {
  const documentId = req.params.id;
  const user = req.policyUser || req.user;

  const data = await uploadNewVersion({
    documentId,
    file: req.file,
    changeNote: req.body.changeNote,
    user,
    ip: req.ip,
  });

  return created(res, data, 'Version uploaded successfully');
}

export async function downloadVersionHandler(req, res) {
  const documentId = req.params.id;
  const versionNo = Number(req.params.no);
  const user = req.policyUser || req.user;

  const fileData = await downloadDocumentVersion({
    documentId,
    versionNo,
    user,
    ip: req.ip,
  });

  res.setHeader('Content-Type', fileData.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileData.fileName}"`);
  res.setHeader('Content-Length', fileData.size);
  res.setHeader('X-DocuVault-SHA256', fileData.sha256);
  res.setHeader('X-DocuVault-Integrity', 'VERIFIED');

  return res.send(fileData.buffer);
}

export async function verifyDocumentHandler(req, res) {
  const documentId = req.params.id;
  const user = req.policyUser || req.user;

  const data = await verifyDocumentIntegrity({
    documentId,
    user,
    ip: req.ip,
  });

  return ok(res, data, 'Document integrity verification complete');
}

export async function getDocumentDetailsHandler(req, res) {
  const documentId = req.params.id;
  const user = req.policyUser || req.user;

  const data = await getDocumentDetails({
    documentId,
    user,
    ip: req.ip,
  });

  return ok(res, data, 'Document details');
}

export async function searchDocumentsHandler(req, res) {
  const user = req.policyUser || (await loadUser(getPool(), req.user.id));

  const data = await searchDocuments({
    user,
    filters: req.query,
  });

  return ok(res, data, 'Documents retrieved');
}

export async function createDocumentTypeHandler(req, res) {
  const data = await createDocumentType({
    orgId: req.user.orgId,
    name: req.body.name,
  });

  return created(res, data, 'Document type created');
}

export async function listDocumentTypesHandler(req, res) {
  const data = await listDocumentTypes(req.user.orgId);
  return ok(res, data, 'Document types retrieved');
}

export async function getDeptClassificationStatsHandler(req, res) {
  const data = await getDeptClassificationStats(req.user.orgId);
  return ok(res, data, 'Documents per department per classification level (Q01)');
}

export async function getMultiVersionDocsHandler(req, res) {
  const min = req.query.min ? Number(req.query.min) : 3;
  const data = await getMultiVersionDocs(req.user.orgId, min);
  return ok(res, data, 'Documents with multiple versions (Q05)');
}

export async function getRankedPositionsHandler(req, res) {
  const data = await getRankedPositions(req.user.orgId);
  return ok(res, data, 'Positions ranked by documents opened (Q12)');
}
