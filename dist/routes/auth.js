"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
const errorHandler_1 = require("../middleware/errorHandler");
const auth_1 = require("../middleware/auth");
exports.authRouter = (0, express_1.Router)();
const registerSchema = zod_1.z.object({
    tenantName: zod_1.z.string().min(2, 'Nome muito curto'),
    tenantSlug: zod_1.z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug inválido (use letras minúsculas, números e hífens)'),
    ownerName: zod_1.z.string().min(2),
    email: zod_1.z.string().email('Email inválido'),
    password: zod_1.z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
    phone: zod_1.z.string().optional(),
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
    slug: zod_1.z.string().min(1, 'Informe o slug do estabelecimento'),
});
function generateTokens(userId, tenantId, role, email) {
    const secret = process.env.JWT_SECRET;
    const accessToken = jsonwebtoken_1.default.sign({ userId, tenantId, role, email }, secret, { expiresIn: '8h' });
    const refreshToken = jsonwebtoken_1.default.sign({ userId, tenantId, type: 'refresh' }, secret, { expiresIn: '30d' });
    return { accessToken, refreshToken };
}
// POST /api/auth/register
exports.authRouter.post('/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0].message });
    }
    const { tenantName, tenantSlug, ownerName, email, password, phone } = parsed.data;
    const existing = await prisma_1.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (existing)
        throw new errorHandler_1.AppError('Slug já em uso, escolha outro', 409);
    const passwordHash = await bcryptjs_1.default.hash(password, 12);
    const tenant = await prisma_1.prisma.$transaction(async (tx) => {
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
exports.authRouter.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0].message });
    }
    const { email, password, slug } = parsed.data;
    const tenant = await prisma_1.prisma.tenant.findUnique({
        where: { slug },
        select: { id: true, isActive: true, name: true, logoUrl: true, planType: true },
    });
    if (!tenant || !tenant.isActive) {
        throw new errorHandler_1.AppError('Estabelecimento não encontrado ou inativo', 404);
    }
    const user = await prisma_1.prisma.user.findFirst({
        where: { tenantId: tenant.id, email, isActive: true },
    });
    if (!user)
        throw new errorHandler_1.AppError('Credenciais inválidas', 401);
    const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
    if (!valid)
        throw new errorHandler_1.AppError('Credenciais inválidas', 401);
    await prisma_1.prisma.user.update({
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
exports.authRouter.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken)
        throw new errorHandler_1.AppError('Refresh token obrigatório', 400);
    try {
        const decoded = jsonwebtoken_1.default.verify(refreshToken, process.env.JWT_SECRET);
        if (decoded.type !== 'refresh')
            throw new errorHandler_1.AppError('Token inválido', 401);
        const user = await prisma_1.prisma.user.findFirst({
            where: { id: decoded.userId, isActive: true },
        });
        if (!user)
            throw new errorHandler_1.AppError('Usuário não encontrado', 401);
        const { accessToken, refreshToken: newRefresh } = generateTokens(user.id, user.tenantId, user.role, user.email);
        res.json({ accessToken, refreshToken: newRefresh });
    }
    catch {
        throw new errorHandler_1.AppError('Refresh token inválido', 401);
    }
});
// GET /api/auth/me
exports.authRouter.get('/me', auth_1.authenticate, async (req, res) => {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    const tenant = await prisma_1.prisma.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { id: true, name: true, slug: true, logoUrl: true, planType: true, settings: true },
    });
    res.json({ user, tenant });
});
//# sourceMappingURL=auth.js.map