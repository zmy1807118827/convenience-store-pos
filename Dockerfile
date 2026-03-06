# 使用官方 Node.js LTS 轻量镜像
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 先复制依赖文件（利用 Docker 层缓存，依赖不变时不重新安装）
COPY package*.json ./
RUN npm install --omit=dev

# 复制项目文件
COPY server.js ./
COPY public ./public

# 创建数据目录（用于挂载持久化数据库）
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 3000

# 启动服务
CMD ["node", "server.js"]
