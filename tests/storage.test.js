import fs from 'node:fs/promises';
import path from 'node:path';
import { jest } from '@jest/globals';
import {
  LocalStorageAdapter,
  SwiftStorageAdapter,
  createStorageAdapter,
} from '../src/storage/index.js';
import AppError from '../src/utils/AppError.js';

describe('Step 4: Storage Adapters and OpenStack Swift Integration (Sakshi)', () => {
  const testStorageDir = path.resolve(process.cwd(), '.test_storage_vault');

  afterAll(async () => {
    try {
      await fs.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('LocalStorageAdapter', () => {
    const local = new LocalStorageAdapter({ rootDir: testStorageDir });
    const samplePath = 'orgs/org-101/docs/doc-202/v1_evidence.pdf';
    const sampleContent = Buffer.from('Official verified evidence content payload');

    it('writes a file to disk and returns storage metadata (put)', async () => {
      const res = await local.put(samplePath, sampleContent, 'application/pdf');
      expect(res.path).toBe(samplePath);
      expect(res.size).toBe(sampleContent.length);
      expect(res.mimeType).toBe('application/pdf');
    });

    it('confirms file existence on disk (exists)', async () => {
      const exists = await local.exists(samplePath);
      expect(exists).toBe(true);

      const nonExistent = await local.exists('orgs/none/missing.txt');
      expect(nonExistent).toBe(false);
    });

    it('reads the stored file buffer and verifies content (get)', async () => {
      const res = await local.get(samplePath);
      expect(res.buffer).toEqual(sampleContent);
      expect(res.size).toBe(sampleContent.length);
    });

    it('throws 404 NOT_FOUND when attempting to get a non-existent file', async () => {
      await expect(local.get('non/existent/file.bin')).rejects.toThrow(AppError);
      await expect(local.get('non/existent/file.bin')).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    });

    it('deletes the file from storage (delete)', async () => {
      const deleted = await local.delete(samplePath);
      expect(deleted).toBe(true);
      expect(await local.exists(samplePath)).toBe(false);
    });

    it('strictly prevents directory traversal attempts with 400 VALIDATION_ERROR', async () => {
      await expect(local.put('../../../etc/passwd', sampleContent)).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });

      await expect(local.get('../../../etc/shadow')).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('SwiftStorageAdapter (OpenStack Swift)', () => {
    const mockStorageUrl = 'https://swift.example.com/v1/AUTH_tenant123';
    const mockToken = 'mock-swift-token-xyz';
    const container = 'docuvault';

    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('authenticates and provisions container, then uploads object via PUT', async () => {
      const calls = [];
      globalThis.fetch = jest.fn(async (url, opts) => {
        calls.push({ url, method: opts?.method || 'GET', headers: opts?.headers });

        if (url === `${mockStorageUrl}/${container}` && opts?.method === 'HEAD') {
          return new Response(null, { status: 404 }); // container doesn't exist yet
        }
        if (url === `${mockStorageUrl}/${container}` && opts?.method === 'PUT') {
          return new Response(null, { status: 201 }); // created container
        }
        if (url.includes('/orgs/org-1/docs/doc-1/v1_file.pdf') && opts?.method === 'PUT') {
          return new Response(null, { status: 201 }); // created object
        }
        return new Response('Not found', { status: 404 });
      });

      const swift = new SwiftStorageAdapter({
        storageUrl: mockStorageUrl,
        authToken: mockToken,
        container,
      });

      const buffer = Buffer.from('Swift object byte content');
      const res = await swift.put('orgs/org-1/docs/doc-1/v1_file.pdf', buffer, 'application/pdf');

      expect(res.path).toBe('orgs/org-1/docs/doc-1/v1_file.pdf');
      expect(res.size).toBe(buffer.length);
      expect(res.mimeType).toBe('application/pdf');

      // Verifies correct Swift endpoints and headers were called
      expect(calls).toHaveLength(3);
      expect(calls[0].method).toBe('HEAD'); // check container
      expect(calls[1].method).toBe('PUT'); // create container
      expect(calls[2].method).toBe('PUT'); // upload object
      expect(calls[2].headers['X-Auth-Token']).toBe(mockToken);
      expect(calls[2].headers['Content-Type']).toBe('application/pdf');
    });

    it('retrieves an object buffer from OpenStack Swift (get)', async () => {
      const fileBytes = Buffer.from('Downloaded swift file content');
      globalThis.fetch = jest.fn(async (url, opts) => {
        if (opts?.method === 'GET') {
          return new Response(fileBytes, {
            status: 200,
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Length': String(fileBytes.length),
            },
          });
        }
        return new Response('Not found', { status: 404 });
      });

      const swift = new SwiftStorageAdapter({
        storageUrl: mockStorageUrl,
        authToken: mockToken,
        container,
      });

      const res = await swift.get('orgs/org-1/docs/doc-1/v1_file.pdf');
      expect(res.buffer).toEqual(fileBytes);
      expect(res.mimeType).toBe('application/pdf');
    });

    it('maps Swift 404 to AppError with code NOT_FOUND', async () => {
      globalThis.fetch = jest.fn(async () => new Response('Item not found', { status: 404 }));

      const swift = new SwiftStorageAdapter({
        storageUrl: mockStorageUrl,
        authToken: mockToken,
        container,
      });

      await expect(swift.get('orgs/missing/doc.pdf')).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    });

    it('authenticates via OpenStack Keystone v3 when credentials are provided', async () => {
      globalThis.fetch = jest.fn(async (url) => {
        if (url.includes('/auth/tokens')) {
          return new Response(
            JSON.stringify({
              token: {
                catalog: [
                  {
                    type: 'object-store',
                    name: 'swift',
                    endpoints: [
                      { interface: 'public', url: 'https://swift-cluster.internal/v1/AUTH_proj' },
                    ],
                  },
                ],
              },
            }),
            {
              status: 201,
              headers: { 'x-subject-token': 'keystone-token-123' },
            },
          );
        }
        return new Response(null, { status: 200 });
      });

      const swift = new SwiftStorageAdapter({
        authUrl: 'https://keystone.example.com:5000/v3',
        username: 'swift-user',
        password: 'swift-password',
        projectName: 'docuvault',
      });

      const auth = await swift.authenticate();
      expect(auth.storageUrl).toBe('https://swift-cluster.internal/v1/AUTH_proj');
      expect(auth.authToken).toBe('keystone-token-123');
    });
  });

  describe('createStorageAdapter Factory', () => {
    it('creates LocalStorageAdapter when driver is "local"', () => {
      const adapter = createStorageAdapter('local');
      expect(adapter).toBeInstanceOf(LocalStorageAdapter);
    });

    it('creates SwiftStorageAdapter when driver is "swift"', () => {
      const adapter = createStorageAdapter('swift');
      expect(adapter).toBeInstanceOf(SwiftStorageAdapter);
    });
  });
});
