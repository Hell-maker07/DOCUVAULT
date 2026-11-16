import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_URL_TEST: z.string().url().optional(),
  JWT_SECRET: z.string().min(16).default('docuvault-dev-jwt-secret-min-32-bytes-long'),
  KEY_ENC_SECRET: z.string().min(16).default('docuvault-dev-key-enc-secret-min-32-bytes'),
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
}

export const config = Object.freeze({ ...env, databaseUrl });
