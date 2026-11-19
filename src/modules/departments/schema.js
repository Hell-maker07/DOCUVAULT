import { z } from 'zod';

export const createDepartmentSchema = z.object({
  code: z
    .string()
    .min(1, 'Department code is required')
    .max(20, 'Department code must not exceed 20 characters')
    .trim()
    .transform((s) => s.toUpperCase()),
  name: z
    .string()
    .min(1, 'Department name is required')
    .max(100, 'Department name must not exceed 100 characters')
    .trim(),
});

export const updateDepartmentSchema = z.object({
  code: z
    .string()
    .min(1, 'Department code must not be empty')
    .max(20, 'Department code must not exceed 20 characters')
    .trim()
    .transform((s) => s.toUpperCase())
    .optional(),
  name: z
    .string()
    .min(1, 'Department name must not be empty')
    .max(100, 'Department name must not exceed 100 characters')
    .trim()
    .optional(),
});
