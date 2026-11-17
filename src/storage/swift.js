import { config } from '../config/env.js';
import AppError from '../utils/AppError.js';

/**
 * OpenStack Swift Object Storage Adapter.
 * Provides private bucket storage with support for direct token auth,
 * Swift v1 (TempAuth), and OpenStack Keystone v3 authentication.
 */
export class SwiftStorageAdapter {
  constructor(options = {}) {
    this.authUrl = options.authUrl || config.SWIFT_AUTH_URL;
    this.username = options.username || config.SWIFT_USERNAME;
    this.password = options.password || config.SWIFT_PASSWORD;
    this.projectName = options.projectName || config.SWIFT_PROJECT_NAME;
    this.projectDomain = options.projectDomain || config.SWIFT_PROJECT_DOMAIN_NAME || 'Default';
    this.userDomain = options.userDomain || config.SWIFT_USER_DOMAIN_NAME || 'Default';
    this.storageUrl = options.storageUrl || config.SWIFT_STORAGE_URL;
    this.authToken = options.authToken || config.SWIFT_AUTH_TOKEN;
    this.container = options.container || config.SWIFT_CONTAINER || 'docuvault';

    this._containerEnsured = false;
  }

  /**
   * Helper to encode storage path components cleanly for Swift URLs.
   * @param {string} storagePath
   * @returns {string} URL-encoded path
   */
  _encodePath(storagePath) {
    return storagePath
      .replace(/^[/\\]+/, '')
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
  }

