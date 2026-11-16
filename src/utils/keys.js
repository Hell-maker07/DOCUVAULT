import crypto from 'node:crypto';
import { config } from '../config/env.js';

/**
 * Generates an Ed25519 asymmetric key pair.
 * @returns {{ publicKey: string, privateKey: string }} PEM strings
 */
export const newKeyPair = () =>
  crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

/**
 * Signs a hex hash string with an Ed25519 private key.
 * @param {string} privatePem
 * @param {string} hashHex
 * @returns {string} Base64-encoded signature
 */
export const signHash = (privatePem, hashHex) =>
  crypto.sign(null, Buffer.from(hashHex), privatePem).toString('base64');

/**
 * Verifies an Ed25519 signature over a hex hash string.
 * @param {string} publicPem
 * @param {string} hashHex
 * @param {string} sigB64
 * @returns {boolean}
 */
export const verifyHash = (publicPem, hashHex, sigB64) =>
  crypto.verify(null, Buffer.from(hashHex), publicPem, Buffer.from(sigB64, 'base64'));

/**
 * Encrypts sensitive text (e.g. private key) with AES-256-GCM using KEY_ENC_SECRET.
 * @param {string} text
 * @param {string} [secret]
 * @returns {string} iv.tag.ciphertext formatted in base64
 */
export const wrap = (text, secret = config.KEY_ENC_SECRET) => {
  const kek = crypto.scryptSync(secret, 'docuvault', 32);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
};

/**
 * Decrypts AES-256-GCM wrapped text using KEY_ENC_SECRET.
 * @param {string} s
 * @param {string} [secret]
 * @returns {string} Original plaintext
 */
export const unwrap = (s, secret = config.KEY_ENC_SECRET) => {
  const kek = crypto.scryptSync(secret, 'docuvault', 32);
  const [iv, tag, enc] = s.split('.').map((p) => Buffer.from(p, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
};
