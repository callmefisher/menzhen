FROM node:20-alpine AS builder
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
WORKDIR /app
COPY package.json package-lock.json ./
# BuildKit cache mount: npm tarballs are reused across builds (no re-download).
# Requires DOCKER_BUILDKIT=1 (set in deploy-wizard / docker compose build).
RUN --mount=type=cache,id=menzhen-npm,target=/root/.npm \
    npm ci --registry https://registry.npmmirror.com --legacy-peer-deps
COPY . .
# BuildKit cache mount: Vite's transform cache persists across rebuilds so
# only changed modules are re-processed.  id scopes this cache to this project.
# NOTE: package.json sets NODE_OPTIONS=--max-old-space-size=3072 for vite build
# via cross-env; the 4096 here applies only to the tsc pass before vite.
RUN --mount=type=cache,id=menzhen-vite,target=/app/node_modules/.vite \
    NODE_OPTIONS="--max-old-space-size=4096" npm run build

FROM nginx:alpine
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i 's/\r$//' /etc/nginx/conf.d/default.conf
