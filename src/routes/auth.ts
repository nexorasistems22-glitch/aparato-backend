import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, AuthRequest } from '../middleware/auth';

export const authRouter = Router();

const registerSchema = z.object({
  tenantName: z.string().min(2, 'Nome muito curto'),
  tenantSlug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug inválido (use letras minúsculas, números e hífens)'),
  ownerName: z.string().min(2),
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  slug: z.string().min(1, 'Informe o slug do estabelecimento'),
});

function generateTokens(userId: string, tenantId: string, role: string, email: string) {
  const secret = process.env.JWT_SECRET!;
  const accessToken = jwt.sign(
    { userId, tenantId, role, email },
    secret,
    { expiresIn: '8h' }
  );
  const refreshToken = jwt.sign(
    { userId, tenantId, type: 'refresh' },
    secret,
    { expiresIn: '30d' }
  );
  return { accessToken, refreshToken };
}

// POST /api/auth/register
authRouter.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  const { tenantName, tenantSlug, ownerName, email, password, phone } = parsed.data;

  const existing = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (existing) throw new AppError('Slug já em uso, escolha outro', 409);

  const passwordHash = await bcrypt.hash(password, 12);

  const tenant = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: {
        name: tenantName,
        slug: tenantSlug,
        phone,
        email,
      },
    });

    await tx.user.create({
      data: {
        tenantId: t.id,
        email,
        passwordHash,
        name: ownerName,
        role: 'OWNER',
      },
    });

    // Default working hours (Seg-Sab, 9h-18h)
    const days = [1, 2, 3, 4, 5, 6];
    await tx.workingHours.createMany({
      data: days.map((d) => ({
        tenantId: t.id,
        dayOfWeek: d,
        startTime: '09:00',
        endTime: '18:00',
        lunchStart: '12:00',
        lunchEnd: '13:00',
        isWorking: true,
      })),
    });

    return t;
  });

  res.status(201).json({
    message: 'Estabelecimento criado com sucesso!',
    tenantId: tenant.id,
    slug: tenant.slug,
  });
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  const { email, password, slug } = parsed.data;

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, isActive: true, name: true, logoUrl: true, planType: true },
  });

  if (!tenant || !tenant.isActive) {
    throw new AppError('Estabelecimento não encontrado ou inativo', 404);
  }

  const user = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email, isActive: true },
  });

  if (!user) throw new AppError('Credenciais inválidas', 401);

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new AppError('Credenciais inválidas', 401);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const { accessToken, refreshToken } = generateTokens(user.id, tenant.id, user.role, user.email);

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug,
      logoUrl: tenant.logoUrl,
      planType: tenant.planType,
    },
  });
});

// POST /api/auth/refresh
authRouter.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError('Refresh token obrigatório', 400);

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET!) as any;
    if (decoded.type !== 'refresh') throw new AppError('Token inválido', 401);

    const user = await prisma.user.findFirst({
      where: { id: decoded.userId, isActive: true },
    });
    if (!user) throw new AppError('Usuário não encontrado', 401);

    const { accessToken, refreshToken: newRefresh } = generateTokens(
      user.id, user.tenantId, user.role, user.email
    );

    res.json({ accessToken, refreshToken: newRefresh });
  } catch {
    throw new AppError('Refresh token inválido', 401);
  }
});

// GET /api/auth/me
authRouter.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.user!.tenantId },
    select: { id: true, name: true, slug: true, logoUrl: true, planType: true, settings: true },
  });

  res.json({ user, tenant });
});
