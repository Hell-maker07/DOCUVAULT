import { Readable } from 'node:stream';
import {
  sha256,
  sha256Stream,
  timingSafeCompare,
  verifyIntegrity,
  buildStoragePath,
  canonicalJson,
} from '../src/utils/hash.js';

describe('Step 4: Cryptographic Hashing and Integrity Utility (Sakshi)', () => {
  describe('sha256', () => {
    it('computes exact 64-character lowercase hex digest of a string', () => {
      const digest = sha256('');
      expect(digest).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it('computes exact SHA-256 for binary Buffer data', () => {
      const buf = Buffer.from('DocuVault Secure Digital Vault Evidence', 'utf8');
      const digest = sha256(buf);
      expect(digest).toHaveLength(64);
      expect(digest).toBe(sha256('DocuVault Secure Digital Vault Evidence'));
    });
  });

  describe('sha256Stream', () => {
    it('computes SHA-256 digest from a readable stream', async () => {
      const content = 'Streamed evidence payload for forensic verification';
      const stream = Readable.from([content]);
      const digest = await sha256Stream(stream);
      expect(digest).toBe(sha256(content));
    });
  });

  describe('timingSafeCompare', () => {
    const validHash1 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const validHash2 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

    it('returns true for matching hashes regardless of casing', () => {
      expect(timingSafeCompare(validHash1, validHash1)).toBe(true);
      expect(timingSafeCompare(validHash1, validHash1.toUpperCase())).toBe(true);
    });

    it('returns false for different hashes', () => {
      expect(timingSafeCompare(validHash1, validHash2)).toBe(false);
    });

    it('returns false for non-string or malformed inputs without throwing', () => {
      expect(timingSafeCompare(validHash1, null)).toBe(false);
      expect(timingSafeCompare(undefined, validHash2)).toBe(false);
      expect(timingSafeCompare('short', validHash2)).toBe(false);
    });
  });

  describe('verifyIntegrity', () => {
    const fileBytes = Buffer.from('Official Witness Statement - Confirmed Untampered');
    const correctHash = sha256(fileBytes);
    const tamperedHash = '0000000000000000000000000000000000000000000000000000000000000000';

    it('returns VERIFIED status when file bytes match expected hash', () => {
      const result = verifyIntegrity(fileBytes, correctHash);
      expect(result).toEqual({
        verified: true,
        actualHash: correctHash,
        expectedHash: correctHash,
        status: 'VERIFIED',
      });
    });

    it('returns TAMPERED status when file bytes do not match expected hash', () => {
      const result = verifyIntegrity(fileBytes, tamperedHash);
      expect(result.verified).toBe(false);
      expect(result.status).toBe('TAMPERED');
      expect(result.actualHash).toBe(correctHash);
      expect(result.expectedHash).toBe(tamperedHash);
    });
  });

  describe('buildStoragePath', () => {
    it('constructs an isolated, collision-resistant path for document versions', () => {
      const path = buildStoragePath({
        orgId: 'org-uuid-1234',
        docId: 'doc-uuid-5678',
        versionNo: 1,
        fileName: 'case_report_2026.pdf',
      });
      expect(path).toBe('orgs/org-uuid-1234/docs/doc-uuid-5678/v1_case_report_2026.pdf');
    });

    it('sanitizes dangerous path traversal and special characters', () => {
      const path = buildStoragePath({
        orgId: 'org-1',
        docId: 'doc-2',
        versionNo: 3,
        fileName: '../../../etc/passwd evil file (1)!.docx',
      });
      expect(path).toBe('orgs/org-1/docs/doc-2/v3_passwd_evil_file__1__.docx');
    });

    it('throws if any required coordinate is missing', () => {
      expect(() => buildStoragePath({ orgId: 'org-1', docId: 'doc-1', versionNo: 1 })).toThrow();
    });
  });

  describe('canonicalJson', () => {
    it('produces identical serialized string regardless of object key insertion order', () => {
      const obj1 = { z: 1, a: 2, m: { y: 10, x: 20 } };
      const obj2 = { a: 2, m: { x: 20, y: 10 }, z: 1 };
      expect(canonicalJson(obj1)).toBe(canonicalJson(obj2));
      expect(canonicalJson(obj1)).toBe('{"a":2,"m":{"x":20,"y":10},"z":1}');
    });
  });
});
