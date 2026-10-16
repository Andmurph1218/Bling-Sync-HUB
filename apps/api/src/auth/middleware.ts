import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { resolveSessionByToken } from './service.js';
import { UserRole } from './types.js';

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

      const hasAllowedRole = user.roles.some((role) => allowedRoles.includes(role));
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
