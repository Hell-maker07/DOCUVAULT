import { z } from 'zod';

export const createWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1, 'Workspace name is required').max(150),
    departmentId: z.string().uuid('Invalid department ID'),
    description: z.string().trim().max(1000).optional(),
  })
  .strict();

export const updateWorkspaceStatusSchema = z
  .object({
    status: z.enum(['OPEN', 'CLOSED', 'ARCHIVED']),
  })
  .strict();

export const addWorkspaceMemberSchema = z
  .object({
    userId: z.string().uuid('Invalid user ID'),
  })
  .strict();

export const workspaceIdParamSchema = z
  .object({
    id: z.string().uuid('Invalid workspace ID'),
  })
  .strict();
