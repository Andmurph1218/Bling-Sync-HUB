export const ROLES = ['operator', 'fiscal_approver', 'admin'] as const;

export type UserRole = (typeof ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  roles: UserRole[];
  sessionId: string;
  mustChangePassword: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
