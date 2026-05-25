import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

// ─────────────── CLIENTS ───────────────
export const clientsRouter = Router();
clientsRouter.use(authenticate);

clientsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const { q, page = '1', limit = '20' } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where: any = { tenantId: req.user!.tenantId, isActive: true };
  if (q) {
    where.OR = [
      { name: { contains: q as string, mode: 'insensitive' } },
      { phone: { contains: q as string } },
      { email: { contains: q as string, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.client.findMany({
      where, skip, take: Number(limit),
      orderBy: { name: 'asc' },
    }),
    prisma.client.count({ where }),
  ]);

  res.json({ data, total });
});

clientsRouter.get('/birthdays', async (req: AuthRequest, res: Response) => {
  const today = new Date();
  const clients = await prisma.client.findMany({
    where: {
      tenantId: req.user!.tenantId,
      isActive: true,
      birthDate: { not: null },
    },
  });

  const upcoming = clients.filter((c) => {
    if (!c.birthDate) return false;
    const bDay = new Date(c.birthDate);
    return bDay.getMonth() === today.getMonth();
  });

  res.json({ data: upcoming });
});

clientsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  const client = await prisma.client.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenantId },
    include: {
      appointments: {
        orderBy: { date: 'desc' },
        take: 10,
        include: {
          professional: { select: { name: true } },
          services: { include: { service: { select: { name: true } } } },
        },
      },
      loyaltyPoints: true,
    },
  });
  if (!client) throw new AppError('Cliente não encontrado', 404);

  const totalPoints = client.loyaltyPoints.reduce((s, p) => s + p.points, 0);
  res.json({ ...client, totalLoyaltyPoints: totalPoints });
});

const clientSchema = z.object({
  name: z.string().min(2),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  birthDate: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  notes: z.string().optional(),
});

clientsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = clientSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.errors[0].message);

  const client = await prisma.client.create({
    data: {
      tenantId: req.user!.tenantId,
      ...parsed.data,
      birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : undefined,
      email: parsed.data.email || undefined,
    },
  });
  res.status(201).json(client);
});

clientsRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = clientSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.errors[0].message);

  const client = await prisma.client.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenantId },
  });
  if (!client) throw new AppError('Cliente não encontrado', 404);

  const updated = await prisma.client.update({
    where: { id: client.id },
    data: {
      ...parsed.data,
      birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : undefined,
    },
  });
  res.json(updated);
});

clientsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const client = await prisma.client.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenantId },
  });
  if (!client) throw new AppError('Cliente não encontrado', 404);
  await prisma.client.update({ where: { id: client.id }, data: { isActive: false } });
  res.json({ message: 'Cliente removido' });
});

// ─────────────── PROFESSIONALS ───────────────
export const professionalsRouter = Router();
professionalsRouter.use(authenticate);

professionalsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const professionals = await prisma.professional.findMany({
    where: { tenantId: req.user!.tenantId, isActive: true },
    include: { schedules: true, services: { include: { service: true } } },
    orderBy: { name: 'asc' },
  });
  res.json({ data: professionals });
});

const proSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  bio: z.string().optional(),
  commissionRate: z.number().min(0).max(100).default(40),
  colorCode: z.string().default('#C9A84C'),
  serviceIds: z.array(z.string()).optional(),
});

professionalsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = proSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.errors[0].message);

  const { serviceIds, ...data } = parsed.data;

  const professional = await prisma.$transaction(async (tx) => {
    const p = await tx.professional.create({
      data: { tenantId: req.user!.tenantId, ...data, email: data.email || undefined },
    });

    if (serviceIds?.length) {
      await tx.professionalService.createMany({
        data: serviceIds.map((sid) => ({ professionalId: p.id, serviceId: sid })),
      });
    }

    // Default working hours
    const days = [1, 2, 3, 4, 5, 6];
    await tx.workingHours.createMany({
      data: days.map((d) => ({
        tenantId: req.user!.tenantId,
        professionalId: p.id,
        dayOfWeek: d,
        startTime: '09:00',
        endTime: '18:00',
        lunchStart: '12:00',
        lunchEnd: '13:00',
        isWorking: true,
      })),
    });

    return p;
  });

  res.status(201).json(professional);
});

professionalsRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = proSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.errors[0].message);

  const pro = await prisma.professional.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenantId },
  });
  if (!pro) throw new AppError('Profissional não encontrado', 404);

  const { serviceIds, ...data } = parsed.data;
  const updated = await prisma.professional.update({
    where: { id: pro.id },
    data: { ...data, email: data.email || undefined },
  });
  res.json(updated);
});

// ─────────────── SERVICES ───────────────
export const servicesRouter = Router();
servicesRouter.use(authenticate);

