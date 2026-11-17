import multer from 'multer';
import { config } from '../config/env.js';
import AppError from '../utils/AppError.js';
import { sha256 } from '../utils/hash.js';

export const ALLOWED_MIME_TYPES = Object.freeze([
  // PDF
  'application/pdf',
  // Word & OpenDocument
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  // Spreadsheets
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  // Presentations
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Plain text & structured data
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/rtf',
  'application/json',
  'application/xml',
  'text/xml',
  // Images (evidence / scans)
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
]);

/**
 * Creates an Express middleware for single-file uploads using Multer in-memory storage.
 * Enforces file size limits (MAX_UPLOAD_MB), validates MIME types, and automatically
 * calculates the SHA-256 fingerprint on req.file.buffer.
 *
 * @param {object} [options]
 * @param {string} [options.fieldName='file'] Form field name
 * @param {number} [options.maxMb=config.MAX_UPLOAD_MB] Max file size in megabytes
 * @param {string[]} [options.allowedMimes=ALLOWED_MIME_TYPES] Permitted MIME types
 * @param {boolean} [options.required=true] Whether a file is mandatory
 * @returns {import('express').RequestHandler}
 */
export function fileUpload(options = {}) {
  const {
    fieldName = 'file',
    maxMb = config.MAX_UPLOAD_MB,
    allowedMimes = ALLOWED_MIME_TYPES,
    required = true,
  } = options;

  const maxSizeBytes = Math.max(1, Math.floor(maxMb * 1024 * 1024));

  const uploadInstance = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxSizeBytes,
      files: 1,
    },
    fileFilter: (_req, file, cb) => {
      if (allowedMimes.length > 0 && !allowedMimes.includes(file.mimetype)) {
        return cb(
          new AppError(
            `Unsupported file type '${file.mimetype}'. Allowed types: ${allowedMimes.slice(0, 5).join(', ')}...`,
            415,
            'UNSUPPORTED_TYPE',
          ),
        );
      }
      cb(null, true);
    },
  }).single(fieldName);

  return (req, res, next) => {
    uploadInstance(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(
              new AppError(
                `File exceeds the maximum upload limit of ${maxMb}MB`,
                413,
                'FILE_TOO_LARGE',
              ),
            );
          }
          return next(new AppError(err.message, 400, 'VALIDATION_ERROR'));
        }
        return next(err);
      }

      if (required && !req.file) {
        return next(
          new AppError(`File is required in field '${fieldName}'`, 400, 'VALIDATION_ERROR'),
        );
      }

      if (req.file) {
        // Compute SHA-256 fingerprint immediately upon receiving bytes in memory
        req.file.sha256 = sha256(req.file.buffer);
      }

      next();
    });
  };
}
