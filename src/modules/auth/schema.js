import { z } from 'zod';

export const loginSchema = z
  .object({
    email: z.string().trim().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  })
  .strict()
  .transform((data) => ({
    email: data.email.trim().toLowerCase(),
    password: data.password,
  }));
