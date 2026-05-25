import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'barbearia-demo' },
    update: {},
    create: {
      name: 'Barbearia A Hora do Estilo',
      slug: 'barbearia-demo',
      phone: '(11) 99999-9999',
      email: 'contato@ahoradoestilo.com.br',
      address: 'Av. Paulista, 1000',
      city: 'São Paulo',
      state: 'SP',
    },
  });

  // Owner user
  const passwordHash = await bcrypt.hash('admin123', 12);
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@ahoradoestilo.com.br' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@ahoradoestilo.com.br',
      passwordHash,
      name: 'Administrador',
      role: 'OWNER',
    },
  });

  // Categories
  const catCorte = await prisma.category.create({ data: { tenantId: tenant.id, name: 'Cortes', iconName: 'scissors', color: '#C9A84C' } });
  const catBarba = await prisma.category.create({ data: { tenantId: tenant.id, name: 'Barba', iconName: 'razor', color: '#6BAFF0' } });
  const catEstetica = await prisma.category.create({ data: { tenantId: tenant.id, name: 'Estética', iconName: 'sparkles', color: '#3DCFA0' } });

  // Services
  const services = await Promise.all([
    prisma.service.create({ data: { tenantId: tenant.id, categoryId: catCorte.id, name: 'Corte Clássico', duration: 30, price: 35 } }),
    prisma.service.create({ data: { tenantId: tenant.id, categoryId: catCorte.id, name: 'Degradê Premium', duration: 45, price: 50 } }),
    prisma.service.create({ data: { tenantId: tenant.id, categoryId: catBarba.id, name: 'Barba Completa', duration: 30, price: 30 } }),
    prisma.service.create({ data: { tenantId: tenant.id, categoryId: catCorte.id, name: 'Corte + Barba', duration: 60, price: 60 } }),
    prisma.service.create({ data: { tenantId: tenant.id, categoryId: catEstetica.id, name: 'Pigmentação', duration: 90, price: 80 } }),
  ]);

  // Professionals
  const pros = await Promise.all([
    prisma.professional.create({
      data: { tenantId: tenant.id, name: 'Rafael Santos', phone: '(11) 91111-1111', commissionRate: 45, colorCode: '#C9A84C' },
    }),
    prisma.professional.create({
      data: { tenantId: tenant.id, name: 'Lucas Pereira', phone: '(11) 92222-2222', commissionRate: 40, colorCode: '#6BAFF0' },
    }),
    prisma.professional.create({
      data: { tenantId: tenant.id, name: 'Diego Melo', phone: '(11) 93333-3333', commissionRate: 40, colorCode: '#3DCFA0' },
    }),
  ]);

  // Working hours for each professional
  const days = [1, 2, 3, 4, 5, 6];
  for (const pro of pros) {
    await prisma.workingHours.createMany({
      data: days.map((d) => ({
        tenantId: tenant.id,
        professionalId: pro.id,
        dayOfWeek: d,
        startTime: '09:00',
        endTime: '19:00',
        lunchStart: '12:00',
        lunchEnd: '13:00',
        isWorking: true,
      })),
    });

    await prisma.professionalService.createMany({
      data: services.map((s) => ({ professionalId: pro.id, serviceId: s.id })),
    });
  }

  // Clients
  const clients = await Promise.all([
    prisma.client.create({ data: { tenantId: tenant.id, name: 'Ricardo Mendes', phone: '(11) 94444-4444', email: 'ricardo@email.com', totalVisits: 18, totalSpent: 1080 } }),
    prisma.client.create({ data: { tenantId: tenant.id, name: 'Bruno Torres', phone: '(11) 95555-5555', email: 'bruno@email.com', totalVisits: 14, totalSpent: 840 } }),
    prisma.client.create({ data: { tenantId: tenant.id, name: 'Marcos Vidal', phone: '(11) 96666-6666', totalVisits: 11, totalSpent: 660 } }),
    prisma.client.create({ data: { tenantId: tenant.id, name: 'Felipe Andrade', phone: '(11) 97777-7777', totalVisits: 9, totalSpent: 450 } }),
    prisma.client.create({ data: { tenantId: tenant.id, name: 'João Costa', phone: '(11) 98888-8888', totalVisits: 6, totalSpent: 300 } }),
  ]);

  // Tenant working hours (global)
  await prisma.workingHours.createMany({
    data: days.map((d) => ({
      tenantId: tenant.id,
      dayOfWeek: d,
      startTime: '09:00',
      endTime: '19:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
      isWorking: true,
    })),
  });

  // Sample appointment for today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clientId: clients[0].id,
      professionalId: pros[0].id,
      date: today,
      startTime: '09:00',
      endTime: '10:00',
      totalDuration: 60,
      totalPrice: 60,
      status: 'SCHEDULED',
      source: 'ADMIN',
      services: {
        create: [{ serviceId: services[3].id, price: 60, duration: 60 }],
      },
    },
  });

  console.log('✅ Seed complete!');
  console.log('\n📋 Login credentials:');
  console.log('   Slug: barbearia-demo');
  console.log('   Email: admin@ahoradoestilo.com.br');
  console.log('   Password: admin123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
