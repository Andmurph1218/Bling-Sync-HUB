import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { resolveSessionByToken } from './service.js';
import { hasPermission } from './permissions.js';
import { UserRole } from './types.js';

function isPasswordChangeExempt(req: Request): boolean {
  const path = req.originalUrl.split('?')[0] ?? req.path;
  return path === '/auth/me' || path === '/auth/logout' || path === '/auth/change-password';
}

export function extractOpaqueToken(req: Request): string | null {
  const cookieToken = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice('Bearer '.length).trim();
    if (bearer.length > 0) {
      return bearer;
    }
  }

  return null;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const opaqueToken = extractOpaqueToken(req);
    if (!opaqueToken) {
      res.status(401).json({ error: 'unauthorized', message: 'Sessão ausente' });
      return;
    }

    const user = await resolveSessionByToken(opaqueToken);
    if (!user) {
      res.status(401).json({ error: 'unauthorized', message: 'Sessão inválida ou expirada' });
      return;
    }

    req.user = user;
    if (user.mustChangePassword && !isPasswordChangeExempt(req)) {
      res.status(403).json({
        error: 'password_change_required',
        message: 'Troque a senha antes de usar o HUB.',
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await requireAuth(req, res, () => {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: 'unauthorized', message: 'Sessão ausente' });
        return;
      }

      const hasAllowedRole =
        user.roles.includes('admin') ||
        user.roles.some((role) => allowedRoles.includes(role)) ||
        (allowedRoles.includes('operator') && hasPermission(user, 'product:write'));
      if (!hasAllowedRole) {
        res.status(403).json({
          error: 'forbidden',
          message: `Acesso restrito aos papéis: ${allowedRoles.join(', ')}`,
          requiredRoles: allowedRoles,
          userRoles: user.roles,
        });
        return;
      }

      next();
    });
  };
}

export function requirePermission(...permissions: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await requireAuth(req, res, () => {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: 'unauthorized', message: 'Sessão ausente' });
        return;
      }
      if (permissions.some((permission) => hasPermission(user, permission))) {
        next();
        return;
      }
      res.status(403).json({
        error: 'forbidden',
        message: `Acesso restrito às permissões: ${permissions.join(', ')}`,
        requiredPermissions: permissions,
      });
    });
  };
}
