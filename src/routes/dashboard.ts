import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

// GET /api/dashboard
dashboardRouter.get('/', async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 86400000);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

  const [
    todayAppointments,
    monthAppointments,
    lastMonthAppointments,
    monthRevenue,
    lastMonthRevenue,
    totalClients,
    newClientsMonth,
    topProfessionals,
    topServices,
    recentAppointments,
    upcomingToday,
  ] = await Promise.all([
    // Today appointments
    prisma.appointment.count({
      where: { tenantId, date: { gte: startOfToday, lt: endOfToday } },
    }),

    // Month appointments
    prisma.appointment.count({
      where: {
        tenantId,
        date: { gte: startOfMonth },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
    }),

    // Last month appointments
    prisma.appointment.count({
      where: {
        tenantId,
        date: { gte: startOfLastMonth, lte: endOfLastMonth },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
    }),

    // Month revenue
    prisma.appointment.aggregate({
      where: { tenantId, date: { gte: startOfMonth }, status: 'COMPLETED' },
      _sum: { totalPrice: true },
    }),

    // Last month revenue
    prisma.appointment.aggregate({
      where: {
        tenantId,
        date: { gte: startOfLastMonth, lte: endOfLastMonth },
        status: 'COMPLETED',
      },
      _sum: { totalPrice: true },
    }),

    // Total clients
    prisma.client.count({ where: { tenantId, isActive: true } }),

    // New clients this month
    prisma.client.count({
      where: { tenantId, createdAt: { gte: startOfMonth } },
    }),

    // Top professionals by revenue
    prisma.appointment.groupBy({
      by: ['professionalId'],
      where: { tenantId, date: { gte: startOfMonth }, status: 'COMPLETED' },
      _sum: { totalPrice: true },
      _count: { id: true },
      orderBy: { _sum: { totalPrice: 'desc' } },
      take: 5,
    }),

    // Top services
    prisma.appointmentService.groupBy({
      by: ['serviceId'],
      where: {
        appointment: {
          tenantId,
          date: { gte: startOfMonth },
          status: 'COMPLETED',
        },
      },
      _sum: { price: true },
      _count: { id: true },
      orderBy: { _sum: { price: 'desc' } },
      take: 5,
    }),

    // Recent completed appointments
    prisma.appointment.findMany({
      where: { tenantId, status: 'COMPLETED' },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: {
        client: { select: { name: true } },
        professional: { select: { name: true } },
      },
    }),

    // Upcoming today
    prisma.appointment.findMany({
      where: {
        tenantId,
        date: { gte: startOfToday, lt: endOfToday },
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
      },
      orderBy: { startTime: 'asc' },
      take: 10,
      include: {
        client: { select: { name: true, phone: true } },
        professional: { select: { name: true, colorCode: true } },
        services: { include: { service: { select: { name: true } } } },
      },
    }),
  ]);

  // Enrich professionals
  const professionalIds = topProfessionals.map((p) => p.professionalId);
  const professionals = await prisma.professional.findMany({
    where: { id: { in: professionalIds } },
    select: { id: true, name: true, avatarUrl: true },
  });
  const profMap = Object.fromEntries(professionals.map((p) => [p.id, p]));

  // Enrich services
  const serviceIds = topServices.map((s) => s.serviceId);
  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds } },
    select: { id: true, name: true },
  });
  const svcMap = Object.fromEntries(services.map((s) => [s.id, s]));

  // Revenue chart: last 7 days
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  });

  const revenueByDay = await Promise.all(
    last7Days.map(async (day) => {
      const next = new Date(day.getTime() + 86400000);
      const result = await prisma.appointment.aggregate({
        where: { tenantId, date: { gte: day, lt: next }, status: 'COMPLETED' },
        _sum: { totalPrice: true },
      });
      return {
        date: day.toISOString().split('T')[0],
        revenue: result._sum.totalPrice || 0,
      };
    })
  );

  // Occupancy rate
  const totalSlots = monthAppointments + lastMonthAppointments;
  const occupancyRate = totalSlots > 0 ? Math.round((monthAppointments / (monthAppointments + 10)) * 100) : 0;

  const currentRevenue = monthRevenue._sum.totalPrice || 0;
  const prevRevenue = lastMonthRevenue._sum.totalPrice || 0;
  const revenueGrowth = prevRevenue > 0
    ? Math.round(((currentRevenue - prevRevenue) / prevRevenue) * 100)
    : 0;

  const appointmentsGrowth = lastMonthAppointments > 0
    ? Math.round(((monthAppointments - lastMonthAppointments) / lastMonthAppointments) * 100)
    : 0;

  const avgTicket = monthAppointments > 0 ? currentRevenue / monthAppointments : 0;

  res.json({
    metrics: {
      revenue: { current: currentRevenue, growth: revenueGrowth },
      appointments: {
        today: todayAppointments,
        month: monthAppointments,
        growth: appointmentsGrowth,
      },
      avgTicket: Math.round(avgTicket * 100) / 100,
      occupancyRate,
      clients: { total: totalClients, newThisMonth: newClientsMonth },
    },
    charts: {
      revenueByDay,
    },
    topProfessionals: topProfessionals.map((p) => ({
      professional: profMap[p.professionalId],
      revenue: p._sum.totalPrice || 0,
      appointments: p._count.id,
    })),
    topServices: topServices.map((s) => ({
      service: svcMap[s.serviceId],
      revenue: s._sum.price || 0,
      count: s._count.id,
    })),
    upcomingToday,
    recentActivity: recentAppointments,
  });
});
