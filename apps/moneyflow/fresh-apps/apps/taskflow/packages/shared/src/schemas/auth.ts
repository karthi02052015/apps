import { z } from 'zod';
import { LIMITS, type UserRole } from '../constants';
import { canonicalTimeZone } from '../time';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, `Use at least ${LIMITS.passwordMin} characters`)
  .max(LIMITS.passwordMax, `Use at most ${LIMITS.passwordMax} characters`)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number');

const timezoneSchema = z
  .string()
  .max(64)
  .transform((tz, ctx) => {
    const canonical = canonicalTimeZone(tz);
    if (!canonical) {
      ctx.addIssue({ code: 'custom', message: 'Unknown time zone' });
      return z.NEVER;
    }
    return canonical;
  });

export const displayNameSchema = z.string().trim().min(1, 'Name is required').max(LIMITS.nameMax);

export const registerSchema = z.object({
  name: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
  timezone: timezoneSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Do not apply the password policy on login — old passwords must still work.
  password: z.string().min(1, 'Password is required').max(LIMITS.passwordMax),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z
  .object({
    name: displayNameSchema.optional(),
    timezone: timezoneSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(LIMITS.passwordMax),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export { timezoneSchema };

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  timezone: string;
  createdAt: string;
}

export interface AuthResponse {
  user: UserDTO;
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface SessionDTO {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}
