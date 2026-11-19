import { z } from 'zod';

const PERMISSION_CODES = ['VIEW', 'UPLOAD', 'EDIT', 'SIGN', 'SHARE', 'AUDIT', 'MANAGE_ORG'];

export const createPositionSchema = z.object({
  title: z
    .string()
    .min(1, 'Position title is required')
    .max(100, 'Position title must not exceed 100 characters')
    .trim(),
  clearanceLevel: z.coerce
    .number()
    .int()
    .min(1, 'Clearance level must be between 1 and 4')
    .max(4, 'Clearance level must be between 1 and 4'),
  deptScope: z.enum(['ORG', 'OWN_DEPT', 'ASSIGNED']),
  permissions: z.array(z.enum(PERMISSION_CODES)).default(['VIEW', 'UPLOAD']),
});

export const updatePositionSchema = z.object({
  title: z
    .string()
    .min(1, 'Position title must not be empty')
    .max(100, 'Position title must not exceed 100 characters')
    .trim()
    .optional(),
  clearanceLevel: z.coerce.number().int().min(1).max(4).optional(),
  deptScope: z.enum(['ORG', 'OWN_DEPT', 'ASSIGNED']).optional(),
  permissions: z.array(z.enum(PERMISSION_CODES)).optional(),
});
