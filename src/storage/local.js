import fs from 'node:fs/promises';
import path from 'node:path';
import AppError from '../utils/AppError.js';
import { config } from '../config/env.js';

export class LocalStorageAdapter {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      process.cwd(),
      options.rootDir || config.STORAGE_LOCAL_DIR || '.storage_vault',
    );
  }

  /**
   * Resolves and verifies that a storage path remains strictly inside the root vault directory.
   * Throws 400 if directory traversal is attempted.
   * @param {string} storagePath
   * @returns {string} Absolute system path
   */
  _resolvePath(storagePath) {
    if (!storagePath || typeof storagePath !== 'string') {
      throw new AppError('Invalid storage path', 400, 'VALIDATION_ERROR');
    }
    // Remove leading slashes to keep resolution relative to rootDir
    const normalized = storagePath.replace(/^[/\\]+/, '');
    const resolved = path.resolve(this.rootDir, normalized);
    if (!resolved.startsWith(this.rootDir)) {
      throw new AppError(
        'Illegal storage path: directory traversal detected',
        400,
        'VALIDATION_ERROR',
      );
    }
    return resolved;
  }

  /**
   * Writes file buffer to local disk.
   * @param {string} storagePath
   * @param {Buffer} buffer
   * @param {string} [mimeType='application/octet-stream']
   * @returns {Promise<{ path: string, size: number, mimeType: string }>}
   */
  async put(storagePath, buffer, mimeType = 'application/octet-stream') {
    const filePath = this._resolvePath(storagePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return {
      path: storagePath,
      size: buffer.length,
      mimeType,
    };
  }

  /**
   * Retrieves file buffer from local disk.
   * @param {string} storagePath
   * @returns {Promise<{ buffer: Buffer, size: number, path: string }>}
   */
  async get(storagePath) {
    const filePath = this._resolvePath(storagePath);
    try {
      const buffer = await fs.readFile(filePath);
      return {
        buffer,
        size: buffer.length,
        path: storagePath,
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new AppError(`File not found at storage path: ${storagePath}`, 404, 'NOT_FOUND');
      }
      throw err;
    }
  }

  /**
   * Checks whether a file exists at the given path.
   * @param {string} storagePath
   * @returns {Promise<boolean>}
   */
  async exists(storagePath) {
    try {
      const filePath = this._resolvePath(storagePath);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deletes a file from storage (used for transactional rollbacks).
   * @param {string} storagePath
   * @returns {Promise<boolean>}
   */
  async delete(storagePath) {
    try {
      const filePath = this._resolvePath(storagePath);
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }
}
