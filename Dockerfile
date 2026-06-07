FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN node node_modules/prisma/build/index.js generate
COPY . .
EXPOSE 3001
CMD ["node", "dist/index.js"]