  /**
   * Authenticates against OpenStack Swift / Keystone if token or storageUrl is not yet set.
   * Supports Keystone v3, TempAuth v1.0, or pre-configured tokens.
   */
  async authenticate() {
    // 1. Direct pre-configured credentials
    if (this.storageUrl && this.authToken) {
      return { storageUrl: this.storageUrl, authToken: this.authToken };
    }

    if (!this.authUrl) {
      throw new AppError(
        'Swift authentication failed: neither SWIFT_STORAGE_URL nor SWIFT_AUTH_URL is configured',
        500,
        'STORAGE_ERROR',
      );
    }

    // 2. Keystone v3 authentication
    if (this.authUrl.includes('/v3') || this.projectName) {
      const payload = {
        auth: {
          identity: {
            methods: ['password'],
            password: {
              user: {
                name: this.username,
                domain: { name: this.userDomain },
                password: this.password,
              },
            },
          },
          scope: {
            project: {
              name: this.projectName,
              domain: { name: this.projectDomain },
            },
          },
        },
      };

      const res = await fetch(`${this.authUrl.replace(/\/+$/, '')}/auth/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new AppError(
          `Keystone v3 auth failed (${res.status}): ${text}`,
          500,
          'STORAGE_ERROR',
        );
      }

      const token = res.headers.get('x-subject-token');
      const body = await res.json();
      const catalog = body?.token?.catalog || [];
      const swiftService = catalog.find((s) => s.type === 'object-store' || s.name === 'swift');
      const endpoint =
        swiftService?.endpoints?.find((ep) => ep.interface === 'public')?.url ||
        swiftService?.endpoints?.[0]?.url;

      if (!endpoint || !token) {
        throw new AppError(
          'Failed to obtain Swift endpoint or token from Keystone v3',
          500,
          'STORAGE_ERROR',
        );
      }

      this.storageUrl = endpoint;
      this.authToken = token;
      return { storageUrl: this.storageUrl, authToken: this.authToken };
    }

    // 3. Swift v1.0 / TempAuth authentication
    const authEndpoint = this.authUrl.includes('/v1.0')
      ? this.authUrl
      : `${this.authUrl.replace(/\/+$/, '')}/auth/v1.0`;

    const res = await fetch(authEndpoint, {
      method: 'GET',
      headers: {
        'X-Auth-User': this.username || '',
        'X-Auth-Key': this.password || '',
      },
    });

    if (!res.ok) {
      throw new AppError(
        `Swift v1.0 auth failed (${res.status}): ${await res.text()}`,
        500,
        'STORAGE_ERROR',
      );
    }

    const storageUrl = res.headers.get('x-storage-url');
    const authToken = res.headers.get('x-auth-token');

    if (!storageUrl || !authToken) {
      throw new AppError(
        'Swift v1 auth response missing X-Storage-Url or X-Auth-Token headers',
        500,
        'STORAGE_ERROR',
      );
    }

    this.storageUrl = storageUrl;
    this.authToken = authToken;
    return { storageUrl: this.storageUrl, authToken: this.authToken };
  }

  /**
   * Ensures the private storage container exists in OpenStack Swift.
   */
  async ensureContainer() {
    if (this._containerEnsured) return;
    await this.authenticate();

    const containerUrl = `${this.storageUrl.replace(/\/+$/, '')}/${encodeURIComponent(this.container)}`;

    // Check if container exists
    const headRes = await fetch(containerUrl, {
      method: 'HEAD',
      headers: { 'X-Auth-Token': this.authToken },
    });

    if (headRes.status === 404) {
      // Create container
      const putRes = await fetch(containerUrl, {
        method: 'PUT',
        headers: { 'X-Auth-Token': this.authToken },
      });
      if (!putRes.ok && putRes.status !== 202 && putRes.status !== 201) {
        throw new AppError(
          `Failed to create Swift container '${this.container}': ${await putRes.text()}`,
          500,
          'STORAGE_ERROR',
        );
      }
    }

    this._containerEnsured = true;
  }

  /**
   * Uploads file bytes into OpenStack Swift.
   * @param {string} storagePath
   * @param {Buffer} buffer
   * @param {string} [mimeType='application/octet-stream']
   * @returns {Promise<{ path: string, size: number, mimeType: string }>}
   */
  async put(storagePath, buffer, mimeType = 'application/octet-stream') {
    await this.ensureContainer();

    const objectUrl = `${this.storageUrl.replace(/\/+$/, '')}/${encodeURIComponent(this.container)}/${this._encodePath(storagePath)}`;

    const res = await fetch(objectUrl, {
      method: 'PUT',
      headers: {
        'X-Auth-Token': this.authToken,
        'Content-Type': mimeType,
        'Content-Length': String(buffer.length),
      },
      body: buffer,
    });

    if (!res.ok && res.status !== 201 && res.status !== 202) {
      // If unauthorized, retry once after re-authenticating
      if (res.status === 401) {
        this.authToken = null;
        await this.authenticate();
        return this.put(storagePath, buffer, mimeType);
      }
      throw new AppError(
        `Failed to store object in Swift (${res.status}): ${await res.text()}`,
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

  /**
   * Downloads file bytes from OpenStack Swift.
   * @param {string} storagePath
   * @returns {Promise<{ buffer: Buffer, size: number, mimeType: string, path: string }>}
   */
  async get(storagePath) {
    await this.authenticate();

    const objectUrl = `${this.storageUrl.replace(/\/+$/, '')}/${encodeURIComponent(this.container)}/${this._encodePath(storagePath)}`;

    const res = await fetch(objectUrl, {
      method: 'GET',
      headers: {
        'X-Auth-Token': this.authToken,
      },
    });

    if (res.status === 404) {
      throw new AppError(`File not found in Swift storage: ${storagePath}`, 404, 'NOT_FOUND');
    }

    if (!res.ok) {
      if (res.status === 401) {
        this.authToken = null;
        await this.authenticate();
        return this.get(storagePath);
      }
      throw new AppError(
        `Failed to retrieve object from Swift (${res.status}): ${await res.text()}`,
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

  /**
   * Checks whether an object exists in Swift.
   * @param {string} storagePath
   * @returns {Promise<boolean>}
   */
  async exists(storagePath) {
    await this.authenticate();

    const objectUrl = `${this.storageUrl.replace(/\/+$/, '')}/${encodeURIComponent(this.container)}/${this._encodePath(storagePath)}`;

    const res = await fetch(objectUrl, {
      method: 'HEAD',
      headers: {
        'X-Auth-Token': this.authToken,
      },
    });

    if (res.status === 200 || res.status === 204) return true;
    if (res.status === 404) return false;

    if (res.status === 401) {
      this.authToken = null;
      await this.authenticate();
      return this.exists(storagePath);
    }

    return false;
  }

  /**
   * Deletes an object from Swift (used for rollback on DB error).
   * @param {string} storagePath
   * @returns {Promise<boolean>}
   */
  async delete(storagePath) {
    await this.authenticate();

    const objectUrl = `${this.storageUrl.replace(/\/+$/, '')}/${encodeURIComponent(this.container)}/${this._encodePath(storagePath)}`;

    const res = await fetch(objectUrl, {
      method: 'DELETE',
      headers: {
        'X-Auth-Token': this.authToken,
      },
    });

    if (res.status === 404) return false;
    if (!res.ok && res.status !== 204 && res.status !== 200) {
      if (res.status === 401) {
        this.authToken = null;
        await this.authenticate();
        return this.delete(storagePath);
      }
      return false;
    }

    return true;
  }
}
