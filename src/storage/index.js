import { config } from '../config/env.js';
import { LocalStorageAdapter } from './local.js';
import { SwiftStorageAdapter } from './swift.js';
import { SupabaseStorageAdapter } from './supabase.js';

export { LocalStorageAdapter, SwiftStorageAdapter, SupabaseStorageAdapter };

/**
 * Creates a storage adapter instance for the specified driver name.
 * @param {'local'|'swift'|'supabase'} [driver=config.STORAGE_DRIVER]
 * @param {object} [options]
 * @returns {LocalStorageAdapter|SwiftStorageAdapter|SupabaseStorageAdapter}
 */
export function createStorageAdapter(driver = config.STORAGE_DRIVER, options = {}) {
  switch (driver) {
    case 'swift':
      return new SwiftStorageAdapter(options);
    case 'supabase':
      return new SupabaseStorageAdapter(options);
    case 'local':
    default:
      return new LocalStorageAdapter(options);
  }
}

/**
 * Singleton active storage adapter instance based on application configuration.
 */
export const storage = createStorageAdapter();

export const put = (storagePath, buffer, mimeType) => storage.put(storagePath, buffer, mimeType);
export const get = (storagePath) => storage.get(storagePath);
export const exists = (storagePath) => storage.exists(storagePath);
export const deleteFile = (storagePath) => storage.delete(storagePath);
