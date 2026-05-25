import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { authRouter } from './routes/auth';
import { appointmentsRouter } from './routes/appointments';
import { dashboardRouter } from './routes/dashboard';
import {
  clientsRouter,
  professionalsRouter,
  servicesRouter,
  cashFlowRouter,
  productsRouter,
  campaignsRouter,
  tenantRouter,
} from './routes/combined';
import { errorHandler } from './middleware/errorHandler';
import { startCronJobs } from './jobs/cronJobs';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/professionals', professionalsRouter);
app.use('/api/services', servicesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/cashflow', cashFlowRouter);
app.use('/api/products', productsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/tenant', tenantRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🟡 A Hora do Estilo API`);
  console.log(`✅ Rodando na porta ${PORT}`);
  console.log(`📅 ${new Date().toLocaleString('pt-BR')}\n`);
  startCronJobs();
});

export default app;
