FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN node node_modules/prisma/build/index.js generate
COPY . .
RUN node node_modules/typescript/bin/tsc --skipLibCheck || true
EXPOSE 3001
CMD ["node", "-e", "require('child_process').execSync('node node_modules/prisma/build/index.js migrate deploy', {stdio:'inherit'}); require('./dist/index.js')"]