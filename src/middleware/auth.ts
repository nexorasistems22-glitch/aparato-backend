import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
    email: string;
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET!;

    const decoded = jwt.verify(token, secret) as {
      userId: string;
      tenantId: string;
      role: string;
      email: string;
    };

    req.user = {
      id: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
      email: decoded.email,
    };

    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permissão insuficiente' });
    }
    next();
  };
};
