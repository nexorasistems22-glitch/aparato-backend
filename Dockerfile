FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN node node_modules/prisma/build/index.js generate
COPY . .
EXPOSE 3001
CMD ["node", "-e", "const {execSync}=require('child_process');try{execSync('node node_modules/prisma/build/index.js migrate deploy',{stdio:'inherit'})}catch(e){}; require('node_modules/ts-node/dist/bin').main(['--transpile-only','src/index.ts'])"]