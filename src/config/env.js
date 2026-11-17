import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_URL_TEST: z.string().url().optional(),
  JWT_SECRET: z.string().min(16).default('docuvault-dev-jwt-secret-min-32-bytes-long'),
  KEY_ENC_SECRET: z.string().min(16).default('docuvault-dev-key-enc-secret-min-32-bytes'),

  // Step 4: Storage and Uploads
  STORAGE_DRIVER: z.enum(['local', 'swift', 'supabase']).default('local'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(20),
  STORAGE_LOCAL_DIR: z.string().default('.storage_vault'),

  // OpenStack Swift settings
  SWIFT_AUTH_URL: z.string().optional(),
  SWIFT_USERNAME: z.string().optional(),
  SWIFT_PASSWORD: z.string().optional(),
  SWIFT_PROJECT_NAME: z.string().optional(),
  SWIFT_PROJECT_DOMAIN_NAME: z.string().default('Default'),
  SWIFT_USER_DOMAIN_NAME: z.string().default('Default'),
  SWIFT_STORAGE_URL: z.string().optional(),
  SWIFT_AUTH_TOKEN: z.string().optional(),
  SWIFT_CONTAINER: z.string().default('docuvault'),

  // Supabase Storage settings
  STORAGE_URL: z.string().optional(),
  STORAGE_KEY: z.string().optional(),
  STORAGE_BUCKET: z.string().default('docuvault'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast at boot with a readable list; never print secret values.
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Invalid environment configuration -> ${issues}`);
}

const env = parsed.data;

// Tests must never touch the real database.
const databaseUrl = env.NODE_ENV === 'test' ? env.DATABASE_URL_TEST : env.DATABASE_URL;
if (
  env.NODE_ENV === 'test' &&
  env.DATABASE_URL_TEST &&
  env.DATABASE_URL_TEST === env.DATABASE_URL
) {
  throw new Error('DATABASE_URL_TEST must differ from DATABASE_URL');
}

if (env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be explicitly set in production');
  }
  if (!process.env.KEY_ENC_SECRET) {
    throw new Error('KEY_ENC_SECRET must be explicitly set in production');
  }
  if (env.STORAGE_DRIVER === 'swift') {
    const hasDirect = !!(env.SWIFT_STORAGE_URL && env.SWIFT_AUTH_TOKEN);
    const hasCredentials = !!(env.SWIFT_AUTH_URL && env.SWIFT_USERNAME && env.SWIFT_PASSWORD);
    if (!hasDirect && !hasCredentials) {
      throw new Error(
        'OpenStack Swift storage requires either SWIFT_STORAGE_URL+SWIFT_AUTH_TOKEN or SWIFT_AUTH_URL+SWIFT_USERNAME+SWIFT_PASSWORD in production',
      );
    }
  } else if (env.STORAGE_DRIVER === 'supabase') {
    if (!env.STORAGE_URL || !env.STORAGE_KEY) {
      throw new Error('Supabase storage requires STORAGE_URL and STORAGE_KEY in production');
    }
  }
}

export const config = Object.freeze({ ...env, databaseUrl });
