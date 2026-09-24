import { z } from 'zod';
import { ROLES } from '@shared/permissions.js';
import { EmailSchema } from '../auth/dto.js';

export const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Use lowercase letters, digits and hyphens');

/**
 * Validated against the runtime's own tz database rather than a hard-coded
 * list, so it cannot drift.
 */
export const TimezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Unknown IANA timezone' },
);

export const WorkspaceParams = z.object({ workspaceId: z.string().min(1) });

export const CreateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: SlugSchema,
    timezone: TimezoneSchema.default('UTC'),
  })
  .strict();

export const UpdateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    timezone: TimezoneSchema.optional(),
    /**
     * null means unlimited. Changing the timezone or retention has downstream
     * consequences — the service enqueues a recompute and writes an audit row.
     */
    retentionDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const InviteMemberSchema = z
  .object({
    email: EmailSchema,
    role: z.enum(ROLES).exclude(['OWNER']),
  })
  .strict();

export const UpdateMemberSchema = z
  .object({ role: z.enum(ROLES).exclude(['OWNER']) })
  .strict();

export const MemberParams = WorkspaceParams.extend({ userId: z.string().min(1) });

export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;
export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;
