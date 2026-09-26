import type { UserRole } from '@taskflow/shared';

declare global {
  namespace Express {
    interface Request {
      /** Populated by requireAuth. */
      auth?: {
        userId: string;
        role: UserRole;
        sessionId: string;
        /** Access-token expiry (unix seconds). */
        exp: number;
      };
      /** Resolved IANA time zone for date-relative views. */
      timeZone?: string;
    }
  }
}

export {};
