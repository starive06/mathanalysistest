# 微信云托管 / CloudBase Run 镜像
# 构建上下文：项目根目录
# 服务端口：3000
# 健康检查：/api/health

FROM node:22-bookworm-slim AS deps

WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV TZ=Asia/Shanghai

COPY --from=deps /app/node_modules ./node_modules
COPY server/ ./

# 生产环境使用 MySQL；不要让镜像包含 server/.env 或运行时数据。
RUN chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
