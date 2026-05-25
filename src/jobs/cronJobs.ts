import cron from 'node-cron';
import { prisma } from '../lib/prisma';

export function startCronJobs() {
  console.log('⏰ Starting cron jobs...');

  // Every day at 08:00 - send appointment reminders (day before)
  cron.schedule('0 8 * * *', async () => {
    console.log('[CRON] Running appointment reminders...');
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
      const tomorrowEnd = new Date(tomorrowStart.getTime() + 86400000);

      const appointments = await prisma.appointment.findMany({
        where: {
          date: { gte: tomorrowStart, lt: tomorrowEnd },
          status: 'SCHEDULED',
          reminderSent: false,
        },
        include: {
          client: { select: { name: true, phone: true, email: true } },
          professional: { select: { name: true } },
          services: { include: { service: { select: { name: true } } } },
        },
      });

      for (const appt of appointments) {
        // In production, send WhatsApp/SMS here via Twilio or similar
        console.log(`[REMINDER] ${appt.client.name} - ${appt.date.toLocaleDateString('pt-BR')} ${appt.startTime}`);

        await prisma.appointment.update({
          where: { id: appt.id },
          data: { reminderSent: true },
        });
      }

      console.log(`[CRON] Sent ${appointments.length} reminders`);
    } catch (err) {
      console.error('[CRON ERROR] Reminders:', err);
    }
  });

  // Every day at 09:00 - mark no-shows (appointments from yesterday still SCHEDULED/CONFIRMED)
  cron.schedule('0 9 * * *', async () => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const yEnd = new Date(yStart.getTime() + 86400000);

      const result = await prisma.appointment.updateMany({
        where: {
          date: { gte: yStart, lt: yEnd },
          status: { in: ['SCHEDULED', 'CONFIRMED'] },
        },
        data: { status: 'NO_SHOW' },
      });

      console.log(`[CRON] Marked ${result.count} no-shows`);
    } catch (err) {
      console.error('[CRON ERROR] No-shows:', err);
    }
  });

  // Every Monday at 07:00 - identify inactive clients (no visit in 30 days)
  cron.schedule('0 7 * * 1', async () => {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const inactive = await prisma.client.count({
        where: {
          lastVisitAt: { lt: thirtyDaysAgo },
          isActive: true,
        },
      });

      console.log(`[CRON] Inactive clients (30+ days): ${inactive}`);
      // In production: trigger re-engagement campaigns here
    } catch (err) {
      console.error('[CRON ERROR] Inactive clients:', err);
    }
  });

  // Every hour - process scheduled campaigns
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const campaigns = await prisma.campaign.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: { lte: now },
        },
      });

      for (const campaign of campaigns) {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: 'SENDING' },
        });

        // In production: send messages via Twilio/Z-API/etc.
        console.log(`[CRON] Processing campaign: ${campaign.title}`);

        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
      }
    } catch (err) {
      console.error('[CRON ERROR] Campaigns:', err);
    }
  });

  console.log('✅ Cron jobs running');
}
