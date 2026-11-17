import { z } from 'zod';

export const auditActionEnum = z.enum([
  'LOGIN',
  'LOGIN_FAILED',
  'UPLOAD',
  'NEW_VERSION',
  'VIEW',
  'DOWNLOAD',
  'VERIFY',
  'SIGN',
  'GRANT',
  'ACCESS_DENIED',
  'ADMIN_CHANGE',
]);

export const auditOutcomeEnum = z.enum(['ALLOWED', 'DENIED', 'FAILED']);

export const auditQuerySchema = z
  .object({
    action: auditActionEnum.optional(),
    actorId: z.string().uuid().optional(),
    entityType: z.string().trim().max(30).optional(),
    entityId: z.string().uuid().optional(),
    outcome: auditOutcomeEnum.optional(),
    from: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid datetime format for "from"' })
      .optional(),
    to: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid datetime format for "to"' })
      .optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();
