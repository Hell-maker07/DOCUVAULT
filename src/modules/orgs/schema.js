import { z } from 'zod';

export const registerOrgSchema = z
  .object({
    name: z.string().trim().min(1, 'Organisation name cannot be blank').max(150).optional(),
    orgName: z.string().trim().min(1, 'Organisation name cannot be blank').max(150).optional(),
    orgType: z.string().trim().min(1, 'Organisation type cannot be blank').max(50).optional(),
    org_type: z.string().trim().min(1, 'Organisation type cannot be blank').max(50).optional(),
    type: z.string().trim().min(1, 'Organisation type cannot be blank').max(50).optional(),
    department: z.string().trim().min(1, 'Department cannot be blank').max(100).optional(),
    departmentName: z.string().trim().min(1, 'Department cannot be blank').max(100).optional(),
    departmentCode: z.string().trim().min(1).max(20).optional(),
    adminName: z.string().trim().min(1, 'Admin name cannot be blank').max(100).optional(),
    fullName: z.string().trim().min(1, 'Admin name cannot be blank').max(100).optional(),
    email: z.string().trim().email('Invalid email address').max(255),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  })
  .strict()
  .refine((data) => Boolean(data.name || data.orgName), {
    message: 'Organisation name is required',
    path: ['name'],
  })
  .refine((data) => Boolean(data.orgType || data.org_type || data.type), {
    message: 'Organisation type is required',
    path: ['orgType'],
  })
  .refine((data) => Boolean(data.department || data.departmentName), {
    message: 'Department is required',
    path: ['department'],
  })
  .refine((data) => Boolean(data.adminName || data.fullName), {
    message: 'Admin name is required',
    path: ['adminName'],
  })
  .transform((data) => {
    const dept = (data.department || data.departmentName).trim();
    return {
      name: (data.name || data.orgName).trim(),
      orgType: (data.orgType || data.org_type || data.type).trim(),
      department: dept,
      departmentCode:
        data.departmentCode?.trim() ||
        dept.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() ||
        'ADMIN',
      adminName: (data.adminName || data.fullName).trim(),
      email: data.email.trim().toLowerCase(),
      password: data.password,
    };
  });
