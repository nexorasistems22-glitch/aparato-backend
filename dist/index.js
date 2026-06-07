"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_1 = require("./routes/auth");
const appointments_1 = require("./routes/appointments");
const dashboard_1 = require("./routes/dashboard");
const combined_1 = require("./routes/combined");
const errorHandler_1 = require("./middleware/errorHandler");
const cronJobs_1 = require("./jobs/cronJobs");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use((0, cors_1.default)({
    origin: [
        'http://localhost:3000',
        'https://aparato-frontend.vercel.app',
        'https://aparato-app-frontend.vercel.app',
        process.env.FRONTEND_URL || '',
    ],
    credentials: true,
}));
const limiter = (0, express_rate_limit_1.default)({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);
const authLimiter = (0, express_rate_limit_1.default)({ windowMs: 15 * 60 * 1000, max: 20 });
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, morgan_1.default)('combined'));
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});
app.use('/api/auth', authLimiter, auth_1.authRouter);
app.use('/api/appointments', appointments_1.appointmentsRouter);
app.use('/api/clients', combined_1.clientsRouter);
app.use('/api/professionals', combined_1.professionalsRouter);
app.use('/api/services', combined_1.servicesRouter);
app.use('/api/dashboard', dashboard_1.dashboardRouter);
app.use('/api/cashflow', combined_1.cashFlowRouter);
app.use('/api/products', combined_1.productsRouter);
app.use('/api/campaigns', combined_1.campaignsRouter);
app.use('/api/tenant', combined_1.tenantRouter);
app.use(errorHandler_1.errorHandler);
app.listen(PORT, () => {
    console.log(`\n🟡 A Hora do Estilo API`);
    console.log(`✅ Rodando na porta ${PORT}`);
    console.log(`📅 ${new Date().toLocaleString('pt-BR')}\n`);
    (0, cronJobs_1.startCronJobs)();
});
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason);
    process.exit(1);
});
exports.default = app;
//# sourceMappingURL=index.js.map