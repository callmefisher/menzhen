FROM node:20-alpine AS builder
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --registry https://registry.npmmirror.com
COPY . .
RUN npm run build

FROM nginx:alpine
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i 's/\r$//' /etc/nginx/conf.d/default.conf
