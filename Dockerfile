FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
# postinstall 需要 public 目录存在，所以提前复制
COPY public ./public

RUN npm install --omit=dev

COPY server.js ./

RUN mkdir -p /app/data

EXPOSE 3000 3001

CMD ["node", "server.js"]
