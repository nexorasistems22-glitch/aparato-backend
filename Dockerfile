FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npx tsc --skipLibCheck || true
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js || npx ts-node --transpile-only src/index.ts"]
