"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.AppError = void 0;
class AppError extends Error {
    constructor(message, statusCode = 400, code) {
        super(message);
        this.message = message;
        this.statusCode = statusCode;
        this.code = code;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
const errorHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            error: err.message,
            code: err.code,
        });
    }
    // Prisma errors
    if (err.name === 'PrismaClientKnownRequestError') {
        const prismaErr = err;
        if (prismaErr.code === 'P2002') {
            return res.status(409).json({ error: 'Registro já existe' });
        }
        if (prismaErr.code === 'P2025') {
            return res.status(404).json({ error: 'Registro não encontrado' });
        }
    }
    console.error('[ERROR]', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=errorHandler.js.map