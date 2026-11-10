export const ROLES = ['admin', 'operator', 'fiscal_approver', 'viewer'] as const;

export type UserRole = (typeof ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  roles: UserRole[];
  permissions: string[];
  sessionId: string;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
