import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

export const appointmentsRouter = Router();
appointmentsRouter.use(authenticate);

const createSchema = z.object({
  clientId: z.string().uuid(),
  professionalId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().optional(),
  source: z.enum(['ADMIN', 'CLIENT_APP', 'WHATSAPP', 'WEBSITE', 'WALK_IN']).default('ADMIN'),
});

// Helper: calculate end time
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Helper: check conflicts
async function hasConflict(
  professionalId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeId?: string
): Promise<boolean> {
  const existing = await prisma.appointment.findMany({
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
    if (startTime < apptEnd && endTime > apptStart) return true;
  }
  return false;
}

// GET /api/appointments
appointmentsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const { date, professionalId, status, page = '1', limit = '50' } = req.query;

  const where: any = { tenantId: req.user!.tenantId };
  if (date) where.date = new Date(date as string);
  if (professionalId) where.professionalId = professionalId;
  if (status) where.status = status;

  const skip = (Number(page) - 1) * Number(limit);

  const [appointments, total] = await Promise.all([
    prisma.appointment.findMany({
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
    prisma.appointment.count({ where }),
  ]);

  res.json({ data: appointments, total, page: Number(page), limit: Number(limit) });
});

// GET /api/appointments/availability
appointmentsRouter.get('/availability', async (req: AuthRequest, res: Response) => {
  const { professionalId, date, serviceIds } = req.query;
  if (!professionalId || !date || !serviceIds) {
    throw new AppError('professionalId, date e serviceIds são obrigatórios');
  }

  const ids = (serviceIds as string).split(',');
  const services = await prisma.service.findMany({
    where: { id: { in: ids }, tenantId: req.user!.tenantId },
  });
  const totalDuration = services.reduce((s, svc) => s + svc.duration, 0);

  const dayOfWeek = new Date(date as string).getDay();
  const workingHours = await prisma.workingHours.findFirst({
    where: {
      tenantId: req.user!.tenantId,
      professionalId: professionalId as string,
      dayOfWeek,
      isWorking: true,
    },
  });

  if (!workingHours) return res.json({ slots: [], message: 'Profissional não trabalha neste dia' });

  const existing = await prisma.appointment.findMany({
    where: {
      professionalId: professionalId as string,
      date: new Date(date as string),
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
    },
  });

  const slots: string[] = [];
  const [startH, startM] = workingHours.startTime.split(':').map(Number);
  const [endH, endM] = workingHours.endTime.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  for (let m = startMinutes; m + totalDuration <= endMinutes; m += 30) {
    const slotStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const slotEnd = addMinutes(slotStart, totalDuration);

    // Skip lunch
    if (workingHours.lunchStart && workingHours.lunchEnd) {
      if (slotStart < workingHours.lunchEnd && slotEnd > workingHours.lunchStart) continue;
    }

    // Check conflicts
    let conflict = false;
    for (const appt of existing) {
      if (slotStart < appt.endTime && slotEnd > appt.startTime) {
        conflict = true;
        break;
      }
    }

    if (!conflict) slots.push(slotStart);
  }

  res.json({ slots, totalDuration });
});

// GET /api/appointments/:id
appointmentsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  const appt = await prisma.appointment.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenantId },
    include: {
      client: true,
      professional: true,
      services: { include: { service: true } },
      payment: true,
    },
  });
  if (!appt) throw new AppError('Agendamento não encontrado', 404);
  res.json(appt);
});

// POST /api/appointments
appointmentsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.errors[0].message);

  const { clientId, professionalId, serviceIds, date, startTime, notes, source } = parsed.data;

  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds }, tenantId: req.user!.tenantId, isActive: true },
  });
  if (services.length !== serviceIds.length) throw new AppError('Serviço(s) inválido(s)');

  const totalDuration = services.reduce((s, svc) => s + svc.duration, 0);
  const totalPrice = services.reduce((s, svc) => s + svc.price, 0);
  const endTime = addMinutes(startTime, totalDuration);

  const conflict = await hasConflict(professionalId, date, startTime, endTime);
  if (conflict) throw new AppError('Horário indisponível para este profissional');

  const appointment = await prisma.appointment.create({
    data: {
      tenantId: req.user!.tenantId,
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
appointmentsRouter.patch('/:id/status', async (req: AuthRequest, res: Response) => {
  const { status, cancelReason } = req.body;
  const validStatuses = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
  if (!validStatuses.includes(status)) throw new AppError('Status inválido');

  const appt = await prisma.appointment.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenantId },
  });
  if (!appt) throw new AppError('Agendamento não encontrado', 404);

  const updated = await prisma.$transaction(async (tx) => {
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
          tenantId: req.user!.tenantId,
          type: 'INCOME',
          category: 'Serviços',
          description: `Atendimento #${appt.id.slice(-8)}`,
          amount: appt.totalPrice,
        },
      });

      // Add loyalty points (1 pt per R$1)
      await tx.loyaltyPoint.create({
        data: {
          tenantId: req.user!.tenantId,
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
appointmentsRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = createSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.errors[0].message);

  const appt = await prisma.appointment.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenantId },
  });
  if (!appt) throw new AppError('Agendamento não encontrado', 404);

  const updated = await prisma.appointment.update({
    where: { id: appt.id },
    data: {
      notes: parsed.data.notes,
    },
  });

  res.json(updated);
});

// DELETE /api/appointments/:id
appointmentsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const appt = await prisma.appointment.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenantId },
  });
  if (!appt) throw new AppError('Agendamento não encontrado', 404);

  await prisma.appointment.update({
    where: { id: appt.id },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });

  res.json({ message: 'Agendamento cancelado' });
});
