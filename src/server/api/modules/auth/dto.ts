import { z } from 'zod';

/**
 * One schema per payload — runtime validator, source of the TypeScript type,
 * and the OpenAPI fragment, all from one declaration.
 */

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

/**
 * Length over composition rules. Character-class requirements push people
 * toward `Password1!` and measurably do not improve real-world strength; a
 * length floor does.
 */
export const PasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200, 'Password must be at most 200 characters');

export const RegisterSchema = z
  .object({
    email: EmailSchema,
    password: PasswordSchema,
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const LoginSchema = z
  .object({
    email: EmailSchema,
    password: z.string().min(1).max(200),
  })
  .strict();

export const SessionIdParams = z.object({ id: z.string().min(1) });

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
