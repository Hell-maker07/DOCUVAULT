import { config } from '../config/env.js';
import AppError from '../utils/AppError.js';

/**
 * Supabase Storage Adapter.
 * Communicates with private buckets on Supabase Storage via REST.
 */
export class SupabaseStorageAdapter {
  constructor(options = {}) {
    this.storageUrl = options.storageUrl || config.STORAGE_URL;
    this.serviceKey = options.serviceKey || config.STORAGE_KEY;
    this.bucket = options.bucket || config.STORAGE_BUCKET || 'docuvault';
  }

  _headers(extra = {}) {
    if (!this.storageUrl || !this.serviceKey) {
      throw new AppError(
        'Supabase storage is not configured (STORAGE_URL / STORAGE_KEY missing)',
        500,
        'STORAGE_ERROR',
      );
    }
    return {
      Authorization: `Bearer ${this.serviceKey}`,
      apikey: this.serviceKey,
      ...extra,
    };
  }

  _objectUrl(storagePath) {
    const cleanPath = storagePath.replace(/^[/\\]+/, '');
    return `${this.storageUrl.replace(/\/+$/, '')}/storage/v1/object/${this.bucket}/${cleanPath}`;
  }

  async put(storagePath, buffer, mimeType = 'application/octet-stream') {
    const url = this._objectUrl(storagePath);
    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers({
        'Content-Type': mimeType,
        'x-upsert': 'true',
      }),
      body: buffer,
    });

    if (!res.ok) {
      throw new AppError(
        `Supabase storage upload failed (${res.status}): ${await res.text()}`,
        500,
        'STORAGE_ERROR',
      );
    }

    return {
      path: storagePath,
      size: buffer.length,
      mimeType,
    };
  }

  async get(storagePath) {
    const url = `${this.storageUrl.replace(/\/+$/, '')}/storage/v1/object/authenticated/${this.bucket}/${storagePath.replace(/^[/\\]+/, '')}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this._headers(),
    });

    if (res.status === 404) {
      throw new AppError(`File not found in Supabase storage: ${storagePath}`, 404, 'NOT_FOUND');
    }

    if (!res.ok) {
      throw new AppError(
        `Supabase storage download failed (${res.status}): ${await res.text()}`,
        500,
        'STORAGE_ERROR',
      );
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const mimeType = res.headers.get('content-type') || 'application/octet-stream';

    return {
      buffer,
      size: buffer.length,
      mimeType,
      path: storagePath,
    };
  }

  async exists(storagePath) {
    try {
      const url = `${this.storageUrl.replace(/\/+$/, '')}/storage/v1/object/info/authenticated/${this.bucket}/${storagePath.replace(/^[/\\]+/, '')}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: this._headers(),
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async delete(storagePath) {
    const url = this._objectUrl(storagePath);
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this._headers(),
    });
    return res.ok;
  }
}
