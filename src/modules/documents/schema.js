import { z } from 'zod';

export const uploadDocumentBodySchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    typeId: z.string().uuid('Invalid document type ID'),
    classification: z.coerce.number().int().min(1).max(4),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();

export const uploadVersionBodySchema = z
  .object({
    changeNote: z.string().trim().max(1000).optional(),
  })
  .strict();

export const searchDocumentsQuerySchema = z
  .object({
    q: z.string().trim().optional(),
    typeId: z.string().uuid().optional(),
    workspaceId: z.string().uuid().optional(),
    classification: z.coerce.number().int().min(1).max(4).optional(),
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

export const documentIdParamSchema = z
  .object({
    id: z.string().uuid('Invalid document ID'),
  })
  .strict();

export const documentVersionParamSchema = z
  .object({
    id: z.string().uuid('Invalid document ID'),
    no: z.coerce.number().int().positive('Version number must be a positive integer'),
  })
  .strict();

export const createDocumentTypeSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
  })
  .strict();
