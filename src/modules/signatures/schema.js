import { z } from 'zod';

export const documentVersionParamsSchema = z
  .object({
    id: z.string().uuid({ message: 'Invalid document ID format' }),
    no: z.coerce
      .number({ invalid_type_error: 'Version number must be an integer' })
      .int()
      .positive({ message: 'Version number must be at least 1' }),
  })
  .strict();

export const signatureIdParamsSchema = z
  .object({
    id: z.string().uuid({ message: 'Invalid signature ID format' }),
  })
  .strict();
