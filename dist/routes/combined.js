"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantRouter = exports.campaignsRouter = exports.productsRouter = exports.cashFlowRouter = exports.servicesRouter = exports.professionalsRouter = exports.clientsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
// ─────────────── CLIENTS ───────────────
exports.clientsRouter = (0, express_1.Router)();
exports.clientsRouter.use(auth_1.authenticate);
exports.clientsRouter.get('/', async (req, res) => {
    const { q, page = '1', limit = '20' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where = { tenantId: req.user.tenantId, isActive: true };
    if (q) {
        where.OR = [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { email: { contains: q, mode: 'insensitive' } },
        ];
    }
    const [data, total] = await Promise.all([
        prisma_1.prisma.client.findMany({
            where, skip, take: Number(limit),
            orderBy: { name: 'asc' },
        }),
        prisma_1.prisma.client.count({ where }),
    ]);
    res.json({ data, total });
});
exports.clientsRouter.get('/birthdays', async (req, res) => {
    const today = new Date();
    const clients = await prisma_1.prisma.client.findMany({
        where: {
            tenantId: req.user.tenantId,
            isActive: true,
            birthDate: { not: null },
        },
    });
    const upcoming = clients.filter((c) => {
        if (!c.birthDate)
            return false;
        const bDay = new Date(c.birthDate);
        return bDay.getMonth() === today.getMonth();
    });
    res.json({ data: upcoming });
});
exports.clientsRouter.get('/:id', async (req, res) => {
    const client = await prisma_1.prisma.client.findFirst({
        where: { id: req.params.id, tenantId: req.user.tenantId },
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
    if (!client)
        throw new errorHandler_1.AppError('Cliente não encontrado', 404);
    const totalPoints = client.loyaltyPoints.reduce((s, p) => s + p.points, 0);
    res.json({ ...client, totalLoyaltyPoints: totalPoints });
});
const clientSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    phone: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal('')),
    birthDate: zod_1.z.string().optional(),
    gender: zod_1.z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    notes: zod_1.z.string().optional(),
});
exports.clientsRouter.post('/', async (req, res) => {
    const parsed = clientSchema.safeParse(req.body);
    if (!parsed.success)
        throw new errorHandler_1.AppError(parsed.error.errors[0].message);
    const client = await prisma_1.prisma.client.create({
        data: {
            tenantId: req.user.tenantId,
            ...parsed.data,
            birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : undefined,
            email: parsed.data.email || undefined,
        },
    });
    res.status(201).json(client);
});
exports.clientsRouter.put('/:id', async (req, res) => {
    const parsed = clientSchema.partial().safeParse(req.body);
    if (!parsed.success)
        throw new errorHandler_1.AppError(parsed.error.errors[0].message);
    const client = await prisma_1.prisma.client.findFirst({
        where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!client)
        throw new errorHandler_1.AppError('Cliente não encontrado', 404);
    const updated = await prisma_1.prisma.client.update({
        where: { id: client.id },
        data: {
            ...parsed.data,
            birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : undefined,
        },
    });
    res.json(updated);
});
exports.clientsRouter.delete('/:id', async (req, res) => {
    const client = await prisma_1.prisma.client.findFirst({
        where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!client)
        throw new errorHandler_1.AppError('Cliente não encontrado', 404);
    await prisma_1.prisma.client.update({ where: { id: client.id }, data: { isActive: false } });
    res.json({ message: 'Cliente removido' });
});
// ─────────────── PROFESSIONALS ───────────────
exports.professionalsRouter = (0, express_1.Router)();
exports.professionalsRouter.use(auth_1.authenticate);
exports.professionalsRouter.get('/', async (req, res) => {
    const professionals = await prisma_1.prisma.professional.findMany({
        where: { tenantId: req.user.tenantId, isActive: true },
        include: { schedules: true, services: { include: { service: true } } },
        orderBy: { name: 'asc' },
    });
    res.json({ data: professionals });
});
const proSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal('')),
    phone: zod_1.z.string().optional(),
    bio: zod_1.z.string().optional(),
    commissionRate: zod_1.z.number().min(0).max(100).default(40),
    colorCode: zod_1.z.string().default('#C9A84C'),
    serviceIds: zod_1.z.array(zod_1.z.string()).optional(),
});
exports.professionalsRouter.post('/', async (req, res) => {
    const parsed = proSchema.safeParse(req.body);
    if (!parsed.success)
        throw new errorHandler_1.AppError(parsed.error.errors[0].message);
    const { serviceIds, ...data } = parsed.data;
    const professional = await prisma_1.prisma.$transaction(async (tx) => {
        const p = await tx.professional.create({
            data: { tenantId: req.user.tenantId, ...data, email: data.email || undefined },
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
                tenantId: req.user.tenantId,
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
exports.professionalsRouter.put('/:id', async (req, res) => {
    const parsed = proSchema.partial().safeParse(req.body);
    if (!parsed.success)
        throw new errorHandler_1.AppError(parsed.error.errors[0].message);
    const pro = await prisma_1.prisma.professional.findFirst({
        where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!pro)
        throw new errorHandler_1.AppError('Profissional não encontrado', 404);
    const { serviceIds, ...data } = parsed.data;
    const updated = await prisma_1.prisma.professional.update({
        where: { id: pro.id },
        data: { ...data, email: data.email || undefined },
    });
    res.json(updated);
});
// ─────────────── SERVICES ───────────────
exports.servicesRouter = (0, express_1.Router)();
exports.servicesRouter.use(auth_1.authenticate);
exports.servicesRouter.get('/', async (req, res) => {
    const services = await prisma_1.prisma.service.findMany({
        where: { tenantId: req.user.tenantId, isActive: true },
        include: { category: true },
        orderBy: { name: 'asc' },
    });
    res.json({ data: services });
});
const serviceSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    description: zod_1.z.string().optional(),
    duration: zod_1.z.number().min(5).max(480),
    price: zod_1.z.number().min(0),
    categoryId: zod_1.z.string().optional(),
    isOnline: zod_1.z.boolean().default(true),
});
exports.servicesRouter.post('/', async (req, res) => {
    const parsed = serviceSchema.safeParse(req.body);
    if (!parsed.success)
        throw new errorHandler_1.AppError(parsed.error.errors[0].message);
    const svc = await prisma_1.prisma.service.create({
        data: { tenantId: req.user.tenantId, ...parsed.data },
    });
    res.status(201).json(svc);
});
exports.servicesRouter.put('/:id', async (req, res) => {
    const parsed = serviceSchema.partial().safeParse(req.body);
    if (!parsed.success)
        throw new errorHandler_1.AppError(parsed.error.errors[0].message);
    const svc = await prisma_1.prisma.service.findFirst({
        where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!svc)
        throw new errorHandler_1.AppError('Serviço não encontrado', 404);
    const updated = await prisma_1.prisma.service.update({ where: { id: svc.id }, data: parsed.data });
    res.json(updated);
});
exports.servicesRouter.delete('/:id', async (req, res) => {
    const svc = await prisma_1.prisma.service.findFirst({
        where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!svc)
        throw new errorHandler_1.AppError('Serviço não encontrado', 404);
    await prisma_1.prisma.service.update({ where: { id: svc.id }, data: { isActive: false } });
    res.json({ message: 'Serviço removido' });
});
// ─────────────── CASHFLOW ───────────────
exports.cashFlowRouter = (0, express_1.Router)();
exports.cashFlowRouter.use(auth_1.authenticate);
exports.cashFlowRouter.get('/', async (req, res) => {
    const { startDate, endDate, type } = req.query;
    const where = { tenantId: req.user.tenantId };
    if (startDate)
        where.date = { gte: new Date(startDate) };
    if (endDate)
        where.date = { ...where.date, lte: new Date(endDate) };
    if (type)
        where.type = type;
    const [data, income, expense] = await Promise.all([
        prisma_1.prisma.cashFlow.findMany({ where, orderBy: { date: 'desc' }, take: 100 }),
        prisma_1.prisma.cashFlow.aggregate({ where: { ...where, type: 'INCOME' }, _sum: { amount: true } }),
        prisma_1.prisma.cashFlow.aggregate({ where: { ...where, type: 'EXPENSE' }, _sum: { amount: true } }),
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
exports.cashFlowRouter.post('/', async (req, res) => {
    const schema = zod_1.z.object({
        type: zod_1.z.enum(['INCOME', 'EXPENSE']),
        category: zod_1.z.string(),
        description: zod_1.z.string(),
        amount: zod_1.z.number().positive(),
        date: zod_1.z.string().optional(),
        paymentMethod: zod_1.z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        throw new errorHandler_1.AppError(parsed.error.errors[0].message);
    const entry = await prisma_1.prisma.cashFlow.create({
        data: {
            tenantId: req.user.tenantId,
            ...parsed.data,
            date: parsed.data.date ? new Date(parsed.data.date) : new Date(),
            paymentMethod: parsed.data.paymentMethod,
        },
    });
    res.status(201).json(entry);
});
// ─────────────── PRODUCTS ───────────────
exports.productsRouter = (0, express_1.Router)();
exports.productsRouter.use(auth_1.authenticate);
exports.productsRouter.get('/', async (req, res) => {
    const products = await prisma_1.prisma.product.findMany({
        where: { tenantId: req.user.tenantId, isActive: true },
        orderBy: { name: 'asc' },
    });
    res.json({ data: products });
});
exports.productsRouter.get('/low-stock', async (req, res) => {
    const products = await prisma_1.prisma.product.findMany({
        where: {
            tenantId: req.user.tenantId,
            isActive: true,
        },
    });
    const lowStock = products.filter((p) => p.stock <= p.minStock);
    res.json({ data: lowStock });
});
// ─────────────── CAMPAIGNS ───────────────
exports.campaignsRouter = (0, express_1.Router)();
exports.campaignsRouter.use(auth_1.authenticate);
exports.campaignsRouter.get('/', async (req, res) => {
    const campaigns = await prisma_1.prisma.campaign.findMany({
        where: { tenantId: req.user.tenantId },
        orderBy: { createdAt: 'desc' },
    });
    res.json({ data: campaigns });
});
exports.campaignsRouter.post('/', async (req, res) => {
    const schema = zod_1.z.object({
        title: zod_1.z.string(),
        message: zod_1.z.string(),
        channel: zod_1.z.enum(['WHATSAPP', 'SMS', 'EMAIL', 'PUSH']),
        targetType: zod_1.z.string().default('all'),
        scheduledAt: zod_1.z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        throw new errorHandler_1.AppError(parsed.error.errors[0].message);
    const campaign = await prisma_1.prisma.campaign.create({
        data: {
            tenantId: req.user.tenantId,
            ...parsed.data,
            scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined,
        },
    });
    res.status(201).json(campaign);
});
// ─────────────── TENANT ───────────────
exports.tenantRouter = (0, express_1.Router)();
exports.tenantRouter.use(auth_1.authenticate);
exports.tenantRouter.get('/', async (req, res) => {
    const tenant = await prisma_1.prisma.tenant.findUnique({
        where: { id: req.user.tenantId },
        include: {
            workingHours: { where: { professionalId: null } },
            units: true,
        },
    });
    if (!tenant)
        throw new errorHandler_1.AppError('Estabelecimento não encontrado', 404);
    res.json(tenant);
});
exports.tenantRouter.put('/', async (req, res) => {
    const schema = zod_1.z.object({
        name: zod_1.z.string().min(2).optional(),
        phone: zod_1.z.string().optional(),
        email: zod_1.z.string().email().optional(),
        address: zod_1.z.string().optional(),
        city: zod_1.z.string().optional(),
        state: zod_1.z.string().optional(),
        settings: zod_1.z.record(zod_1.z.any()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        throw new errorHandler_1.AppError(parsed.error.errors[0].message);
    const updated = await prisma_1.prisma.tenant.update({
        where: { id: req.user.tenantId },
        data: parsed.data,
    });
    res.json(updated);
});
//# sourceMappingURL=combined.js.map