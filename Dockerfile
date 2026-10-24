# Voka: API + web app in one image. Built by deploy/docker-compose.yml.
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY desktop/package.json desktop/
RUN npm ci --workspace server --workspace web --include-workspace-root
COPY server server
COPY web web
RUN npm run build --workspace server && npm run build --workspace web

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY desktop/package.json desktop/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY server/migrations server/migrations
COPY --from=build /app/web/dist web/dist
WORKDIR /app/server
ENV PORT=3001 UPLOAD_DIR=/data/uploads WEB_DIST=/app/web/dist
EXPOSE 3001
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
CMD ["node", "dist/index.js"]
