import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import { verifyJwt } from '../utils/verifyJwt.js';
import { consumeSseTicket } from '../utils/sseTicket.js';
import type { TokenPayload } from '@m3u8-preview/shared';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    // SSE/EventSource 不支持自定义 header，使用一次性 ticket 认证
    if (typeof req.query.ticket === 'string') {
      const payload = consumeSseTicket(req.query.ticket);
      if (!payload) {
        throw new AppError('Invalid or expired ticket', 401);
      }
      req.user = payload as TokenPayload;
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      throw new AppError('Authentication required', 401);
    }

    const decoded = verifyJwt<unknown>(token, 'access');
    if (typeof decoded !== 'object' || decoded === null || !('userId' in decoded) || !('role' in decoded)) {
      throw new AppError('Invalid token payload', 401);
    }
    req.user = decoded as TokenPayload;
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    next(new AppError('Invalid or expired token', 401));
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (token) {
      const decoded = verifyJwt<unknown>(token, 'access');
      if (typeof decoded !== 'object' || decoded === null || !('userId' in decoded) || !('role' in decoded)) {
        throw new AppError('Invalid token payload', 401);
      }
      req.user = decoded as TokenPayload;
    }
    next();
  } catch (error) {
    console.warn('[auth] ignored invalid optional token', {
      path: req.path,
      method: req.method,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    next();
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }
    next();
  };
}