servicesRouter.get('/', async (req: AuthRequest, res: Response) => {
  const services = await prisma.service.findMany({
    where: { tenantId: req.user!.tenantId, isActive: true },
    include: { category: true },
    orderBy: { name: 'asc' },
  });
  res.json({ data: services });
});

const serviceSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  duration: z.number().min(5).max(480),
  price: z.number().min(0),
  categoryId: z.string().optional(),
  isOnline: z.boolean().default(true),
});

servicesRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.errors[0].message);

  const svc = await prisma.service.create({
    data: { tenantId: req.user!.tenantId, ...parsed.data },
  });
  res.status(201).json(svc);
});

servicesRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = serviceSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.errors[0].message);

  const svc = await prisma.service.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenantId },
  });
  if (!svc) throw new AppError('Serviço não encontrado', 404);

  const updated = await prisma.service.update({ where: { id: svc.id }, data: parsed.data });
  res.json(updated);
});

servicesRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const svc = await prisma.service.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenantId },
  });
  if (!svc) throw new AppError('Serviço não encontrado', 404);
  await prisma.service.update({ where: { id: svc.id }, data: { isActive: false } });
  res.json({ message: 'Serviço removido' });
});

// ─────────────── CASHFLOW ───────────────
export const cashFlowRouter = Router();
cashFlowRouter.use(authenticate);

cashFlowRouter.get('/', async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, type } = req.query;
  const where: any = { tenantId: req.user!.tenantId };
  if (startDate) where.date = { gte: new Date(startDate as string) };
  if (endDate) where.date = { ...where.date, lte: new Date(endDate as string) };
  if (type) where.type = type;

  const [data, income, expense] = await Promise.all([
    prisma.cashFlow.findMany({ where, orderBy: { date: 'desc' }, take: 100 }),
    prisma.cashFlow.aggregate({ where: { ...where, type: 'INCOME' }, _sum: { amount: true } }),
    prisma.cashFlow.aggregate({ where: { ...where, type: 'EXPENSE' }, _sum: { amount: true } }),
  ]);

  res.json({
    data,
    summary: {
      income: income._sum.amount || 0,
      expense: expense._sum.amount || 0,
      balance: (income._sum.amount || 0) - (expense._sum.amount || 0),
    },
  });
});

cashFlowRouter.post('/', async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    type: z.enum(['INCOME', 'EXPENSE']),
    category: z.string(),
    description: z.string(),
    amount: z.number().positive(),
    date: z.string().optional(),
    paymentMethod: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.errors[0].message);

  const entry = await prisma.cashFlow.create({
    data: {
      tenantId: req.user!.tenantId,
      ...parsed.data,
      date: parsed.data.date ? new Date(parsed.data.date) : new Date(),
      paymentMethod: parsed.data.paymentMethod as any,
    },
  });
  res.status(201).json(entry);
});

// ─────────────── PRODUCTS ───────────────
export const productsRouter = Router();
productsRouter.use(authenticate);

productsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const products = await prisma.product.findMany({
    where: { tenantId: req.user!.tenantId, isActive: true },
    orderBy: { name: 'asc' },
  });
  res.json({ data: products });
});

productsRouter.get('/low-stock', async (req: AuthRequest, res: Response) => {
  const products = await prisma.product.findMany({
    where: {
      tenantId: req.user!.tenantId,
      isActive: true,
    },
  });
  const lowStock = products.filter((p) => p.stock <= p.minStock);
  res.json({ data: lowStock });
});

// ─────────────── CAMPAIGNS ───────────────
export const campaignsRouter = Router();
campaignsRouter.use(authenticate);

campaignsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const campaigns = await prisma.campaign.findMany({
    where: { tenantId: req.user!.tenantId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ data: campaigns });
});

campaignsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    title: z.string(),
    message: z.string(),
    channel: z.enum(['WHATSAPP', 'SMS', 'EMAIL', 'PUSH']),
    targetType: z.string().default('all'),
    scheduledAt: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.errors[0].message);

  const campaign = await prisma.campaign.create({
    data: {
      tenantId: req.user!.tenantId,
      ...parsed.data,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined,
    },
  });
  res.status(201).json(campaign);
});

// ─────────────── TENANT ───────────────
export const tenantRouter = Router();
tenantRouter.use(authenticate);

tenantRouter.get('/', async (req: AuthRequest, res: Response) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.user!.tenantId },
    include: {
      workingHours: { where: { professionalId: null } },
      units: true,
    },
  });
  if (!tenant) throw new AppError('Estabelecimento não encontrado', 404);
  res.json(tenant);
});

tenantRouter.put('/', async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    name: z.string().min(2).optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    settings: z.record(z.any()).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.errors[0].message);

  const updated = await prisma.tenant.update({
    where: { id: req.user!.tenantId },
    data: parsed.data,
  });
  res.json(updated);
});
