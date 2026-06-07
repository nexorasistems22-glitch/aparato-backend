"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appointmentsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
exports.appointmentsRouter = (0, express_1.Router)();
exports.appointmentsRouter.use(auth_1.authenticate);
const createSchema = zod_1.z.object({
    clientId: zod_1.z.string().uuid(),
    professionalId: zod_1.z.string().uuid(),
    serviceIds: zod_1.z.array(zod_1.z.string().uuid()).min(1),
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: zod_1.z.string().regex(/^\d{2}:\d{2}$/),
    notes: zod_1.z.string().optional(),
    source: zod_1.z.enum(['ADMIN', 'CLIENT_APP', 'WHATSAPP', 'WEBSITE', 'WALK_IN']).default('ADMIN'),
});
// Helper: calculate end time
function addMinutes(time, minutes) {
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m + minutes;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
// Helper: check conflicts
async function hasConflict(professionalId, date, startTime, endTime, excludeId) {
    const existing = await prisma_1.prisma.appointment.findMany({
        where: {
            professionalId,
            date: new Date(date),
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            id: excludeId ? { not: excludeId } : undefined,
        },
    });
    for (const appt of existing) {
        const apptStart = appt.startTime;
        const apptEnd = appt.endTime;
        if (startTime < apptEnd && endTime > apptStart)
            return true;
    }
    return false;
}
// GET /api/appointments
exports.appointmentsRouter.get('/', async (req, res) => {
    const { date, professionalId, status, page = '1', limit = '50' } = req.query;
    const where = { tenantId: req.user.tenantId };
    if (date)
        where.date = new Date(date);
    if (professionalId)
        where.professionalId = professionalId;
    if (status)
        where.status = status;
    const skip = (Number(page) - 1) * Number(limit);
    const [appointments, total] = await Promise.all([
        prisma_1.prisma.appointment.findMany({
            where,
            skip,
            take: Number(limit),
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
            include: {
                client: { select: { id: true, name: true, phone: true, avatarUrl: true } },
                professional: { select: { id: true, name: true, colorCode: true, avatarUrl: true } },
                services: {
                    include: { service: { select: { id: true, name: true, duration: true } } },
                },
                payment: true,
            },
        }),
        prisma_1.prisma.appointment.count({ where }),
    ]);
    res.json({ data: appointments, total, page: Number(page), limit: Number(limit) });
});
// GET /api/appointments/availability
exports.appointmentsRouter.get('/availability', async (req, res) => {
    const { professionalId, date, serviceIds } = req.query;
    if (!professionalId || !date || !serviceIds) {
        throw new errorHandler_1.AppError('professionalId, date e serviceIds são obrigatórios');
    }
    const ids = serviceIds.split(',');
    const services = await prisma_1.prisma.service.findMany({
        where: { id: { in: ids }, tenantId: req.user.tenantId },
    });
    const totalDuration = services.reduce((s, svc) => s + svc.duration, 0);
    const dayOfWeek = new Date(date).getDay();
    const workingHours = await prisma_1.prisma.workingHours.findFirst({
        where: {
            tenantId: req.user.tenantId,
            professionalId: professionalId,
            dayOfWeek,
            isWorking: true,
        },
    });
    if (!workingHours)
        return res.json({ slots: [], message: 'Profissional não trabalha neste dia' });
    const existing = await prisma_1.prisma.appointment.findMany({
        where: {
            professionalId: professionalId,
            date: new Date(date),
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        },
    });
    const slots = [];
    const [startH, startM] = workingHours.startTime.split(':').map(Number);
    const [endH, endM] = workingHours.endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    for (let m = startMinutes; m + totalDuration <= endMinutes; m += 30) {
        const slotStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const slotEnd = addMinutes(slotStart, totalDuration);
        // Skip lunch
        if (workingHours.lunchStart && workingHours.lunchEnd) {
            if (slotStart < workingHours.lunchEnd && slotEnd > workingHours.lunchStart)
                continue;
        }
        // Check conflicts
        let conflict = false;
        for (const appt of existing) {
            if (slotStart < appt.endTime && slotEnd > appt.startTime) {
                conflict = true;
                break;
            }
        }
        if (!conflict)
            slots.push(slotStart);
    }
    res.json({ slots, totalDuration });
});
// GET /api/appointments/:id
exports.appointmentsRouter.get('/:id', async (req, res) => {
    const appt = await prisma_1.prisma.appointment.findFirst({
        where: { id: req.params.id, tenantId: req.user.tenantId },
        include: {
            client: true,
            professional: true,
            services: { include: { service: true } },
            payment: true,
        },
    });
    if (!appt)
        throw new errorHandler_1.AppError('Agendamento não encontrado', 404);
    res.json(appt);
});
// POST /api/appointments
exports.appointmentsRouter.post('/', async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
        throw new errorHandler_1.AppError(parsed.error.errors[0].message);
    const { clientId, professionalId, serviceIds, date, startTime, notes, source } = parsed.data;
    const services = await prisma_1.prisma.service.findMany({
        where: { id: { in: serviceIds }, tenantId: req.user.tenantId, isActive: true },
    });
    if (services.length !== serviceIds.length)
        throw new errorHandler_1.AppError('Serviço(s) inválido(s)');
    const totalDuration = services.reduce((s, svc) => s + svc.duration, 0);
    const totalPrice = services.reduce((s, svc) => s + svc.price, 0);
    const endTime = addMinutes(startTime, totalDuration);
    const conflict = await hasConflict(professionalId, date, startTime, endTime);
    if (conflict)
        throw new errorHandler_1.AppError('Horário indisponível para este profissional');
    const appointment = await prisma_1.prisma.appointment.create({
        data: {
            tenantId: req.user.tenantId,
            clientId,
            professionalId,
            date: new Date(date),
            startTime,
            endTime,
            totalDuration,
            totalPrice,
            notes,
            source,
            services: {
                create: services.map((svc) => ({
                    serviceId: svc.id,
                    price: svc.price,
                    duration: svc.duration,
                })),
            },
        },
        include: {
            client: true,
            professional: true,
            services: { include: { service: true } },
        },
    });
    res.status(201).json(appointment);
});
// PATCH /api/appointments/:id/status
exports.appointmentsRouter.patch('/:id/status', async (req, res) => {
    const { status, cancelReason } = req.body;
    const validStatuses = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
    if (!validStatuses.includes(status))
        throw new errorHandler_1.AppError('Status inválido');
    const appt = await prisma_1.prisma.appointment.findFirst({
        where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!appt)
        throw new errorHandler_1.AppError('Agendamento não encontrado', 404);
    const updated = await prisma_1.prisma.$transaction(async (tx) => {
        const a = await tx.appointment.update({
            where: { id: appt.id },
            data: {
                status,
                cancelReason: status === 'CANCELLED' ? cancelReason : undefined,
                cancelledAt: status === 'CANCELLED' ? new Date() : undefined,
                confirmedAt: status === 'CONFIRMED' ? new Date() : undefined,
            },
        });
        // When completed: update client stats & add cash flow
        if (status === 'COMPLETED') {
            await tx.client.update({
                where: { id: appt.clientId },
                data: {
                    totalVisits: { increment: 1 },
                    totalSpent: { increment: appt.totalPrice },
                    lastVisitAt: new Date(),
                },
            });
            await tx.cashFlow.create({
                data: {
                    tenantId: req.user.tenantId,
                    type: 'INCOME',
                    category: 'Serviços',
                    description: `Atendimento #${appt.id.slice(-8)}`,
                    amount: appt.totalPrice,
                },
            });
            // Add loyalty points (1 pt per R$1)
            await tx.loyaltyPoint.create({
                data: {
                    tenantId: req.user.tenantId,
                    clientId: appt.clientId,
                    points: Math.floor(appt.totalPrice),
                    description: 'Pontos por atendimento',
                    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                },
            });
        }
        return a;
    });
    res.json(updated);
});
// PUT /api/appointments/:id
exports.appointmentsRouter.put('/:id', async (req, res) => {
    const parsed = createSchema.partial().safeParse(req.body);
    if (!parsed.success)
        throw new errorHandler_1.AppError(parsed.error.errors[0].message);
    const appt = await prisma_1.prisma.appointment.findFirst({
        where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!appt)
        throw new errorHandler_1.AppError('Agendamento não encontrado', 404);
    const updated = await prisma_1.prisma.appointment.update({
        where: { id: appt.id },
        data: {
            notes: parsed.data.notes,
        },
    });
    res.json(updated);
});
// DELETE /api/appointments/:id
exports.appointmentsRouter.delete('/:id', async (req, res) => {
    const appt = await prisma_1.prisma.appointment.findFirst({
        where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!appt)
        throw new errorHandler_1.AppError('Agendamento não encontrado', 404);
    await prisma_1.prisma.appointment.update({
        where: { id: appt.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    res.json({ message: 'Agendamento cancelado' });
});
//# sourceMappingURL=appointments.js.map