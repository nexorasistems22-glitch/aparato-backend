FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN node node_modules/prisma/build/index.js generate
COPY . .
EXPOSE 3001
CMD ["node", "-e", "const {execSync}=require('child_process');try{execSync('node node_modules/prisma/build/index.js migrate deploy',{stdio:'inherit'})}catch(e){console.error(e)}; require('node_modules/ts-node/dist/bin').main(['--transpile-only','src/index.ts'])"]