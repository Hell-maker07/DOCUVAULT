import { z } from 'zod';

export const createUserSchema = z.object({
  fullName: z
    .string()
    .min(1, 'Full name is required')
    .max(100, 'Full name must not exceed 100 characters')
    .trim(),
  email: z.string().email('A valid email address is required').max(255).trim().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  departmentId: z.string().uuid('Valid department UUID required'),
  positionId: z.string().uuid('Valid position UUID required'),
  employeeNo: z.string().max(30).trim().optional(),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(1, 'Full name must not be empty').max(100).trim().optional(),
  departmentId: z.string().uuid('Valid department UUID required').optional(),
  positionId: z.string().uuid('Valid position UUID required').optional(),
  isActive: z.boolean().optional(),
  employeeNo: z.string().max(30).trim().optional(),
});
